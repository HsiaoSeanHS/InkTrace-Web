const assert = require('node:assert/strict');
require('./github.js');
const V = require('./token-vault.js');
const T = require('./token-access.js');
class Dialog extends EventTarget {
  open = false;
  showModal() { this.open = true; }
  close() { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
}
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const field = () => ({ value: '', focus() {} });
const dialog = new Dialog();
const form = new EventTarget();
const input = field(), password = field(), confirmation = field();
const setupFields = {}, confirmationField = {}, submitButton = {};
const message = { textContent: '' }, heading = { textContent: '' };
let clock = 1000;
const access = T.create({ dialog, form, input, password, confirmation, setupFields, confirmationField, submitButton, message, heading,
  vault: V.create(() => storage), now: () => clock, idleMs: 1000 });
const secret = 'my private passphrase';
async function submit(token = 'test_token_only', pass = secret, repeated = secret) {
  input.value = token; password.value = pass; confirmation.value = repeated;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(input.value, '');
  assert.equal(password.value, '');
  assert.equal(confirmation.value, '');
  const until = Date.now() + 5000;
  while (submitButton.disabled && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(submitButton.disabled, false);
}
async function main() {
  let held;
  const first = access.run('硬筆', config => { held = config; return 'uploaded'; });
  assert.ok(dialog.open);
  assert.equal(setupFields.hidden, false);
  await assert.rejects(access.run('overlap', () => {}), /目前/);
  await submit('bad');
  assert.ok(dialog.open);
  assert.match(message.textContent, /Token/);
  await submit();
  assert.equal(await first, 'uploaded');
  assert.equal(held.token, '');
  assert.equal(held.configured, false);
  assert.ok(access.isUnlocked());
  // The second board and subsequent characters must not prompt again.
  assert.equal(await access.run('毛筆', config => {
    assert.equal(dialog.open, false);
    assert.equal(config.token, 'test_token_only');
    held = config;
    return 'brush uploaded';
  }), 'brush uploaded');
  assert.equal(held.token, '');
  await assert.rejects(access.run('network failure', config => { held = config; throw Error('network failure'); }), /network failure/);
  assert.equal(held.token, '');
  assert.ok(access.isUnlocked(), 'a transient network failure does not force Token reentry');
  access.lock();
  assert.equal(access.isUnlocked(), false);
  const unlock = access.run('備份', () => 'backup');
  assert.ok(dialog.open);
  assert.equal(setupFields.hidden, true);
  assert.equal(confirmationField.hidden, true);
  await submit('', 'incorrect');
  assert.ok(dialog.open);
  assert.match(message.textContent, /密碼不正確/);
  await submit('', secret);
  assert.equal(await unlock, 'backup');
  clock += 1001;
  assert.equal(access.isUnlocked(), false, 'idle deadline enforced even when timers are suspended');
  const cancelled = access.run('取消', () => assert.fail());
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  await assert.rejects(cancelled, { name: 'TokenCancelledError' });
  const close = access.run('關閉', () => assert.fail());
  dialog.close();
  await assert.rejects(close, { name: 'TokenCancelledError' });
  const racing = access.run('取消加密', () => assert.fail());
  input.value = 'replacement_token'; password.value = secret;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  access.lock();
  await assert.rejects(racing, { name: 'TokenCancelledError' });
  while (submitButton.disabled) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(access.isUnlocked(), false);
  const again = access.run('解鎖', () => {});
  await submit('', secret);
  await again;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const leaving = access.run('離開', config => {
    held = config; started();
    return new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject(Error('aborted'))));
  });
  await ready;
  access.cancel();
  await assert.rejects(leaving, /aborted/);
  assert.equal(held.token, '');
  assert.equal(held.signal.aborted, true);
  const authFailure = access.run('Token 過期', () => { const error = Error('expired'); error.status = 401; throw error; });
  const authRejected = assert.rejects(authFailure, /expired/);
  await submit('', secret);
  await authRejected;
  assert.equal(access.isUnlocked(), false);
  const previous = storage.getItem(V.storageKey);
  const replacement = access.run('更換', () => {}, true);
  assert.equal(setupFields.hidden, false);
  await submit('new_private_token');
  await replacement;
  assert.notEqual(storage.getItem(V.storageKey), previous);
  access.forget();
  assert.equal(values.size, 0);
  T.clearLegacy({ getItem() { assert.fail('must not read old plaintext'); }, removeItem(key) { assert.equal(key, 'inktrace-github'); } });
  globalThis.location = { protocol: 'http:', hostname: 'example.com' };
  globalThis.isSecureContext = false;
  await assert.rejects(access.run('insecure', () => assert.fail()), /HTTPS/);
  globalThis.location.protocol = 'https:'; globalThis.isSecureContext = true; globalThis.top = {};
  await assert.rejects(access.run('embedded', () => assert.fail()), /嵌入/);
  delete globalThis.location; delete globalThis.isSecureContext; delete globalThis.top;
  access.lock();
  console.log('PASS: encrypted setup/unlock, uninterrupted paired uploads, cleanup, lock/idle, cancellation races, replacement and auth failure.');
}
main().catch(error => { access.lock(); console.error(error); process.exitCode = 1; });
