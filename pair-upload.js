(function (root) {
  'use strict';

  const pendingSaves = new WeakSet();

  // Persist each confirmed upload before continuing, so retry only sends missing files.
  async function upload({ paper, index, destination, config, onProgress = () => {} }) {
    const core = root.InkTrace;
    const draft = paper.drafts[index];
    if (!draft) throw Error('請先完成左右兩欄。');
    const completed = core.pairDone(paper, index, destination);
    if (!completed && !core.hasMatchingStrokeCounts(draft)) throw Error('請完成左右兩欄，並確認硬筆與毛筆筆畫數相同。');
    const filename = core.filenameAt(paper, index);
    const pending = ['regular', 'rough'].filter(side => !core.done(paper, index, destination, side)).map(side => ({
      side,
      fields: core.boardFields[side],
      svg: core.svg(draft[core.boardFields[side].strokes], {
        clipToFrame: side !== 'rough', framePadding: side === 'rough' ? 1 : 0,
      }),
    }));
    async function persistDraft() {
      try { await root.PaperStore.putDraft(paper.id, index, draft); }
      catch {
        pendingSaves.add(draft);
        throw Error('本機草稿或上傳紀錄儲存失敗，已停留本字，請重試。');
      }
    }
    await persistDraft();
    if (pending.length) await root.InkTraceGitHub.check(config);
    for (const { side, fields, svg } of pending) {
      onProgress(side);
      const result = await root.InkTraceGitHub.upload(config, paper.title, paper.chars[index], side, svg, filename);
      draft[fields.upload] = {
        ...result, filename, svgFormat: core.svgFormat, signature: core.signature(draft[fields.strokes]),
        title: paper.title, destination, at: Date.now(),
      };
      await persistDraft();
    }
    const nextIndex = index + 1 < paper.chars.length ? index + 1 : null;
    try { await root.PaperStore.put({ ...paper, selected: nextIndex ?? index }); }
    catch {
      pendingSaves.add(draft);
      throw Error('兩欄已上傳，但本機選字位置儲存失敗，請重試後繼續。');
    }
    pendingSaves.delete(draft);
    paper.selected = nextIndex ?? index;
    return { nextIndex };
  }
  root.InkTracePairUpload = { upload, needsSave: draft => pendingSaves.has(draft) };
  if (typeof module !== 'undefined') module.exports = root.InkTracePairUpload;
})(globalThis);
