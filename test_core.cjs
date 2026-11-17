const assert = require('node:assert/strict');
const C = require('./core.js');
assert.deepEqual(C.characters('天 地\n天\ufeff𠀀'), ['天', '地', '天', '𠀀']);
assert.throws(() => C.characters(' \n'));
assert.throws(() => C.title('../test'));
assert.throws(() => C.parseJSON('{"title":"x","textUrl":"https://example.com"}'));
assert.equal(C.name('?'), 'U+3F.svg');
assert.ok(Math.abs(C.width(12, 0, 1) - 1.8) < 1e-10);
assert.equal(C.width(12, .2, 0), 12);
const strokes = [[{ x: 10, y: 20, width: 12 }]];
const p = { title: '稿紙', chars: ['天'], drafts: { 0: { strokes } } };
assert.equal(C.count(p, 'owner/repo@main'), 0);
p.drafts[0].uploaded = { title: p.title, signature: C.signature(strokes), destination: 'owner/repo@main' };
assert.equal(C.done(p, 0, 'owner/repo@main'), false, 'legacy SVG can be re-uploaded');
p.drafts[0].uploaded.svgFormat = 'filled-outline-v1';
assert.equal(C.done(p, 0, 'owner/repo@main'), false, 'uploads using the centered format can be replaced');
p.drafts[0].uploaded.svgFormat = C.svgFormat;
assert.equal(C.done(p, 0, 'owner/repo@main'), true);
assert.equal(C.count(p, 'owner/repo@main'), 0);
const roughStrokes = [[{ x: 30, y: 20, width: 8 }, { x: 150, y: 65, width: 12 }]];
p.drafts[0].roughStrokes = roughStrokes;
p.drafts[0].roughUploaded = {
  title: p.title,
  signature: C.signature(roughStrokes),
  destination: 'owner/repo@main',
  svgFormat: C.svgFormat,
};
assert.equal(C.count(p, 'owner/repo@main'), 1);
assert.equal(C.count(p, 'other/repo@main'), 0);

assert.equal(C.strokeCount([[], ...strokes]), 1, 'only nonempty strokes count');
assert.equal(C.hasMatchingStrokeCounts({ strokes: [], roughStrokes: [] }), false);
assert.equal(C.hasMatchingStrokeCounts(p.drafts[0]), true);
const mismatchedDraft = {
  ...p.drafts[0],
  strokes: [...strokes, ...strokes],
};
mismatchedDraft.uploaded = {
  ...mismatchedDraft.uploaded,
  signature: C.signature(mismatchedDraft.strokes),
};
const mismatchedPaper = { ...p, drafts: { 0: mismatchedDraft } };
assert.equal(C.done(mismatchedPaper, 0, 'owner/repo@main', 'regular'), true);
assert.equal(C.done(mismatchedPaper, 0, 'owner/repo@main', 'rough'), false);
assert.equal(C.count(mismatchedPaper, 'owner/repo@main'), 0, 'legacy mismatched uploads are incomplete');

const repeatedPaper = { title: '重複字', chars: ['天', '地', '天', '天', '?', '?'], drafts: {} };
assert.deepEqual(repeatedPaper.chars.map((_, index) => C.filenameAt(repeatedPaper, index)), [
  '天.svg', '地.svg', '天-2.svg', '天-3.svg', 'U+3F.svg', 'U+3F-2.svg',
]);
const destination = 'owner/repo@main';
const repeatedUpload = { title: repeatedPaper.title, signature: C.signature(strokes), destination,
  svgFormat: C.svgFormat };
for (const index of [0, 2]) {
  const uploaded = { ...repeatedUpload };
  repeatedPaper.drafts[index] = { strokes, uploaded };
  assert.equal(C.done(repeatedPaper, index, destination), false, 'old repeated files need a new upload');
  uploaded.filename = C.filenameAt(repeatedPaper, index);
  assert.equal(C.done(repeatedPaper, index, destination), true);
  repeatedPaper.drafts[index].strokes = roughStrokes;
  assert.equal(C.done(repeatedPaper, index, destination), false, 'changed strokes need a new upload');
  assert.equal(C.filenameAt(repeatedPaper, index), uploaded.filename, 'rewriting preserves the filename');
}

p.drafts[0].strokes = [];
assert.equal(C.count(p, 'owner/repo@main'), 0);

// The downloaded dot, short line and retraced stroke are closed ink outlines.
const shortStrokes = [[{ x: 20, y: 20, width: 2 }, { x: 21, y: 20, width: 3 }]];
const retracedStroke = [[
  { x: 20, y: 30, width: 4 },
  { x: 80, y: 30, width: 6 },
  { x: 20, y: 30, width: 4 },
]];
const exported = C.svg([...strokes, ...shortStrokes, ...retracedStroke]);
assert.match(exported, /viewBox="0 0 300 300"/);
assert.doesNotMatch(exported, /<circle|stroke-width|NaN|Infinity/);
const paths = [...exported.matchAll(/<path d="([^"]+)" fill="black" fill-rule="nonzero"\/>/g)];
assert.equal(paths.length, 3);
for (const [, path] of paths) {
  assert.match(path, /^M .* Z$/);
}
assert.match(paths[2][1], / Z M /, 'a reversal retains filled ink on both sides');
assert.match(C.svg(strokes), /M 12 15 .*L 3 15/, 'dot keeps its position and diameter in the frame');
assert.throws(() => C.svg([[]]), /請先寫字/);

const point = (x, y, width = 12) => ({ x, y, width });
assert.deepEqual(C.clipSegment(point(380, 20, 8), point(420, 40, 12)), [
  point(380, 20, 8), point(400, 30, 10),
]);
assert.deepEqual(C.clipSegment(point(-40, 20), point(440, 20)), [
  point(0, 20), point(400, 20),
]);
assert.equal(C.clipSegment(point(420, 20), point(440, 60)), null);
assert.equal(C.clipSegment(point(20, -20), point(40, -20)), null);
const edgeStroke = [point(390, 40), point(400, 50),
  { ...point(400, 160), move: true }, point(380, 180)];
const edgeSvg = C.svg([edgeStroke]);
const [edgePath] = [...edgeSvg.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
assert.equal((edgePath.match(/M /g) ?? []).length, 2, 'one stroke may have two disjoint visible parts');
const edgePoints = [...edgePath.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
assert(edgePoints.some(([x]) => x === 300), 'a departing stroke reaches the frame edge');
assert(edgePoints.every(([x, y]) => x >= 0 && x <= 300 && y >= 0 && y <= 300));
assert(!edgePoints.some(([, y]) => y > 50 && y < 110), 'there is no line bridging the off-canvas excursion');
console.log('PASS: prompt import, duplicate characters, pressure, upload completion and frame-preserving SVG clipping.');
