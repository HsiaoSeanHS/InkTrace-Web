const assert = require('node:assert/strict');
const C = require('./core.js');
const P = require('./pair-upload.js');
const destination = 'HsiaoSeanHS/InkTrace-Web@main';
const strokes = [[{ x: 20, y: 30, width: 3 }]];
function paper() {
  const p = C.paper('測試稿紙', '天天');
  p.drafts[0] = { strokes: structuredClone(strokes), roughStrokes: structuredClone(strokes) };
  p.drafts[1] = structuredClone(p.drafts[0]);
  return p;
}
function harness(p, { failSide, failDraftAt, failPosition } = {}) {
  const uploaded = [], progress = [], saved = [];
  let draftCalls = 0, checks = 0, position;
  globalThis.PaperStore = {
    async putDraft(id, index, draft) {
      assert.equal(id, p.id);
      draftCalls++;
      if (draftCalls === failDraftAt) throw Error('quota');
      saved.push(structuredClone(draft));
    },
    async put(metadata) {
      if (failPosition) throw Error('quota');
      position = metadata.selected;
    },
  };
  globalThis.InkTraceGitHub = {
    async check() { checks++; },
    async upload(config, title, character, side, svg, filename) {
      assert.equal(title, p.title);
      assert.equal(character, '天');
      assert.match(svg, /<svg /);
      uploaded.push({ side, filename });
      if (side === failSide) throw Error('network failure');
      return { sha: `sha-${side}` };
    },
  };
  return { uploaded, progress, saved, get checks() { return checks; }, get position() { return position; },
    run(index = 0) { return P.upload({ paper: p, index, destination, config: {}, onProgress: side => progress.push(side) }); } };
}
async function main() {
  let p = paper(), h = harness(p);
  assert.deepEqual(await h.run(), { nextIndex: 1 });
  assert.deepEqual(h.uploaded.map(item => item.side), ['regular', 'rough']);
  assert.equal(h.checks, 1);
  assert.equal(h.position, 1);
  assert.equal(p.selected, 1);
  assert.ok(C.pairDone(p, 0, destination));
  assert.ok(h.saved[1].uploaded);
  assert.equal(h.saved[1].roughUploaded, undefined, 'first confirmed upload persisted separately');
  h = harness(p);
  assert.deepEqual(await h.run(1), { nextIndex: null });
  assert.deepEqual(h.uploaded.map(item => item.filename), ['天-2.svg', '天-2.svg']);
  assert.equal(h.position, 1);
  p = paper(); p.drafts[0].roughStrokes = [];
  h = harness(p);
  await assert.rejects(h.run(), /筆畫數相同/);
  assert.equal(h.uploaded.length, 0);
  assert.equal(h.checks, 0);
  assert.equal(p.selected, 0);
  p = paper(); h = harness(p, { failSide: 'regular' });
  await assert.rejects(h.run(), /network failure/);
  assert.equal(p.selected, 0);
  assert.equal(h.uploaded.length, 1);
  assert.equal(p.drafts[0].uploaded, undefined);
  p = paper(); h = harness(p, { failSide: 'rough' });
  await assert.rejects(h.run(), /network failure/);
  assert.equal(p.selected, 0);
  assert.equal(h.position, undefined);
  assert.ok(C.done(p, 0, destination));
  assert.equal(p.drafts[0].roughUploaded, undefined);
  h = harness(p);
  assert.deepEqual(await h.run(), { nextIndex: 1 });
  assert.deepEqual(h.uploaded.map(item => item.side), ['rough'], 'retry only uploads missing board');
  p = paper(); h = harness(p, { failDraftAt: 1 });
  await assert.rejects(h.run(), /本機/);
  assert.equal(h.checks, 0, 'do not send remote writes if drafts cannot be persisted');
  p = paper(); h = harness(p, { failDraftAt: 3 });
  await assert.rejects(h.run(), /本機/);
  assert.ok(C.pairDone(p, 0, destination));
  assert.ok(P.needsSave(p.drafts[0]), 'local-save retry remains available when revisiting the draft');
  assert.equal(p.selected, 0, 'failed local completion save prevents advancement');
  h = harness(p);
  assert.deepEqual(await h.run(), { nextIndex: 1 });
  assert.equal(h.uploaded.length, 0, 'retry local save without reuploading confirmed files');
  assert.equal(h.checks, 0);
  assert.equal(P.needsSave(p.drafts[0]), false);
  p = paper(); h = harness(p, { failPosition: true });
  await assert.rejects(h.run(), /選字位置/);
  assert.equal(p.selected, 0);
  h = harness(p);
  await h.run();
  assert.equal(h.uploaded.length, 0);
  assert.equal(p.selected, 1);
  console.log('PASS: paired uploads, next-character persistence, last/repeated characters, count validation and partial/network/storage retries.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
