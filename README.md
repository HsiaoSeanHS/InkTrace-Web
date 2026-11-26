# InkTrace Web 個人版

供個人書寫與字形資料管理使用。程式、SVG 與備份統一使用目前這個 Repo：`HsiaoSeanHS/InkTrace-Web` 的 `main` 分支，不必另外建立資料倉庫。

## 開始書寫

1. 在本機以 `python3 -m http.server 8000` 啟動，開啟 `http://localhost:8000`；也可使用自己的靜態網站部署網址。
2. 開啟「個人資料管理」，填入只授權此 Repo、具有 Contents 讀寫權限的 fine-grained Personal Access Token。按「儲存」，再「測試連線」。帳號與 Repo 已固定於 `github.js` 的 `repository`。
3. 選一份稿紙，先寫「硬筆書法」並上傳，再寫「毛筆書法」。兩邊筆畫數相同時才能上傳毛筆；兩邊都上傳後按「下一字」。

Token 預設僅供目前分頁使用。勾選「記住此裝置」後才會保存於目前瀏覽器；Token 不會包含在備份中。原有本機稿紙與草稿會保留，舊設定若指向其他 Repo，請重新儲存 Token。其他 Repo 的 SVG 不會自動搬移。

這是固定個人 Repo 的靜態工具，沒有登入或限制訪客瀏覽的機制；Repo 寫入需要有權限的 Token。若要限制網頁本身的存取，需使用有登入保護的部署環境。公開 Repo 的 SVG、備份與 Git 歷史也會公開。

## 備份與還原

在「個人資料管理」操作：

- **備份到 Repo**：將全部稿紙、題字、目前選字、硬筆與毛筆草稿、上傳進度寫入 `backups/latest.json`。再次備份會更新同一檔案，舊版本由 Git 歷史保留。備份為手動操作，上傳 SVG 不會自動備份草稿。
- **從 Repo 還原**：讀取同一 Repo 最新備份，確認日期及稿紙數量後，取代本機全部稿紙與草稿。適合換裝置或重建瀏覽器資料。
- **下載備份／從檔案還原**：無須 Token 即可下載或匯入完整 JSON 備份；也可從 Git 歷史下載舊版 `backups/latest.json` 後匯入。
- **復原上次還原**：取回最近一次還原前的本機資料。這份復原資料儲存在瀏覽器，重新整理後仍可使用；下一次成功還原會替換它，清除網站資料則會遺失。

備份格式有版本標記，還原前會驗證資料；不支援、損毀或超過 20 MB 的檔案不會寫入。資料取代與還原前快照使用同一個 IndexedDB transaction，寫入失敗會一起回復。備份不包含 Token、主題、畫布大小等裝置設定，也不重複包入 Repo 的 SVG。已使用「釋放本機筆跡」的字只備份上傳紀錄，原 SVG 仍保留在 `font_dataset/`。

瀏覽器資料以裝置、瀏覽器及網址分開儲存，請在換裝置、換網址或清除網站資料前先備份。還原後不會自動補回刪除的預設稿紙；需要時可按「載入預設稿紙」。

## 常用操作

- 用「字格大小」調整兩欄畫布。英文字母顯示水平輔助線，數字可沿紅色基線對齊。
- 用各欄的「復原」或「清除」重寫；修改硬筆後需重新上傳才會解鎖毛筆。
- 「查看進度」可跳字：黃底表示已上傳一欄，綠底表示兩欄完成，圓點表示有草稿。
- SVG 存放於 `font_dataset/<稿紙名稱>/工整/` 與 `font_dataset/<稿紙名稱>/潦草/`。

## 驗證

以 Node.js 執行核心與備份／GitHub 模擬測試，不需要真實 Token，也不會寫入 GitHub：

```sh
node test_core.cjs
node test_backup.cjs
```

IndexedDB 還原、重新開啟、復原及 transaction 中止測試使用測試專用套件，可安裝在暫存目錄：

```sh
npm install --prefix /tmp/inktrace-backup-tests --ignore-scripts --no-audit --no-fund fake-indexeddb@6.2.5
NODE_PATH=/tmp/inktrace-backup-tests/node_modules node test_store.cjs
```
