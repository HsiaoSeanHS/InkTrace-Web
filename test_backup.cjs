const assert = require('node:assert/strict');
require('./core.js');
const B = require('./backup.js');
require('./github.js');
const G = globalThis.InkTraceGitHub;
const paper = InkTrace.paper('中文𠀀稿紙', '天地𠀀');
paper.drafts[0] = {
  strokes: [[{ x: 10, y: 20, width: 3 }]],
  roughStrokes: [[{ x: -10, y: 500, width: 10, move: true }]],
  uploaded: { destination: 'HsiaoSeanHS/InkTrace-Web@main', at: 123, title: paper.title, signature: '[]' },
};
paper.drafts[1] = { releasedStrokeCount: 3, uploaded: { sha: 'abc' }, roughUploaded: { sha: 'def' } };
const backup = B.create([paper]);
assert.deepEqual(B.parse(JSON.stringify(backup)).papers, [paper]);
assert.deepEqual(B.create([]).papers, []);
assert.throws(() => B.parse('{broken'));
for (const mutate of [
  b => { b.version = 99; },
  b => { b.papers.push(b.papers[0]); },
  b => { b.papers[0].selected = 99; },
  b => { b.papers[0].chars = ['ab']; },
  b => { b.papers[0].drafts[3] = {}; },
  b => { b.papers[0].drafts[0].strokes[0][0].x = null; },
  b => { b.papers[0].drafts[0].strokes[0][0].width = -1; },
  b => { b.papers[0].drafts[0].strokes[0][0].x = 1e308; },
  b => { b.papers[0].drafts[0].strokes[0][0].width = 1e308; },
  b => { b.papers[0].drafts[0].strokes = Array.from({ length: 100001 }, () => []); },
  b => { b.papers[0].drafts[0].strokes = [Array(500001).fill({ x: 0, y: 0, width: 1 })]; },
  b => { b.papers = Array.from({ length: 1001 }, (_, i) => ({ ...b.papers[0], id: `paper-${i}` })); },
  b => { b.papers = Array.from({ length: 25 }, (_, i) => ({ ...b.papers[0], id: `paper-${i}`, chars: Array(4096).fill('天') })); },
]) {
  const damaged = structuredClone(backup);
  mutate(damaged);
  assert.throws(() => B.validate(damaged));
}
const withSecrets = structuredClone(backup);
withSecrets.token = 'secret';
withSecrets.papers[0].token = 'secret';
withSecrets.papers[0].drafts[0].uploaded.token = 'secret';
assert.ok(!JSON.stringify(B.validate(withSecrets)).includes('secret'));
assert.throws(() => B.parse(' '.repeat(B.maxBytes + 1)));
assert.throws(() => G.configure('another', 'repo', 'example_token'));
const config = G.configure(G.repository.owner, G.repository.repo, 'example_token');
async function main() {
  const calls = [];
  const responses = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    const response = responses.shift();
    assert.ok(response, 'unexpected request');
    return { ok: response.status < 300, status: response.status,
      json: async () => response.body, text: async () => response.body };
  };
  const ok = body => ({ status: 200, body });
  responses.push({ status: 404 }, ok({ content: { sha: 'new' } }));
  await G.backup(config, backup);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Accept, 'application/vnd.github.object+json');
  assert.equal(calls[1].method, 'PUT');
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://api.github.com/repos/HsiaoSeanHS/InkTrace-Web/contents/'));
    assert.equal(call.headers.Authorization, 'Bearer example_token');
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.referrerPolicy, 'no-referrer');
  }
  const created = JSON.parse(calls[1].body);
  assert.equal(created.sha, undefined);
  assert.equal(created.branch, 'main');
  assert.deepEqual(JSON.parse(Buffer.from(created.content, 'base64').toString('utf8')), backup);
  responses.push(ok({ type: 'file', sha: 'old' }), ok({ content: { sha: 'newer' } }));
  await G.backup(config, backup);
  assert.equal(JSON.parse(calls.at(-1).body).sha, 'old');
  responses.push(ok(JSON.stringify(backup)));
  assert.deepEqual(B.parse(await G.restore(config)), backup);
  assert.equal(calls.at(-1).headers.Accept, 'application/vnd.github.raw+json');
  responses.push(ok({ type: 'file', sha: 'old' }), { status: 409 });
  await assert.rejects(G.backup(config, backup), /衝突/);
  responses.push({ status: 401 });
  await assert.rejects(G.backup(config, backup), /Token/);
  responses.push(ok({ type: 'file', sha: 'old' }), ok({}));
  await assert.rejects(G.backup(config, backup), /未確認/);
  responses.push({ status: 404 }, ok({ permissions: { push: false } }), ok({ name: 'main' }));
  await assert.rejects(G.restore(config), error => error.code === 'BACKUP_NOT_FOUND' && /備份到 Repo/.test(error.message));
  responses.push({ status: 404 }, { status: 404 });
  await assert.rejects(G.restore(config), error => error.status === 404 && error.code !== 'BACKUP_NOT_FOUND');
  responses.push({ status: 404 }, ok({}), { status: 404 });
  await assert.rejects(G.restore(config), error => error.status === 404 && error.code !== 'BACKUP_NOT_FOUND');
  responses.push({ status: 401 });
  await assert.rejects(G.restore(config), error => error.status === 401);
  assert.equal(responses.length, 0);
  // Exercise actual response streams; over-limit downloads must be cancelled before parsing.
  let streamCancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(JSON.stringify(backup));
      const split = bytes.findIndex(byte => byte >= 128) + 1;
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  }));
  assert.deepEqual(B.parse(await G.restore(config)), backup, 'UTF-8 characters can cross chunk boundaries');
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { streamCancelled = true; },
  }));
  await assert.rejects(G.restore(config), /超過 20 MB/);
  assert.ok(streamCancelled);
  streamCancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() { streamCancelled = true; },
  }), { headers: { 'Content-Length': B.maxBytes + 1 } });
  await assert.rejects(G.restore(config), /超過 20 MB/);
  assert.ok(streamCancelled);
  globalThis.fetch = async () => new Response(new Uint8Array([0xff]));
  await assert.rejects(G.restore(config));
  console.log('PASS: backup validation, Unicode round-trip, secret exclusion, Repo create/update/restore and failure handling.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
