const assert = require('node:assert/strict');
require('./github.js');
const V = require('./token-vault.js');
const token = 'example_private_token';
const password = 'a long private passphrase';
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const vault = () => V.create(() => storage);
async function main() {
  const first = vault();
  assert.equal(first.hasSaved(), false);
  await assert.rejects(first.save(token, 'short', 'short'), /12/);
  await assert.rejects(first.save(token, password, 'different'), /不一致/);
  assert.equal(values.size, 0);
  await first.save(token, password, password);
  assert.ok(first.isUnlocked());
  const raw = storage.getItem(V.storageKey);
  assert.ok(!raw.includes(token));
  assert.ok(!raw.includes(password));
  assert.equal(JSON.parse(raw).iterations, 600000);
  assert.equal(await first.token(), token);
  assert.equal(await first.token(), token);
  first.lock();
  await assert.rejects(first.token(), /鎖定/);
  const second = vault();
  assert.ok(second.hasSaved());
  assert.equal(second.isUnlocked(), false, 'reopening never auto-unlocks');
  await assert.rejects(second.unlock('wrong password'), /密碼不正確/);
  assert.equal(second.isUnlocked(), false);
  await second.unlock(password);
  assert.equal(await second.token(), token);
  // Each encryption uses fresh salt and IV, even for the same credentials.
  await second.save(token, password, password);
  const changed = JSON.parse(storage.getItem(V.storageKey));
  assert.notEqual(changed.salt, JSON.parse(raw).salt);
  assert.notEqual(changed.iv, JSON.parse(raw).iv);
  second.lock();
  for (const mutate of [
    data => { data.iterations = 1e10; },
    data => { data.owner = 'another-user'; },
    data => { data.version = 2; },
    data => { data.iv = 'a'.repeat(10000); },
    data => { data.salt = 'AA=='; },
    data => { const b = Buffer.from(data.ciphertext, 'base64'); b[0] ^= 1; data.ciphertext = b.toString('base64'); },
  ]) {
    const tampered = JSON.parse(raw); mutate(tampered);
    storage.setItem(V.storageKey, JSON.stringify(tampered));
    await assert.rejects(vault().unlock(password));
  }
  storage.setItem(V.storageKey, raw);
  const racing = vault();
  const saving = racing.save(token, password, password);
  racing.lock();
  await assert.rejects(saving, /鎖定/);
  assert.equal(storage.getItem(V.storageKey), raw, 'cancelling encryption preserves previous saved record');
  const unlocking = racing.unlock(password);
  racing.lock();
  await assert.rejects(unlocking, /鎖定/);
  await racing.unlock(password);
  storage.removeItem(V.storageKey);
  assert.equal(racing.isUnlocked(), false, 'cross-tab removal invalidates cached key');
  storage.setItem(V.storageKey, raw);
  const blocked = V.create(() => ({ ...storage, setItem() { throw Error('storage blocked'); } }));
  await assert.rejects(blocked.save(token, password, password), /blocked/);
  assert.equal(blocked.isUnlocked(), false);
  assert.equal(storage.getItem(V.storageKey), raw);
  racing.forget();
  assert.equal(values.size, 0);
  console.log('PASS: real PBKDF2/AES-GCM, no stored plaintext, reopen/unlock, tampering, fresh randomness, cancellation and storage failures.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
