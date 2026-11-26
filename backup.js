(function (root) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function requireValid(condition) {
    if (!condition) throw Error('備份格式不正確或資料損毀，未變更本機資料。');
  }
  function strokes(value) {
    requireValid(Array.isArray(value));
    return value.map(line => {
      requireValid(Array.isArray(line));
      return line.map(point => {
        requireValid(object(point) && ['x', 'y', 'width'].every(key => Number.isFinite(point[key])) &&
          point.width > 0 && (point.move === undefined || typeof point.move === 'boolean'));
        return { x: point.x, y: point.y, width: point.width, ...(point.move === undefined ? {} : { move: point.move }) };
      });
    });
  }
  function upload(value) {
    requireValid(object(value));
    const result = {};
    for (const key of ['sha', 'url', 'filename', 'svgFormat', 'signature', 'title', 'destination']) {
      if (value[key] !== undefined) {
        requireValid(typeof value[key] === 'string');
        result[key] = value[key];
      }
    }
    if (value.at !== undefined) {
      requireValid(Number.isFinite(value.at) && value.at >= 0);
      result.at = value.at;
    }
    return result;
  }
  function validate(data) {
    requireValid(object(data) && data.format === 'inktrace-personal-backup' && data.version === 1 &&
      typeof data.createdAt === 'string' && Number.isFinite(Date.parse(data.createdAt)) && Array.isArray(data.papers));
    const ids = new Set();
    const papers = data.papers.map(paper => {
      requireValid(object(paper) && typeof paper.id === 'string' && paper.id.length > 0 && paper.id.length <= 200 &&
        !ids.has(paper.id) && typeof paper.title === 'string' && Array.isArray(paper.chars) &&
        paper.chars.every(char => typeof char === 'string' && [...char].length === 1) &&
        Number.isInteger(paper.selected) && paper.selected >= 0 && paper.selected < paper.chars.length &&
        Number.isFinite(paper.createdAt) && paper.createdAt >= 0 && object(paper.drafts));
      ids.add(paper.id);
      requireValid(root.InkTrace.title(paper.title) === paper.title);
      requireValid(JSON.stringify(root.InkTrace.characters(paper.chars.join(''))) === JSON.stringify(paper.chars));
      const drafts = {};
      for (const [index, draft] of Object.entries(paper.drafts)) {
        requireValid(/^(0|[1-9]\d*)$/.test(index) && Number(index) < paper.chars.length && object(draft));
        const saved = {};
        for (const field of ['strokes', 'roughStrokes']) {
          if (draft[field] !== undefined) saved[field] = strokes(draft[field]);
        }
        for (const field of ['uploaded', 'roughUploaded']) {
          if (draft[field] !== undefined) saved[field] = upload(draft[field]);
        }
        if (draft.releasedStrokeCount !== undefined) {
          requireValid(Number.isInteger(draft.releasedStrokeCount) && draft.releasedStrokeCount > 0);
          saved.releasedStrokeCount = draft.releasedStrokeCount;
        }
        drafts[index] = saved;
      }
      return { id: paper.id, title: paper.title, chars: [...paper.chars], selected: paper.selected,
        createdAt: paper.createdAt, drafts };
    });
    return { format: data.format, version: 1, createdAt: data.createdAt, papers };
  }
  function parse(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) {
      throw Error('備份限 20 MB，請分別保存 SVG 以減少本機筆跡。');
    }
    let data;
    try { data = JSON.parse(raw); } catch { throw Error('無法讀取備份 JSON，未變更本機資料。'); }
    return validate(data);
  }
  function create(papers) {
    return parse(JSON.stringify({ format: 'inktrace-personal-backup', version: 1, createdAt: new Date().toISOString(), papers }));
  }
  root.InkTraceBackup = { create, parse, validate, maxBytes: MAX_BYTES };
  if (typeof module !== 'undefined') module.exports = root.InkTraceBackup;
})(globalThis);
