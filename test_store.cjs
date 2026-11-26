// Test-only dependency: fake-indexeddb (see README).
const assert = require('node:assert/strict');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
globalThis.window = globalThis;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
require('./core.js');
require('./backup.js');
globalThis.InkTraceBuiltInPapers = [{ id: 'test', title: '內建', text: '天' }];
require('./store.js');
async function main() {
  await PaperStore.init();
  const original = InkTrace.paper('原始稿紙', '天地');
  original.drafts[0] = { strokes: [[{ x: 10, y: 20, width: 3 }]] };
  await PaperStore.put(original);
  await PaperStore.putDraft(original.id, 0, original.drafts[0]);
  const before = await PaperStore.all();
  const imported = InkTrace.paper('還原稿紙𠀀', '字𠀀');
  imported.selected = 1;
  imported.drafts[1] = { strokes: [[{ x: 300, y: 80, width: 2 }]], roughStrokes: [] };
  await PaperStore.replaceAll(InkTraceBackup.create([imported]));
  assert.deepEqual(await PaperStore.all(), [imported]);
  // A fresh database connection must keep the restored snapshot exactly as-is.
  await PaperStore.init();
  assert.deepEqual(await PaperStore.all(), [imported]);
  assert.equal(await PaperStore.undoRestore(), true);
  assert.deepEqual(await PaperStore.all(), before);
  assert.equal(await PaperStore.undoRestore(), false);
  assert.throws(() => PaperStore.replaceAll({ papers: [] }));
  assert.deepEqual(await PaperStore.all(), before);
  // Force a transaction abort after the replacement writes are queued.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('inktrace-web', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const prototype = Object.getPrototypeOf(db);
  const transaction = prototype.transaction;
  prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    if (Array.isArray(args[0]) && args[0].includes('meta') && args[1] === 'readwrite') {
      queueMicrotask(() => tx.abort());
    }
    return tx;
  };
  await assert.rejects(PaperStore.replaceAll(InkTraceBackup.create([imported])));
  prototype.transaction = transaction;
  assert.deepEqual(await PaperStore.all(), before, 'aborted restore keeps all original records');
  assert.equal(await PaperStore.undoRestore(), false, 'aborted restore leaves recovery record unchanged');
  await PaperStore.replaceAll(InkTraceBackup.create([]));
  assert.deepEqual(await PaperStore.all(), []);
  await PaperStore.init();
  assert.deepEqual(await PaperStore.all(), [], 'empty restored snapshot survives reopening');
  assert.equal(await PaperStore.undoRestore(), true);
  assert.deepEqual(await PaperStore.all(), before);
  console.log('PASS: IndexedDB replacement, drafts, reopening, undo, invalid input and transaction rollback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
