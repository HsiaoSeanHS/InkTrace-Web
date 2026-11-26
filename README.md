# InkTrace Web 個人版

供個人書寫與字形資料管理使用。程式、SVG 與備份統一使用目前這個 Repo：`HsiaoSeanHS/InkTrace-Web` 的 `main` 分支，不必另外建立資料倉庫。

## 開始書寫

1. 在本機以 `python3 -m http.server 8000 --bind 127.0.0.1` 啟動，開啟 `http://localhost:8000`；也可使用自己的靜態網站部署網址。
2. 準備僅授權此 Repo、具有 Contents 讀寫權限並設有到期日的 fine-grained Personal Access Token，保存在個人密碼管理器。帳號與 Repo 已固定於 `github.js` 的 `repository`。首次開啟「個人資料管理」按「設定／解鎖 Token」，輸入 Token 及至少 12 個字元的解鎖密碼，再按「測試連線」。
3. 選一份稿紙，先寫「硬筆書法」，再寫「毛筆書法」。兩欄筆畫數相同後，按共用的「上傳並下一字」即可一次操作上傳兩個 SVG；兩欄上傳與本機紀錄儲存都成功後，自動切換到下一字。最後一字會顯示完成訊息。若其中一欄失敗，會留在本字並保留成功紀錄，重試時只補傳缺少的檔案。

## iPad 加密 Token 與連續上傳

- 使用 iPad Safari 開啟自己的 **HTTPS GitHub Pages 網址**。本機開發僅允許安全的 localhost／loopback 網址；區網 HTTP 與 iframe 嵌入頁面不得輸入 Token。
- 首次設定輸入 Token、解鎖密碼及確認密碼。解鎖密碼需至少 12 個字元，建議使用獨立的長密碼。網頁以 Web Crypto 的 PBKDF2-SHA256（600,000 次、隨機 16-byte salt）衍生不可匯出的 AES-256-GCM 金鑰；每次保存使用隨機 12-byte IV，並將密文綁定目前 Repo。
- Local Storage 的 `inktrace-token-vault-v1` 僅保存版本、演算法、衍生參數、salt、IV、Repo 識別及密文。**不保存明文 Token、密碼或解密金鑰**。Token 與密碼也不納入稿紙備份。
- 每次重新開啟或重新整理，只需輸入一次解鎖密碼。解鎖後在分頁記憶體保留金鑰，於每次上傳、Repo 備份／還原、測試連線時才短暫解密 Token；操作結束或失敗後清空 Token 設定物件中的參照。硬筆、毛筆和後續字元可連續上傳，網路暫時失敗後重試也不必重新輸入 Token。
- 頂端「鎖定 Token」會釋放金鑰並嘗試中止尚未完成的 GitHub 操作。閒置 15 分鐘、離開頁面、切到背景超過 5 分鐘後返回，或另一分頁更換／清除加密 Token 時，也會鎖定。收到 GitHub 401（憑證無效或過期）時會鎖定；需到設定更換有效 Token。
- 「更換 Token／密碼」可重新設定，成功加密寫入前會保留舊密文；取消設定不會刪除舊密文。「清除加密 Token」不影響稿紙與草稿。**忘記密碼無法找回原 Token，需清除後重新設定。**
- 舊版 `inktrace-github` 明文設定會刪除，不讀取或自動使用其中的 Token。清除舊設定失敗會阻止授權。網頁清除設定不會撤銷 GitHub 端的 Token；若懷疑曾洩漏，應在 GitHub 撤銷並重建。
- 加密可降低儲存資料被複製時直接取得 Token 的風險；弱密碼仍可能被離線猜測。解鎖後惡意頁面腳本仍可能利用記憶體中的金鑰取得或使用 Token，因此加密無法取代可信任的程式碼與部署環境。JavaScript 也無法保證字串已被實體覆寫；瀏覽器的密碼管理器與剪貼簿由裝置管理。
- 已送達 GitHub 的寫入不會因為離開頁面或逾時而撤銷。遇到連線錯誤，請先確認 Repo 結果再重試；加密授權不會修復網路或權限問題。

