(function () {
  'use strict';

  const getElement = id => document.getElementById(id);
  const inkTrace = InkTrace;
  const CANVAS_SIZE_KEY = 'inktrace-web-canvas-size';
  const MIN_SAMPLE_DISTANCE = 0.4;
  const GUIDE_SIZE = 1000;
  const GUIDE_FONT_SIZE = 650;
  const GUIDE_BASELINE = 0.75;
  // Measure H, x, the tallest ascender and the deepest descender in each bundled font.
  // Source: tools/measure_latin_guides.py (Pillow ink bounds, calibrated 2026-11-17).
  // Original measurements remain in tools/latin-guide-measurements.json.
  // Shared Latin guides and font sizes for all prompts: tools/measure_shared_latin_guides.py.
  // At 650 px, x rises 343 px in Noto and 290 px in Shoujin above the baseline.
  const REGULAR_GUIDE_FONT_SIZE = GUIDE_FONT_SIZE * 290 / 343;
  const LATIN_GUIDE_POSITIONS = { ascender: 31, 'cap-height': 32.5, 'x-height': 46, descender: 94.9 };

  function guideFont(side) {
    const fontSize = side === 'regular' ? REGULAR_GUIDE_FONT_SIZE : GUIDE_FONT_SIZE;
    return side === 'regular' ? `100 ${fontSize}px InkTraceGuide` : `400 ${fontSize}px InkTraceShoujin`;
  }

  const boards = Array.from(document.querySelectorAll('[data-board]'), element => {
    const side = element.dataset.board;
    const canvas = element.querySelector('.writing-canvas');
    const guide = element.querySelector('.guide-canvas');
    const paper = element.querySelector('.paper');
    const viewport = document.createElement('div');
    viewport.className = 'writing-viewport';
    paper.before(viewport);
    viewport.append(paper);
    const panInputs = [];
    if (side === 'rough') {
      const referenceFrame = document.createElement('div');
      referenceFrame.className = 'reference-frame';
      referenceFrame.append(guide, ...paper.querySelectorAll('.writing-baseline, .writing-latin-guides'));
      paper.prepend(referenceFrame);
      const controls = document.createElement('div');
      controls.className = 'canvas-pan-controls';
      for (const [axis, text] of [['x', '左右移動'], ['y', '上下移動']]) {
        const label = document.createElement('label');
        label.textContent = text;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.value = '50';
        input.dataset.axis = axis;
        input.oninput = () => {
          if (isDrawing()) {
            return;
          }
          const distance = axis === 'x' ? viewport.scrollWidth - viewport.clientWidth : viewport.scrollHeight - viewport.clientHeight;
          viewport[axis === 'x' ? 'scrollLeft' : 'scrollTop'] = distance * input.valueAsNumber / 100;
        };
        label.append(input);
        controls.append(label);
        panInputs.push(input);
      }
      viewport.before(controls);
      viewport.addEventListener('scroll', () => {
        for (const input of panInputs) {
          const horizontal = input.dataset.axis === 'x';
          const distance = horizontal ? viewport.scrollWidth - viewport.clientWidth : viewport.scrollHeight - viewport.clientHeight;
          const position = horizontal ? viewport.scrollLeft : viewport.scrollTop;
          if (distance > 0) {
            input.value = String(position / distance * 100);
          }
        }
      });
    }
    paper.style.setProperty('--guide-baseline', `${GUIDE_BASELINE * 100}%`);
    for (const [line, position] of Object.entries(LATIN_GUIDE_POSITIONS)) {
      paper.style.setProperty(`--guide-${line}`, `${position}%`);
    }
    return {
      side,
      label: side === 'regular' ? '硬筆書法' : '毛筆書法',
      fields: inkTrace.boardFields[side],
      canvas,
      guide,
      ctx: canvas.getContext('2d'),
      guideContext: guide.getContext('2d'),
      slot: element.querySelector('.canvas-slot'),
      info: element.querySelector('.board-info'),
      paper,
      viewport,
      panInputs,
      buttons: Array.from(element.querySelectorAll('[data-action]')),
      element,
      progress: element.querySelector('progress'),
      status: element.querySelector('.board-status'),
      strokeCount: element.querySelector('.board-stroke-count'),
      uploadError: '',
      lockMessage: element.querySelector('.board-lock'),
      locked: side === 'rough',
      pointer: null,
      pointerType: '',
      strokeRect: null,
      lastPointerPoint: null,
      frame: 0,
      drawnPoints: 0,
      line: null,
      points: 0,
    };
  });
  let papers = [];
  let activePaper = null;
  let characterIndex = 0;
  let uploadingBoard = null;
  let editingPaperId = null;
  let characterListPaper = null;
  let characterListStart = -1;
  let characterListIndex = -1;
  let shoujinFontLoaded = false;
  let githubSettings = {
    configured: false,
    owner: '',
    repo: '',
    branch: 'main'
  };
  let isUpdatingSettings = false;
  let theme = 'system';

  const getUploadDestination = () => githubSettings.owner && githubSettings.repo
    ? `${githubSettings.owner}/${githubSettings.repo}@main`
    : '';
  const getCurrentDraft = () => activePaper.drafts[characterIndex] ||= { strokes: [] };
  const getBoardStrokes = board => getCurrentDraft()[board.fields.strokes] ||= [];
  const hasInk = entry => Boolean(entry?.strokes?.length || entry?.roughStrokes?.length);
  const isDrawing = () => boards.some(board => board.pointer !== null);
  const editor = getElement('editor');
  const penInput = getElement('pen-input');

  penInput.onchange = () => {
    if (penInput.checked) {
      for (const board of boards) {
        if (board.pointer !== null && !['pen', 'stylus'].includes(board.pointerType)) {
          discardActiveStroke(board);
        }
      }
    }
  };

  const showMessage = (text, error = false) => {
    getElement('message').textContent = text;
    getElement('message').classList.toggle('error', error);
  };
  const showSettingsMessage = (text, error = false) => {
    getElement('settings-status').textContent = text;
    getElement('settings-status').classList.toggle('error', error);
  };

  async function savePaper(p = activePaper) {
    if (!p) {
      return;
    }
    try {
      await PaperStore.put(p);
    } catch (e) {
      showMessage(e.message, true);
    }
  }

  async function saveCurrentDraft(onError = error => showMessage(error.message, true)) {
    const draft = activePaper?.drafts[characterIndex];
    if (!draft) {
      return;
    }
    try {
      await PaperStore.putDraft(activePaper.id, characterIndex, draft);
    } catch (error) {
      onError(error);
    }
  }

  function displayDate(at) {
    return new Date(at).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderHome() {
    const list = getElement('papers');
    list.replaceChildren();
    let found = 0;
    const query = getElement('search').value.trim();
    for (const p of papers.filter(p => p.title.includes(query)).sort((a, b) => b.createdAt - a.createdAt)) {
      found++;
      const completed = inkTrace.count(p, getUploadDestination());
      const card = document.createElement('article');
      card.className = 'chapter';
      card.classList.toggle('complete', completed === p.chars.length);
      const open = document.createElement('button');
      open.className = 'chapter-main';
      open.onclick = () => openPaper(p.id);
      const icon = document.createElement('span');
      icon.className = 'chapter-icon';
      icon.textContent = [...p.title][0];
      const info = document.createElement('div');
      const name = document.createElement('div');
      const sub = document.createElement('div');
      name.className = 'chapter-title';
      name.textContent = p.title;
      sub.className = 'chapter-info';
      sub.textContent = `${completed} / ${p.chars.length} 已上傳`;
      info.append(name, sub);
      open.append(icon, info);
      const bar = document.createElement('progress');
      bar.max = p.chars.length;
      bar.value = completed;
      bar.setAttribute('aria-label', p.title + '上傳進度');
      const foot = document.createElement('div');
      foot.className = 'chapter-footer';
      const date = document.createElement('span');
      const at = Math.max(0, ...Object.values(p.drafts).map(d => Math.max(d.uploaded?.at || 0, d.roughUploaded?.at || 0)));
      date.textContent = at ? '上傳於 ' + displayDate(at) : '尚無上傳時間';
      const rename = document.createElement('button');
      rename.className = 'text-button';
      rename.textContent = '改名';
      rename.onclick = () => showPaperDialog(p);
      const remove = document.createElement('button');
      remove.className = 'text-button';
      remove.textContent = '刪除';
      remove.onclick = async () => {
        if (confirm(`刪除「${p.title}」及本機草稿？GitHub 檔案會保留。`)) {
          try {
            await PaperStore.remove(p.id);
            papers = papers.filter(x => x.id !== p.id);
            renderHome();
          } catch (e) {
            showMessage(e.message, true);
          }
        }
      };
      foot.append(date, rename, remove);
      card.append(open, bar, foot);
      list.append(card);
    }
    getElement('empty').hidden = !!found;
    getElement('empty').textContent = query ? '找不到稿紙' : '尚無稿紙';
  }

  function updateCharacterButton(button, index) {
    const destination = getUploadDestination();
    const regularDone = inkTrace.done(activePaper, index, destination, 'regular');
    const roughDone = inkTrace.done(activePaper, index, destination, 'rough');
    const done = regularDone && roughDone;
    const partial = regularDone !== roughDone;
    const hasDraft = hasInk(activePaper.drafts[index]);
    const selected = index === characterIndex;
    button.classList.toggle('selected', selected);
    button.classList.toggle('done', done);
    button.classList.toggle('partial', partial);
    button.classList.toggle('draft', hasDraft && !partial && !done);
    button.disabled = Boolean(uploadingBoard);
    button.setAttribute('aria-pressed', String(selected));
    const status = done ? '兩種都已上傳' :
      partial ? `僅${regularDone ? boards[0].label : boards[1].label}已上傳` :
      hasDraft ? '有草稿' : '未寫';
    button.setAttribute('aria-label', `${activePaper.chars[index]}，第 ${index + 1} 字，${status}`);
  }

  function createCharacterButton(index) {
    const button = document.createElement('button');
    button.className = 'char';
    button.textContent = activePaper.chars[index];
    updateCharacterButton(button, index);
    button.onclick = () => {
      selectCharacter(index);
      getElement('progress-dialog').close();
    };
    return button;
  }

  function setBoardLocked(board, locked) {
    board.locked = locked;
    board.element.toggleAttribute('data-locked', locked);
    board.canvas.setAttribute('aria-disabled', String(locked));
    board.lockMessage.hidden = !locked;
  }

  function clearUploadErrors() {
    for (const board of boards) {
      board.uploadError = '';
    }
  }

  function updateBoardProgress(board, complete, mismatch) {
    const uploading = uploadingBoard === board;
    const label = uploading ? '上傳中' : complete ? '上傳完成' : '尚未上傳';
    const detail = board.uploadError || (mismatch ? '筆畫數須相同' : '');
    const status = detail ? `${label} · ${detail}` : label;
    if (board.status.textContent !== status) {
      board.status.textContent = status;
    }
    board.status.classList.toggle('error', Boolean(detail));
    board.progress.setAttribute('aria-valuetext', label);
    if (uploading) {
      board.progress.removeAttribute('value');
    } else {
      board.progress.value = complete ? 1 : 0;
    }
  }

  function updateEditorControls() {
    const isUploading = Boolean(uploadingBoard);
    const row = getElement('characters');
    const start = Math.floor(characterIndex / 8) * 8;
    if (characterListPaper !== activePaper || characterListStart !== start) {
      row.replaceChildren();
      for (let index = start; index < Math.min(start + 8, activePaper.chars.length); index++) {
        row.append(createCharacterButton(index));
      }
      characterListPaper = activePaper;
      characterListStart = start;
      characterListIndex = -1;
    } else {
      Array.from(row.children).forEach((button, index) => updateCharacterButton(button, start + index));
    }
    if (characterListIndex !== characterIndex) {
      characterListIndex = characterIndex;
      const selected = row.children[characterIndex - start];
      row.scrollLeft = Math.max(0, selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2);
    }

    const destination = getUploadDestination();
    const [regular, rough] = boards;
    const draft = getCurrentDraft();
    const regularUploaded = regular.pointer === null &&
      inkTrace.done(activePaper, characterIndex, destination, regular.side);
    const roughUploaded = inkTrace.done(activePaper, characterIndex, destination, rough.side);
    const released = regularUploaded && roughUploaded && draft.releasedStrokeCount;
    setBoardLocked(regular, regularUploaded);
    setBoardLocked(rough, !regularUploaded || Boolean(released));
    rough.lockMessage.textContent = released ? '毛筆已上傳' : '請先上傳硬筆書法';

    const targetCount = inkTrace.strokeCount(draft.strokes);
    for (const board of boards) {
      const count = inkTrace.strokeCount(draft[board.fields.strokes]);
      const showTarget = board === rough && regularUploaded && !released;
      const mismatch = showTarget && count !== targetCount;
      board.strokeCount.textContent = showTarget ? `${count} / ${targetCount} 筆` : `${released || count} 筆`;
      const complete = board === regular ? regularUploaded : roughUploaded;
      updateBoardProgress(board, complete, mismatch && count > 0);

      for (const button of board.buttons) {
        const uploadBlocked = button.dataset.action === 'upload' && (complete || mismatch);
        button.disabled = isUploading || (board === rough && board.locked) || !count || uploadBlocked;
      }
    }
    getElement('prev').disabled = isUploading || characterIndex === 0;
    getElement('next').disabled = isUploading || characterIndex === activePaper.chars.length - 1;
    for (const id of ['view-progress', 'settings', 'add-paper']) {
      getElement(id).disabled = isUploading;
    }
  }

  function renderEditor() {
    if (!activePaper) {
      return;
    }
    getElement('paper-title').textContent = activePaper.title;
    getElement('position').textContent = `第 ${characterIndex + 1} / ${activePaper.chars.length} 字`;
    updateEditorControls();
    for (const board of boards) {
      drawStrokes(board);
    }
    fitCanvas();
  }

  function drawSample(context, point, previous) {
    if (previous && !point.move) {
      context.lineWidth = (previous.width + point.width) / 2;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.beginPath();
    context.arc(point.x, point.y, point.width / 2, 0, Math.PI * 2);
    context.fill();
  }

  function drawStrokes(board) {
    const { ctx } = board;
    const scale = GUIDE_SIZE / inkTrace.canvasSize;
    const offset = board.side === 'rough' ? GUIDE_SIZE : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offset, offset);
    ctx.fillStyle = ctx.strokeStyle = '#111';
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const line of getBoardStrokes(board)) {
      for (let index = 0; index < line.length; index++) {
        drawSample(ctx, line[index], line[index - 1]);
      }
    }
    board.drawnPoints = board.line?.length || 0;
  }

  function drawPendingSamples(board) {
    if (board.frame) {
      cancelAnimationFrame(board.frame);
      board.frame = 0;
    }
    if (!board.line) {
      return;
    }
    for (let index = board.drawnPoints; index < board.line.length; index++) {
      drawSample(board.ctx, board.line[index], board.line[index - 1]);
    }
    board.drawnPoints = board.line.length;
  }

  function scheduleSamples(board) {
    if (!board.frame) {
      board.frame = requestAnimationFrame(() => {
        board.frame = 0;
        drawPendingSamples(board);
      });
    }
  }

  function drawGuides() {
    if (!activePaper) {
      return;
    }
    const character = activePaper.chars[characterIndex];
    const isLatin = /\p{Script=Latin}/u.test(character) && /\p{Letter}/u.test(character);
    const showBaseline = /[\p{Script=Latin}\p{Decimal_Number}]/u.test(character);
    for (const board of boards) {
      const ctx = board.guideContext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, GUIDE_SIZE, GUIDE_SIZE);
      board.paper.toggleAttribute('data-show-baseline', showBaseline);
      board.paper.toggleAttribute('data-latin-letter', isLatin);
      if (board.side === 'rough' && (!shoujinFontLoaded || !InkTraceShoujin.hasGlyph(character))) {
        continue;
      }

      const font = guideFont(board.side);
      ctx.font = board.side === 'regular' ? `${font}, sans-serif` : font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#e9e9e9';
      ctx.fillText(character, GUIDE_SIZE / 2, GUIDE_SIZE * GUIDE_BASELINE);
    }
  }

  function selectCharacter(nextIndex) {
    if (uploadingBoard || !activePaper || nextIndex < 0 || nextIndex >= activePaper.chars.length) {
      return;
    }
    finishAllStrokes();
    clearUploadErrors();
    characterIndex = nextIndex;
    activePaper.selected = characterIndex;
    drawGuides();
    renderEditor();
    savePaper();
    showMessage('');
  }

  function openPaper(id) {
    activePaper = papers.find(p => p.id === id);
    characterIndex = Math.min(activePaper.selected || 0, activePaper.chars.length - 1);
    clearUploadErrors();
    getElement('home').hidden = true;
    getElement('editor').hidden = false;
    getElement('view-progress').hidden = false;
    document.body.classList.add('writing-mode');
    window.scrollTo(0, 0);
    showMessage('');
    drawGuides();
    renderEditor();
  }

  function readPointerPoint(board, event, release = false) {
    const rect = board.strokeRect;
    const frameCount = board.side === 'rough' ? 3 : 1;
    const offset = board.side === 'rough' ? inkTrace.canvasSize : 0;
    const previous = board.lastPointerPoint;
    const width = release && previous ? previous.width : inkTrace.width(
      Number(getElement('width').value),
      ['pen', 'stylus'].includes(event.pointerType)
        ? (Number.isFinite(event.pressure) ? event.pressure : 0.5)
        : 1,
      Number(getElement('pressure').value) / 100,
    );
    return {
      x: (event.clientX - rect.left) / rect.width * inkTrace.canvasSize * frameCount - offset,
      y: (event.clientY - rect.top) / rect.height * inkTrace.canvasSize * frameCount - offset,
      width,
    };
  }

  function releaseStroke(board) {
    const pointer = board.pointer;
    board.line = null;
    board.pointer = null;
    board.pointerType = '';
    board.strokeRect = null;
    board.lastPointerPoint = null;
    if (typeof pointer === 'number' && board.canvas.hasPointerCapture(pointer)) {
      board.canvas.releasePointerCapture(pointer);
    }
  }

  function discardActiveStroke(board) {
    if (board.frame) {
      cancelAnimationFrame(board.frame);
      board.frame = 0;
    }
    const lines = getBoardStrokes(board);
    const index = lines.indexOf(board.line);
    if (index !== -1) {
      lines.splice(index, 1);
    }
    releaseStroke(board);
    drawStrokes(board);
    saveCurrentDraft();
    updateEditorControls();
  }

  function finishStroke(board) {
    if (board.pointer === null) {
      return;
    }
    drawPendingSamples(board);
    const draft = getCurrentDraft();
    if (draft.releasedStrokeCount && board.line?.length) {
      activePaper.drafts[characterIndex] = { strokes: draft.strokes };
    }
    releaseStroke(board);
    saveCurrentDraft();
    updateEditorControls();
    fitCanvas();
  }

  function finishAllStrokes() {
    for (const board of boards) {
      finishStroke(board);
    }
  }

  function startStroke(board, event) {
    if (!activePaper || uploadingBoard || board.locked || board.pointer !== null) {
      return false;
    }
    const lines = getBoardStrokes(board);
    if (board.side === 'rough' && inkTrace.strokeCount(lines) >= inkTrace.strokeCount(getCurrentDraft().strokes)) {
      return false;
    }
    board.points = lines.reduce((count, line) => count + line.length, 0);
    if (lines.length >= 1000 || board.points >= 20000) {
      showMessage('筆跡達上限，請復原或清除部分筆畫。', true);
      return false;
    }

    showMessage('');
    board.uploadError = '';
    const rect = board.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    board.strokeRect = rect;
    board.pointer = event.pointerId;
    board.pointerType = event.pointerType;
    board.drawnPoints = 0;
    board.line = [];
    board.lastPointerPoint = readPointerPoint(board, event);
    if (board.side === 'rough' || inkTrace.insideCanvas(board.lastPointerPoint)) {
      recordStrokePoint(board, board.lastPointerPoint);
    }
    drawPendingSamples(board);
    return true;
  }

  function recordStrokePoint(board, point) {
    if (board.points >= 20000) {
      return;
    }
    if (!board.line.length) {
      getBoardStrokes(board).push(board.line);
    }
    board.line.push(point);
    board.points++;
  }

  function appendStrokeSample(board, sample, release = false) {
    const previous = board.lastPointerPoint;
    const next = readPointerPoint(board, sample, release);
    board.lastPointerPoint = next;
    if (board.side === 'rough') {
      const last = board.line.at(-1);
      if (!last || Math.hypot(next.x - last.x, next.y - last.y) >= MIN_SAMPLE_DISTANCE) {
        recordStrokePoint(board, next);
      }
      return;
    }
    const previousInside = inkTrace.insideCanvas(previous);
    const nextInside = inkTrace.insideCanvas(next);
    if (!previousInside || !nextInside) {
      const visible = inkTrace.clipSegment(previous, next);
      if (!visible) {
        return;
      }
      const [entry, exit] = visible;
      if (!previousInside) {
        recordStrokePoint(board, { ...entry, move: true });
      }
      if (entry.x !== exit.x || entry.y !== exit.y) {
        recordStrokePoint(board, exit);
      }
      return;
    }
    const last = board.line.at(-1);
    if (!last || Math.hypot(next.x - last.x, next.y - last.y) >= MIN_SAMPLE_DISTANCE) {
      recordStrokePoint(board, next);
    }
  }

  function capturePointer(board, pointerId) {
    try {
      board.canvas.setPointerCapture(pointerId);
    } catch {
      // Window listeners also receive movements without capture.
    }
  }

  function stylusSample(touch) {
    return {
      pointerId: `stylus:${touch.identifier}`,
      pointerType: 'stylus',
      clientX: touch.clientX,
      clientY: touch.clientY,
      pressure: touch.force,
    };
  }

  for (const board of boards) {
    const { canvas } = board;
    canvas.addEventListener('pointerdown', event => {
      if (!activePaper || uploadingBoard || board.locked) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      if (
        (event.button !== 0 && !(event.pointerType === 'pen' && event.button === -1)) ||
        (penInput.checked && event.pointerType !== 'pen') ||
        board.pointerType === 'stylus'
      ) {
        return;
      }
      if (event.pointerType === 'pen') {
        for (const otherBoard of boards) {
          if (otherBoard.pointerType === 'pen') {
            finishStroke(otherBoard);
          }
        }
      }
      if (startStroke(board, event)) {
        capturePointer(board, event.pointerId);
      }
    });

    window.addEventListener('pointermove', event => {
      // Recover contact when the browser first delivers a pressed move.
      if (
        event.pointerType === 'pen' && ((event.buttons & 1) || event.pressure > 0) &&
        event.target === canvas
      ) {
        if (boards.every(otherBoard => otherBoard.pointer === null)) {
          const samples = event.getCoalescedEvents?.();
          if (startStroke(board, samples?.[0] || event)) {
            capturePointer(board, event.pointerId);
          }
        }
      }
      if (event.pointerId !== board.pointer) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      if (event.pointerType === 'pen' && event.buttons === 0 && !event.pressure) {
        finishStroke(board);
        return;
      }
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) {
        appendStrokeSample(board, sample);
      }
      scheduleSamples(board);
    }, { passive: false });

    window.addEventListener('pointerup', event => {
      if (event.pointerId === board.pointer) {
        appendStrokeSample(board, event, true);
        finishStroke(board);
      }
    });

    window.addEventListener('pointercancel', event => {
      if (event.pointerId === board.pointer) {
        finishStroke(board);
      }
    });
    window.addEventListener('lostpointercapture', event => {
      if (event.pointerId === board.pointer && board.pointerType !== 'pen') {
        finishStroke(board);
      }
    });

    // WebKit can expose Pencil samples through Touch Events even when
    // the matching pen Pointer Event is interrupted or missing.
    canvas.addEventListener('touchstart', event => {
      if (!activePaper || board.locked || uploadingBoard) {
        return;
      }
      const touch = Array.from(event.changedTouches).find(item => item.touchType === 'stylus');
      if (!touch) {
        if (penInput.checked && event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const sample = stylusSample(touch);
      if (board.pointerType === 'touch') {
        // The browser may have reported this Pencil contact as touch first.
        discardActiveStroke(board);
      }
      if (board.pointerType === 'pen') {
        // Adopt the pointer stroke instead of drawing the same contact twice.
        const pointerId = board.pointer;
        board.pointer = sample.pointerId;
        board.pointerType = 'stylus';
        if (canvas.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId);
        }
        appendStrokeSample(board, sample);
        scheduleSamples(board);
      } else {
        startStroke(board, sample);
      }
    }, { passive: false });

    for (const type of ['touchmove', 'touchend', 'touchcancel']) {
      window.addEventListener(type, event => {
        if (board.pointerType !== 'stylus') {
          return;
        }
        const touch = Array.from(event.changedTouches).find(item =>
          `stylus:${item.identifier}` === board.pointer
        );
        if (!touch) {
          return;
        }
        if (event.cancelable) {
          event.preventDefault();
        }
        if (type !== 'touchcancel') {
          appendStrokeSample(board, stylusSample(touch), type === 'touchend');
        }
        if (type === 'touchmove') {
          scheduleSamples(board);
        } else {
          finishStroke(board);
        }
      }, { passive: false });
    }

    for (const button of board.buttons) {
      button.onclick = () => {
        if (!activePaper || button.disabled) {
          return;
        }
        const action = button.dataset.action;
        if (action === 'upload') {
          return uploadBoard(board);
        }
        finishAllStrokes();
        if (action === 'download') {
          downloadBoard(board);
          return;
        }
        board.uploadError = '';
        if (action === 'undo') {
          getBoardStrokes(board).pop();
        } else {
          getCurrentDraft()[board.fields.strokes] = [];
        }
        saveCurrentDraft();
        drawStrokes(board);
        updateEditorControls();
        showMessage('');
      };
    }
  }

  getElement('prev').onclick = () => selectCharacter(characterIndex - 1);
  getElement('next').onclick = () => selectCharacter(characterIndex + 1);
  getElement('width').oninput = () => {
    getElement('width-value').value = getElement('width').value;
  };
  getElement('pressure').oninput = () => {
    getElement('pressure-value').value = getElement('pressure').value;
  };
  getElement('show-guide').onchange = () => {
    for (const board of boards) {
      board.guide.hidden = !getElement('show-guide').checked;
    }
  };
  getElement('home-link').onclick = event => {
    if (!activePaper || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (uploadingBoard) {
      return;
    }
    finishAllStrokes();
    savePaper();
    activePaper = null;
    document.body.classList.remove('writing-mode');
    getElement('editor').hidden = true;
    getElement('view-progress').hidden = true;
    getElement('home').hidden = false;
    renderHome();
    window.scrollTo(0, 0);
    showMessage('');
  };

  function enablePenTap(button) {
    const activate = button.onclick;
    let penDown = null;
    let handledPenUp = -Infinity;

    button.addEventListener('pointerdown', event => {
      handledPenUp = -Infinity;
      penDown = event.pointerType === 'pen' && !button.disabled
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    });
    button.addEventListener('pointercancel', () => { penDown = null; });
    button.addEventListener('pointerleave', () => { penDown = null; });
    button.addEventListener('pointerup', event => {
      const start = penDown;
      penDown = null;
      if (
        !start || event.pointerType !== 'pen' || event.pointerId !== start.id ||
        button.disabled || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12
      ) {
        return;
      }
      handledPenUp = event.timeStamp;
      activate.call(button, event);
    });
    button.onclick = event => {
      const elapsed = event.timeStamp - handledPenUp;
      if ((event.pointerType === 'pen' || event.detail > 0) && elapsed >= 0 && elapsed < 450) {
        handledPenUp = -Infinity;
        return;
      }
      return activate.call(button, event);
    };
  }

  for (const id of ['prev', 'next']) {
    enablePenTap(getElement(id));
  }
  for (const board of boards) {
    for (const button of board.buttons) {
      enablePenTap(button);
    }
  }
  getElement('search').oninput = renderHome;
  getElement('site-info').onclick = () => getElement('site-info-dialog').showModal();
  const progressDialog = getElement('progress-dialog');
  const progressGrid = getElement('progress-grid');
  const releaseInkButton = getElement('release-uploaded-ink');
  const releaseInkStatus = getElement('release-ink-status');

  getElement('view-progress').onclick = () => {
    finishAllStrokes();
    releaseInkStatus.textContent = '';
    releaseInkStatus.classList.remove('error');
    progressGrid.replaceChildren();
    for (let i = 0; i < activePaper.chars.length; i++) {
      progressGrid.append(createCharacterButton(i));
    }
    progressDialog.showModal();
  };

  const closeProgressButton = progressDialog.querySelector('[data-close]');
  progressDialog.addEventListener('cancel', event => {
    if (releaseInkButton.disabled) {
      event.preventDefault();
    }
  });

  releaseInkButton.onclick = async () => {
    if (!confirm('清除這份稿紙中硬筆和毛筆都已上傳的本機筆跡？之後請到 GitHub 下載 SVG，上傳進度會保留。')) {
      return;
    }
    const paper = activePaper;
    releaseInkButton.disabled = closeProgressButton.disabled = progressGrid.inert = true;
    releaseInkStatus.classList.remove('error');
    releaseInkStatus.textContent = '正在釋放本機筆跡…';
    try {
      const released = await PaperStore.releaseUploadedStrokes(paper.id, getUploadDestination());
      for (const [index, draft] of released) {
        paper.drafts[index] = draft;
        updateCharacterButton(progressGrid.children[index], index);
      }
      renderEditor();
      releaseInkStatus.textContent = released.length
        ? `已釋放 ${released.length} 字的本機筆跡。`
        : '沒有可釋放的筆跡。';
    } catch (error) {
      releaseInkStatus.textContent = error.message;
      releaseInkStatus.classList.add('error');
    } finally {
      releaseInkButton.disabled = closeProgressButton.disabled = progressGrid.inert = false;
      releaseInkButton.focus();
    }
  };

  function downloadBoard(board) {
    const strokes = getBoardStrokes(board);
    if (!strokes.length) {
      return;
    }
    const svg = new Blob([inkTrace.svg(strokes, {
      clipToFrame: board.side !== 'rough', framePadding: board.side === 'rough' ? 1 : 0,
    })], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svg);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${board.label}-${inkTrace.filenameAt(activePaper, characterIndex)}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function uploadBoard(board) {
    if (uploadingBoard || !activePaper || board.locked) {
      return;
    }
    finishAllStrokes();
    const ink = getBoardStrokes(board);
    const destination = getUploadDestination();
    if (board.locked || !inkTrace.strokeCount(ink) ||
      (board.side === 'rough' && !inkTrace.hasMatchingStrokeCounts(getCurrentDraft())) ||
      inkTrace.done(activePaper, characterIndex, destination, board.side)) {
      return;
    }
    if (!githubSettings.configured) {
      showSettings();
      showSettingsMessage('請先儲存 GitHub 設定。');
      return;
    }

    showMessage('');
    board.uploadError = '';
    uploadingBoard = board;
    updateEditorControls();
    try {
      const filename = inkTrace.filenameAt(activePaper, characterIndex);
      await InkTraceGitHub.check(githubSettings);
      const result = await InkTraceGitHub.upload(
        githubSettings,
        activePaper.title,
        activePaper.chars[characterIndex],
        board.side,
        inkTrace.svg(ink, {
          clipToFrame: board.side !== 'rough', framePadding: board.side === 'rough' ? 1 : 0,
        }),
        filename,
      );
      getCurrentDraft()[board.fields.upload] = {
        ...result,
        filename,
        svgFormat: inkTrace.svgFormat,
        signature: inkTrace.signature(ink),
        title: activePaper.title,
        destination,
        at: Date.now(),
      };
      await saveCurrentDraft(error => {
        board.uploadError = `本機紀錄儲存失敗：${error.message}`;
      });
    } catch (error) {
      board.uploadError = error.message;
    } finally {
      uploadingBoard = null;
      updateEditorControls();
      fitCanvas();
    }
  }

  function showPaperDialog(p = null) {
    editingPaperId = p?.id || null;
    getElement('paper-dialog-title').textContent = p ? '稿紙改名' : '新增稿紙';
    getElement('new-title').value = p?.title || '';
    getElement('new-text').value = '';
    getElement('new-text').required = !p;
    getElement('text-label').hidden = getElement('import-row').hidden = !!p;
    getElement('paper-form-error').textContent = p ? '改名後會上傳至新目錄；原 GitHub 檔案不會搬移。' : '';
    getElement('text-file').value = '';
    getElement('paper-dialog').showModal();
  }
  getElement('add-paper').onclick = () => showPaperDialog();
  const restoreBuiltInButton = getElement('restore-built-in-papers');
  restoreBuiltInButton.onclick = async () => {
    const addPaperButton = getElement('add-paper');
    const status = getElement('restore-papers-status');
    restoreBuiltInButton.disabled = addPaperButton.disabled = true;
    status.textContent = '';
    status.classList.remove('error');
    try {
      const added = await PaperStore.restoreBuiltInPapers();
      if (added.length) {
        papers.push(...added);
        getElement('search').value = '';
        renderHome();
      }
      status.textContent = added.length ? `已載入 ${added.length} 份預設稿紙。` : '沒有可補回的預設稿紙。';
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      restoreBuiltInButton.disabled = addPaperButton.disabled = false;
    }
  };
  getElement('paper-form').onsubmit = async e => {
    e.preventDefault();
    try {
      const title = inkTrace.title(getElement('new-title').value);
      if (papers.some(p => p.id !== editingPaperId && p.title === title)) {
        throw Error('已有同名稿紙。');
      }
      if (editingPaperId) {
        const p = papers.find(p => p.id === editingPaperId);
        const next = { ...p, title };
        await PaperStore.put(next);
        papers = papers.map(x => x.id === p.id ? next : x);
      }
      else {
        const p = inkTrace.paper(title, getElement('new-text').value);
        await PaperStore.put(p);
        papers.push(p);
      }
      getElement('paper-dialog').close();
      renderHome();
      showMessage('');
    } catch (e) {
      getElement('paper-form-error').textContent = e.message;
    }
  };
  getElement('text-file').onchange = async () => {
    try {
      const f = getElement('text-file').files[0];
      if (!f) {
        return;
      }
      if (f.size > 65536) {
        throw Error('TXT 上限為 64 KB。');
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
      inkTrace.characters(text);
      getElement('new-text').value = text;
      if (!getElement('new-title').value) {
        getElement('new-title').value = f.name.replace(/\.txt$/i, '');
      }
      getElement('paper-form-error').textContent = '';
    } catch (e) {
      getElement('paper-form-error').textContent = e.message;
    }
  };
  getElement('paste-json').onclick = () => {
    getElement('json-input').value = '';
    getElement('json-error').textContent = '';
    getElement('json-dialog').showModal();
  };
  getElement('json-form').onsubmit = e => {
    e.preventDefault();
    try {
      const data = inkTrace.parseJSON(getElement('json-input').value);
      getElement('new-title').value = data.title;
      getElement('new-text').value = data.text;
      getElement('json-dialog').close();
    } catch (e) {
      getElement('json-error').textContent = e.message;
    }
  };

  function setGithub(value) {
    githubSettings = value;
    const repoLink = getElement('github-repo');
    const { owner, repo } = githubSettings;
    repoLink.hidden = !owner || !repo || repo === '.' || repo === '..';
    if (repoLink.hidden) {
      repoLink.removeAttribute('href');
    } else {
      repoLink.href = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    }
    getElement('connection-dot').classList.toggle('connected', githubSettings.configured);
    getElement('connection-dot').setAttribute('aria-label', githubSettings.configured ? '已設定' : '尚未設定');
    renderHome();
    if (activePaper) {
      clearUploadErrors();
      updateEditorControls();
    }
  }

  function updateTokenStorageStatus() {
    getElement('token').placeholder = githubSettings.configured ? '已設定，留空沿用；輸入新 Token 可替換' : 'github_pat_…';
    getElement('token-storage-status').textContent = githubSettings.configured
      ? (githubSettings.rememberToken ? 'Token 已記住，可在此瀏覽器重新開啟網頁後繼續使用。' : 'Token 已設定，目前僅供這個分頁使用。')
      : '尚未設定 Token。';
  }

  function showSettings() {
    getElement('owner').value = githubSettings.owner;
    getElement('repo').value = githubSettings.repo;
    getElement('token').value = '';
    getElement('remember-token').checked = Boolean(githubSettings.rememberToken);
    updateTokenStorageStatus();
    showSettingsMessage('');
    getElement('settings-dialog').showModal();
  }
  getElement('settings').onclick = showSettings;

  function runSettingsAction(action) {
    return async e => {
      e.preventDefault();
      if (isUpdatingSettings) {
        return;
      }
      isUpdatingSettings = true;
      for (const b of getElement('settings-form').querySelectorAll('button')) {
        b.disabled = true;
      }
      try {
        await action();
      } catch (e) {
        showSettingsMessage(e.message, true);
      } finally {
        isUpdatingSettings = false;
        for (const b of getElement('settings-form').querySelectorAll('button')) {
          b.disabled = false;
        }
      }
    };
  }
  getElement('settings-form').onsubmit = runSettingsAction(async () => {
    const token = getElement('token').value.trim() || githubSettings.token || '';
    const result = InkTraceGitHub.configure(getElement('owner').value.trim(), getElement('repo').value.trim(), token);
    result.rememberToken = getElement('remember-token').checked;
    const saved = { owner: result.owner, repo: result.repo };
    if (result.rememberToken) {
      saved.token = result.token;
      saved.rememberToken = true;
    }
    try {
      localStorage.setItem('inktrace-github', JSON.stringify(saved));
    } catch {
      throw Error('無法儲存 GitHub 設定，請確認瀏覽器允許儲存網站資料。');
    }
    getElement('token').value = '';
    setGithub(result);
    updateTokenStorageStatus();
    showSettingsMessage('已儲存，請測試連線。');
  });
  getElement('check').onclick = runSettingsAction(async () => {
    if (
      getElement('owner').value.trim() !== githubSettings.owner ||
      getElement('repo').value.trim() !== githubSettings.repo ||
      getElement('token').value ||
      getElement('remember-token').checked !== Boolean(githubSettings.rememberToken)
    ) {
      throw Error('請先儲存設定，再測試連線。');
    }
    showSettingsMessage('連線中…');
    await InkTraceGitHub.check(githubSettings);
    showSettingsMessage('連線成功 · main');
  });
  getElement('clear-settings').onclick = runSettingsAction(async () => {
    try {
      localStorage.removeItem('inktrace-github');
    } catch {
      throw Error('無法清除已儲存的設定，請確認瀏覽器允許存取網站資料。');
    }
    setGithub({ configured: false, owner: '', repo: '' });
    getElement('owner').value = getElement('repo').value = getElement('token').value = '';
    getElement('remember-token').checked = false;
    updateTokenStorageStatus();
    showSettingsMessage('已清除。');
  });
  getElement('settings-dialog').addEventListener('close', () => {
    getElement('token').value = '';
  });
  let canvasFitFrame = 0;
  const canvasSizeInput = getElement('canvas-size');
  const canvasSizeOutput = getElement('canvas-size-value');
  const minCanvasSize = Number(canvasSizeInput.min);
  const maxCanvasSize = Number(canvasSizeInput.max);
  let preferredCanvasSize = canvasSizeInput.valueAsNumber;

  try {
    const savedSize = Number(localStorage.getItem(CANVAS_SIZE_KEY));
    if (Number.isInteger(savedSize) && savedSize >= minCanvasSize && savedSize <= maxCanvasSize) {
      preferredCanvasSize = savedSize;
    }
  } catch (_) { }

  canvasSizeInput.oninput = () => {
    preferredCanvasSize = canvasSizeInput.valueAsNumber;
    fitCanvas();
  };
  canvasSizeInput.onchange = () => {
    try {
      localStorage.setItem(CANVAS_SIZE_KEY, String(preferredCanvasSize));
    } catch (_) { }
  };

  function fitCanvas() {
    cancelAnimationFrame(canvasFitFrame);
    canvasFitFrame = requestAnimationFrame(() => {
      if (!activePaper || isDrawing()) {
        return;
      }
      const mobile = window.matchMedia('(max-width: 699px), (max-height: 520px) and (max-width: 1000px)').matches;
      const sizes = boards.map(board => {
        const rect = board.slot.getBoundingClientRect();
        const frameCount = board.side === 'rough' ? 3 : 1;
        const availableSize = Math.floor(Math.min(maxCanvasSize, mobile ? rect.width : Math.min(
          rect.width / frameCount, (rect.height - board.info.getBoundingClientRect().height) / frameCount,
        )));
        const minimum = Math.min(mobile ? Math.max(160, minCanvasSize) : minCanvasSize, availableSize);
        const side = Math.max(minimum, Math.min(preferredCanvasSize, availableSize));
        return { board, availableSize, minimum, side, frameCount };
      });
      if (sizes.some(size => size.availableSize <= 0)) {
        return;
      }
      const { minimum, availableSize, side } = sizes[0];
      canvasSizeInput.min = String(minimum);
      canvasSizeInput.max = String(availableSize);
      canvasSizeInput.value = String(side);
      canvasSizeInput.disabled = minimum === availableSize;
      canvasSizeInput.setAttribute('aria-valuetext', `${side} 像素`);
      canvasSizeOutput.value = `${side} px`;
      for (const { board, side, frameCount } of sizes) {
        board.paper.style.width = side * frameCount + 'px';
        board.paper.style.height = side * frameCount + 'px';
        if (mobile && board.side === 'rough') {
          board.viewport.scrollLeft = (board.viewport.scrollWidth - board.viewport.clientWidth) * board.panInputs[0].valueAsNumber / 100;
          board.viewport.scrollTop = (board.viewport.scrollHeight - board.viewport.clientHeight) * board.panInputs[1].valueAsNumber / 100;
        }
      }
    });
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(fitCanvas);
    for (const board of boards) {
      observer.observe(board.slot);
      observer.observe(board.info);
    }
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('blur', finishAllStrokes);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      finishAllStrokes();
    }
  });

  for (const type of ['selectstart', 'contextmenu', 'dragstart']) {
    editor.addEventListener(type, event => event.preventDefault());
  }
  window.visualViewport?.addEventListener('resize', fitCanvas);
  for (const b of document.querySelectorAll('[data-close]')) {
    b.onclick = () => getElement(b.dataset.close).close();
  }
  const names = { system: '系統', light: '淺色', dark: '深色' }, modes = Object.keys(names);
  try {
    const saved = localStorage.getItem('inktrace-web-theme');
    if (modes.includes(saved)) {
      theme = saved;
    }
  } catch (_) { }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    getElement('theme').textContent = '主題：' + names[theme];
  }
  getElement('theme').onclick = () => {
    theme = modes[(modes.indexOf(theme) + 1) % 3];
    applyTheme();
    try {
      localStorage.setItem('inktrace-web-theme', theme);
    } catch (_) { }
  };
  applyTheme();

  function startWebAnalytics() {
    const { origin, pathname } = window.location;
    if (origin !== 'https://lctung.github.io' ||
      (pathname !== '/InkTrace-Web' && !pathname.startsWith('/InkTrace-Web/'))) {
      return;
    }
    const token = document.querySelector('meta[name="cloudflare-web-analytics"]')?.content;
    if (!token) {
      return;
    }
    const beacon = document.createElement('script');
    beacon.type = 'module';
    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    beacon.dataset.cfBeacon = JSON.stringify({ token });
    document.head.append(beacon);
  }

  async function init() {
    try {
      await PaperStore.init();
      papers = await PaperStore.all();
      try {
        const cached = JSON.parse(localStorage.getItem('inktrace-github') || 'null');
        if (cached && typeof cached.owner === 'string' && typeof cached.repo === 'string') {
          githubSettings.owner = cached.owner;
          githubSettings.repo = cached.repo;
          if (cached.rememberToken === true && typeof cached.token === 'string') {
            githubSettings = { ...InkTraceGitHub.configure(cached.owner, cached.repo, cached.token), rememberToken: true };
          }
        }
      } catch { }
      setGithub(githubSettings);
      restoreBuiltInButton.disabled = getElement('add-paper').disabled = false;
      document.fonts.load(guideFont('regular')).then(drawGuides).catch(() => { });
      document.fonts.load(guideFont('rough')).then(faces => {
        shoujinFontLoaded = faces.length > 0 && faces.every(face => face.status === 'loaded');
        drawGuides();
      }).catch(() => { });
    } catch (error) {
      showMessage(error.message || '初始化失敗，請重新整理。', true);
    }
  }
  init();
  startWebAnalytics();
})();
