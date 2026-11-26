# InkTrace Web 個人版

供個人書寫與字形資料管理使用。程式、SVG 與備份統一使用目前這個 Repo：`HsiaoSeanHS/InkTrace-Web` 的 `main` 分支，不必另外建立資料倉庫。

## 開始書寫

1. 在本機以 `python3 -m http.server 8000 --bind 127.0.0.1` 啟動，開啟 `http://localhost:8000`；也可使用自己的靜態網站部署網址。
2. 準備僅授權此 Repo、具有 Contents 讀寫權限並設有到期日的 fine-grained Personal Access Token，保存在個人密碼管理器。帳號與 Repo 已固定於 `github.js` 的 `repository`。開啟「個人資料管理」按「測試連線」，在單次授權視窗貼上 Token。
3. 選一份稿紙，先寫「硬筆書法」並上傳，再寫「毛筆書法」。兩邊筆畫數相同時才能上傳毛筆；兩邊都上傳後按「下一字」。

## iPad 單次 Token 授權

- 使用 iPad Safari 開啟自己的 **HTTPS GitHub Pages 網址**。本機開發僅允許安全的 localhost／loopback 網址，區網 HTTP 網址與 iframe 嵌入頁面不得輸入 Token。
- 每次上傳硬筆、上傳毛筆、備份到 Repo、從 Repo 還原或測試連線，都會重新詢問 Token。確認後由網頁直接完成該次操作，不需要手動上下載檔案。
- 確認輸入後立即清空密碼欄位，Token 只在該次操作的記憶體中使用；完成或失敗後清除設定物件中的參照，不寫入 localStorage、sessionStorage、IndexedDB、網址或備份。取消不會啟動 GitHub 操作；換頁離開時會清空輸入、使授權失效並嘗試中止請求。
- Token 視窗可用 iPad 密碼管理器貼上，沒有額外加密密碼或「記住此裝置」功能。網頁不能控制密碼管理器、剪貼簿或瀏覽器的儲存行為；JavaScript 也無法保證記憶體中的字串已被實體覆寫。
- 啟動時及每次授權前，會刪除舊版 `inktrace-github` 設定，不讀取或自動使用舊 Token。若刪除失敗，會阻止授權並顯示錯誤；稿紙與草稿不會因此刪除。這不會撤銷 GitHub 端的 Token；若懷疑曾洩漏，應在 GitHub 撤銷並重新建立。
- 已經送達 GitHub 的寫入不會因為離開頁面或逾時而撤銷。遇到連線錯誤，請先確認 Repo 結果再重試。

不持久保存憑證可省去本機加密與解鎖流程，但操作期間惡意腳本仍可能取得 Token。本版加入 CSP（只載入同來源腳本，連線限制為同來源與 GitHub API）、拒絕不安全的網頁環境，並對 GitHub 請求禁用快取與重新導向；這些措施不能取代可信任的程式碼與部署環境。Token 的 Repo Contents 寫入權限也可能影響程式檔案，前端固定資料路徑並不構成 GitHub 端的權限隔離。其他 Repo 的 SVG 不會自動搬移。

這是固定個人 Repo 的靜態工具，沒有登入或限制訪客瀏覽的機制；Repo 寫入需要有權限的 Token。若要限制網頁本身的存取，需使用有登入保護的部署環境。公開 Repo 的 SVG、備份與 Git 歷史也會公開。

## 備份與還原

在「個人資料管理」操作：

- **備份到 Repo**：將全部稿紙、題字、目前選字、硬筆與毛筆草稿、上傳進度寫入 `backups/latest.json`。再次備份會更新同一檔案，舊版本由 Git 歷史保留。備份為手動操作，上傳 SVG 不會自動備份草稿。
- **從 Repo 還原**：讀取同一 Repo 最新備份，確認日期及稿紙數量後，取代本機全部稿紙與草稿。適合換裝置或重建瀏覽器資料。
- **下載備份／從檔案還原**：無須 Token 即可下載或匯入完整 JSON 備份；也可從 Git 歷史下載舊版 `backups/latest.json` 後匯入。
- **復原上次還原**：取回最近一次還原前的本機資料。這份復原資料儲存在瀏覽器，重新整理後仍可使用；下一次成功還原會替換它，清除網站資料則會遺失。

備份格式有版本標記，還原前會驗證資料；不支援、損毀或超過 20 MB 的檔案不會寫入。Repo 下載途中即檢查大小並在超限時停止讀取。為限制 iPad 記憶體用量，每份備份最多 1,000 份稿紙、合計 100,000 個題字、100,000 筆筆畫及 500,000 個取樣點；筆跡座標限 ±10,000、寬度限 1,000，超出會拒絕匯入而不裁切原資料。資料取代與還原前快照使用同一個 IndexedDB transaction，寫入失敗會一起回復。備份不包含 Token、主題、畫布大小等裝置設定，也不重複包入 Repo 的 SVG。已使用「釋放本機筆跡」的字只備份上傳紀錄，原 SVG 仍保留在 `font_dataset/`。

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
node test_token_access.cjs
```

IndexedDB 還原、重新開啟、復原及 transaction 中止測試使用測試專用套件，可安裝在暫存目錄：

```sh
npm install --prefix /tmp/inktrace-backup-tests --ignore-scripts --no-audit --no-fund fake-indexeddb@6.2.5
NODE_PATH=/tmp/inktrace-backup-tests/node_modules node test_store.cjs
```