本版保留 CSP（同來源腳本，連線限制為同來源與 GitHub API）、HTTPS／嵌入頁面檢查、禁用 API 快取及重新導向。Token 的 Repo Contents 寫入權限也可能影響程式檔案，前端固定資料路徑並不構成 GitHub 端的權限隔離。其他 Repo 的 SVG 不會自動搬移。

這是固定個人 Repo 的靜態工具，沒有登入或限制訪客瀏覽的機制；Repo 寫入需要有權限的 Token。若要限制網頁本身的存取，需使用有登入保護的部署環境。公開 Repo 的 SVG、備份與 Git 歷史也會公開。

## 備份與還原

在「個人資料管理」操作：

- **備份到 Repo**：將全部稿紙、題字、目前選字、硬筆與毛筆草稿、上傳進度寫入 `backups/latest.json`。再次備份會更新同一檔案，舊版本由 Git 歷史保留。備份為手動操作，上傳 SVG 不會自動備份草稿。
- **從 Repo 還原**：讀取同一 Repo 最新備份，確認日期及稿紙數量後，取代本機全部稿紙與草稿。適合換裝置或重建瀏覽器資料。若顯示「Repo 尚無完整備份」，請先在仍保有進度的原裝置按「備份到 Repo」；只有已上傳的 SVG，無法透過此功能還原完整草稿與進度。
- **下載備份／從檔案還原**：無須 Token 即可下載或匯入完整 JSON 備份；也可從 Git 歷史下載舊版 `backups/latest.json` 後匯入。
- **復原上次還原**：取回最近一次還原前的本機資料。這份復原資料儲存在瀏覽器，重新整理後仍可使用；下一次成功還原會替換它，清除網站資料則會遺失。

備份格式有版本標記，還原前會驗證資料；不支援、損毀或超過 20 MB 的檔案不會寫入。Repo 下載途中即檢查大小並在超限時停止讀取。為限制 iPad 記憶體用量，每份備份最多 1,000 份稿紙、合計 100,000 個題字、100,000 筆筆畫及 500,000 個取樣點；筆跡座標限 ±10,000、寬度限 1,000，超出會拒絕匯入而不裁切原資料。資料取代與還原前快照使用同一個 IndexedDB transaction，寫入失敗會一起回復。備份不包含 Token、主題、畫布大小等裝置設定，也不重複包入 Repo 的 SVG。已使用「釋放本機筆跡」的字只備份上傳紀錄，原 SVG 仍保留在 `font_dataset/`。

瀏覽器資料以裝置、瀏覽器及網址分開儲存，請在換裝置、換網址或清除網站資料前先備份。還原後不會自動補回刪除的預設稿紙；需要時可按「載入預設稿紙」。

## 常用操作

- 用「字格大小」調整兩欄畫布。英文字母顯示水平輔助線，數字可沿紅色基線對齊。
- 用各欄的「復原」或「清除」重寫；硬筆有筆跡即可書寫毛筆，不必先上傳。毛筆筆畫數不可超過目前硬筆筆畫數，兩欄一致才能上傳。單次操作會依序寫入兩個 SVG；部分成功時可重試補傳。完整稿紙備份仍需另按「備份到 Repo」。
- 「查看進度」可跳字：黃底表示已上傳一欄，綠底表示兩欄完成，圓點表示有草稿。
- SVG 存放於 `font_dataset/<稿紙名稱>/工整/` 與 `font_dataset/<稿紙名稱>/潦草/`。

## 驗證

以 Node.js 執行核心與備份／GitHub 模擬測試，不需要真實 Token，也不會寫入 GitHub：

```sh
node test_core.cjs
node test_backup.cjs
node test_pair_upload.cjs
node test_token_vault.cjs
node test_token_access.cjs
```

IndexedDB 還原、重新開啟、復原及 transaction 中止測試使用測試專用套件，可安裝在暫存目錄：

```sh
npm install --prefix /tmp/inktrace-backup-tests --ignore-scripts --no-audit --no-fund fake-indexeddb@6.2.5
NODE_PATH=/tmp/inktrace-backup-tests/node_modules node test_store.cjs
```
