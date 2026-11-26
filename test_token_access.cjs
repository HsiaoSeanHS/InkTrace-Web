const assert = require('node:assert/strict');
require('./github.js');
const T = require('./token-access.js');
class Dialog extends EventTarget {
  open = false;
  showModal() { this.open = true; }
  close() { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
}
const dialog = new Dialog();
const form = new EventTarget();
const input = { value: '', focus() {} };
const message = { textContent: '' };
const heading = { textContent: '' };
const access = T.create({ dialog, form, input, message, heading });
function submit(token = 'test_token_only') {
  input.value = token;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
}
async function main() {
  let held;
  let finish;
  const operation = access.run('上傳硬筆書法', config => {
    held = config;
    assert.equal(input.value, '', 'input cleared before network action');
    assert.equal(config.token, 'test_token_only');
    return new Promise(resolve => { finish = resolve; });
  });
  assert.ok(dialog.open);
  assert.equal(heading.textContent, '上傳硬筆書法');
  submit();
  await Promise.resolve();
  await assert.rejects(access.run('overlap', () => {}), /目前/);
  finish('uploaded');
  assert.equal(await operation, 'uploaded');
  assert.equal(held.token, '');
  assert.equal(held.configured, false);
  assert.equal(input.value, '');
  assert.equal(dialog.open, false);
  const failed = access.run('失敗', config => { held = config; throw Error('network failure'); });
  submit();
  await assert.rejects(failed, /network failure/);
  assert.equal(held.token, '');
  const invalid = access.run('驗證', () => 'ok');
  submit('bad');
  assert.ok(dialog.open);
  assert.equal(input.value, '');
  assert.match(message.textContent, /Token/);
  submit();
  assert.equal(await invalid, 'ok');
  const cancelled = access.run('取消', () => assert.fail('must not run'));
  input.value = 'typed_secret';
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  await assert.rejects(cancelled, { name: 'TokenCancelledError' });
  assert.equal(input.value, '');
  const close = access.run('關閉', () => assert.fail('must not run'));
  dialog.close();
  await assert.rejects(close, { name: 'TokenCancelledError' });
  const leaving = access.run('離開分頁', config => {
    held = config;
    return new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject(Error('aborted'))));
  });
  submit();
  await Promise.resolve();
  access.cancel();
  await assert.rejects(leaving, /aborted/);
  assert.equal(held.token, '');
  assert.equal(held.signal.aborted, true);
  // Cancel between submitting the form and starting the asynchronous action.
  const race = access.run('離開競態', () => assert.fail('must not run'));
  submit();
  access.cancel();
  await assert.rejects(race, { name: 'TokenCancelledError' });
  // Old plaintext settings are deleted without ever reading their contents.
  const storage = { getItem() { assert.fail('must not read legacy token'); },
    removeItem(key) { assert.equal(key, 'inktrace-github'); } };
  T.clearLegacy(storage);
  assert.throws(() => T.clearLegacy({ removeItem() { throw Error('storage blocked'); } }), /blocked/);
  globalThis.location = { protocol: 'http:', hostname: 'example.com' };
  globalThis.isSecureContext = false;
  await assert.rejects(access.run('insecure', () => assert.fail()), /HTTPS/);
  assert.equal(dialog.open, false);
  globalThis.location = { protocol: 'https:', hostname: 'example.com' };
  globalThis.isSecureContext = true;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('must not send'); };
  const G = globalThis.InkTraceGitHub;
  await assert.rejects(G.check({ owner: 'attacker', repo: 'repo', configured: true, token: 'test_token_only' }));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(G.check({ ...G.configure(G.repository.owner, G.repository.repo, 'test_token_only'), signal: aborted.signal }),
    { name: 'TokenCancelledError' });
  assert.equal(requests, 0);
  globalThis.top = {};
  await assert.rejects(access.run('embedded', () => assert.fail()), /嵌入/);
  assert.equal(dialog.open, false);
  delete globalThis.top;
  delete globalThis.location;
  delete globalThis.isSecureContext;
  console.log('PASS: per-operation Token lifetime, success/failure cleanup, cancellation, races, legacy removal and request security.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
