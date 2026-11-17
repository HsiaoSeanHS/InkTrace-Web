(function () {
  'use strict';

  let database;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(Error('此瀏覽器不支援草稿儲存。'));
        return;
      }

      const request = indexedDB.open('inktrace-web', 2);
      request.onupgradeneeded = event => {
        const upgradedDatabase = request.result;
        if (event.oldVersion === 0) {
          upgradedDatabase.createObjectStore('papers', { keyPath: 'id' });
          upgradedDatabase.createObjectStore('meta');
        }

        const drafts = upgradedDatabase.createObjectStore('drafts', {
          keyPath: ['paperId', 'characterIndex'],
        });
        if (event.oldVersion === 1) {
          const papers = request.transaction.objectStore('papers');
          const cursorRequest = papers.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              return;
            }
            const { drafts: previousDrafts = {}, ...paper } = cursor.value;
            for (const [index, draft] of Object.entries(previousDrafts)) {
              drafts.put({ paperId: paper.id, characterIndex: Number(index), draft });
            }
            cursor.update(paper);
            cursor.continue();
          };
        }
      };

      request.onerror = () => reject(Error('無法開啟草稿儲存，請檢查瀏覽器權限。'));
      request.onblocked = () => reject(Error('請關閉其他 InkTrace 分頁後重試。'));
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => database.close();
        resolve();
      };
    });
  }

  function runTransaction(storeNames, mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeNames, mode);
      const readResult = action(transaction);
      transaction.oncomplete = () => resolve(readResult?.());
      transaction.onerror = transaction.onabort = () => {
        reject(Error('草稿儲存失敗，請先下載 SVG。'));
      };
    });
  }

  function prepareBuiltInPapers() {
    const entries = window.InkTraceBuiltInPapers;
    if (!Array.isArray(entries)) {
      throw Error('找不到內建稿紙清單，請確認 papers/built-in.js 已載入。');
    }
    const ids = new Set();
    const titles = new Set();
    const now = Date.now();
    return entries.map(({ id, title, text }, index) => {
      if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || ids.has(id)) {
        throw Error(`內建稿紙的 ID 無效或重複（第 ${index + 1} 份）。`);
      }
      const paper = InkTrace.paper(title, text, { id: `builtin:${id}`, createdAt: now - index });
      if (titles.has(paper.title)) {
        throw Error(`內建稿紙名稱重複（${paper.title}）。`);
      }
      ids.add(id);
      titles.add(paper.title);
      return paper;
    });
  }

  async function init() {
    const builtIns = prepareBuiltInPapers();
    const isLocalPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    const stores = isLocalPreview ? ['papers', 'meta', 'drafts'] : ['papers', 'meta'];
    await openDatabase();
    await runTransaction(stores, 'readwrite', transaction => {
      const meta = transaction.objectStore('meta');
      const existing = transaction.objectStore('papers').getAll();
      existing.onsuccess = () => {
        const papersById = new Map(existing.result.map(paper => [paper.id, paper]));
        const titles = new Set(existing.result.map(paper => paper.title));
        for (const paper of builtIns) {
          const installed = meta.get(paper.id);
          installed.onsuccess = () => {
            if (installed.result && !isLocalPreview) {
              return;
            }
            const saved = papersById.get(paper.id);
            if (!saved && !titles.has(paper.title)) {
              putPaperRecord(transaction, paper);
            }
            if (isLocalPreview && saved?.title === paper.title &&
              (saved.chars.length !== paper.chars.length || saved.chars.some((char, i) => char !== paper.chars[i]))) {
              const drafts = transaction.objectStore('drafts').count(draftRange(paper.id));
              drafts.onsuccess = () => {
                if (drafts.result === 0) {
                  putPaperRecord(transaction, { ...saved, chars: paper.chars, selected: 0 });
                }
              };
            }
            if (!installed.result) {
              meta.put(true, paper.id);
            }
          };
        }
      };
    });
  }

  function putPaperRecord(transaction, paper) {
    const { drafts, ...metadata } = paper;
    transaction.objectStore('papers').put(metadata);
  }

  function draftRange(paperId) {
    return IDBKeyRange.bound([paperId, 0], [paperId, Number.MAX_SAFE_INTEGER]);
  }

  function all() {
    return runTransaction(['papers', 'drafts'], 'readonly', transaction => {
      const papers = transaction.objectStore('papers').getAll();
      const drafts = transaction.objectStore('drafts').getAll();
      return () => {
        const savedPapers = papers.result;
        const byId = new Map(savedPapers.map(paper => {
          paper.drafts = {};
          return [paper.id, paper];
        }));
        for (const { paperId, characterIndex, draft } of drafts.result) {
          const paper = byId.get(paperId);
          if (paper) {
            paper.drafts[characterIndex] = draft;
          }
        }
        return savedPapers;
      };
    });
  }

  window.PaperStore = {
    init,
    all,
    put: paper => runTransaction('papers', 'readwrite', transaction => {
      putPaperRecord(transaction, paper);
    }),
    putDraft: (paperId, characterIndex, draft) => {
      return runTransaction('drafts', 'readwrite', transaction => {
        transaction.objectStore('drafts').put({ paperId, characterIndex, draft });
      });
    },
    remove: paperId => runTransaction(['papers', 'drafts'], 'readwrite', transaction => {
      transaction.objectStore('papers').delete(paperId);
      transaction.objectStore('drafts').delete(draftRange(paperId));
    }),
  };
})();
