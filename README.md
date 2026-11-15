# InkTrace Web

同一個題字左右各寫一份。先寫左欄工整版並上傳，成功後再寫右欄潦草版。兩欄各自保存、復原、清除與上傳。

## 部署到 GitHub Pages

1. 解壓縮 `inktrace-web.zip`，將內層 `inktrace-web` 資料夾的內容放進網站倉庫根目錄。`index.html` 與 `.nojekyll` 都應在根目錄。
2. 開啟該倉庫的 **Settings → Pages**，選 **Deploy from a branch**，再選 `main` 和 `/ (root)`。
3. 部署完成後，開啟 Pages 顯示的網址。手機與平板可使用同一網址。

頁面載入、筆跡保存及 300×300 SVG 匯出都由瀏覽器處理。使用相對資源路徑，支援 GitHub Pages 的 `/<repo>/` 專案子目錄。部署包內是靜態檔案。原工作資料夾的 `python app.py` 仍可提供本機預覽。

[GitHub Pages 建立方式](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 書寫與灰字

- 左欄使用內附的 Noto Sans TC Thin 100，為思源黑體同系的繁體版本。
- 右欄固定使用 `fonts/ShoujinTi_GBK.ttf`（方正瘦金書 GBK）。字型載入失敗或沒有該題字時，右欄留白，仍可書寫。
- 灰字依可見輪廓置中，長邊約佔字格 85%。兩欄共用題字、粗細、筆壓與提示開關。每欄的復原、清除及上傳只作用於該欄。
- 桌面和行動裝置保留並排畫布。畫布依視窗尺寸縮放，筆跡以固定的 400×400 邏輯座標保存。
- 「僅用觸控筆書寫」預設關閉，手指和觸控筆都可以寫。開啟後，畫布只接收觸控筆。「提示」開關控制兩欄的灰色參考字。
- 稿紙可手動新增、匯入 UTF-8 TXT 或貼上包含 `title` 與 `text` 的 JSON。草稿存於該網站網址的 IndexedDB。原本同網址的單欄草稿會出現在左欄。從 localhost 改用 Pages 時，兩個網址各有自己的草稿。

## SVG 與 GitHub 上傳

每欄可下載自己的 300×300 SVG，例如 `工整-天.svg` 或 `潦草-天.svg`。「上傳 GitHub」使用同樣的 SVG 格式。筆跡參考 `drawAndMorph-main` 的輪廓做法，每筆輸出為黑色填滿的封閉 `<path>`，背景透明。

若要上傳，請在「GitHub 設定」填入自己的帳號、資料倉庫與具有該倉庫 Contents 讀寫權限的 fine-grained token。倉庫需有 `main` 分支。Token 保存在目前頁面的記憶體，重新整理後需要重新輸入。帳號與倉庫名稱可記住。

每欄上方的進度條顯示目前題字的上傳狀態（尚未上傳、上傳中、上傳完成）。左欄上傳成功才解鎖同一個字的右欄。修改已上傳的工整筆跡會重新鎖定右欄，右欄草稿會保留。頂部的「查看進度」以黃色標示只上傳一種筆跡的字，兩種都上傳後顯示綠色。首頁以兩欄均已上傳的字數計算稿紙進度。

書寫頁的「GitHub」按鈕會開啟設定中的資料倉庫。點選左上角的 InkTrace 標誌可回稿紙首頁。

升級後，舊格式的上傳紀錄會顯示為待上傳。用目前的草稿再按一次「上傳 GitHub」，即可更新為封閉輪廓。

- 工整筆跡使用原路徑 `font_dataset/稿紙名稱/字.svg`。
- 潦草筆跡使用 `font_dataset/稿紙名稱/潦草/字.svg`。

同一路徑重傳會更新原檔。稿紙含重複題字時，同一欄仍對應同一遠端檔案。資料倉庫可與部署網站的倉庫分開。

[GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

## 原始碼與驗證

畫布、SVG 與草稿保存採 JavaScript。參考 `drawAndMorph-main` 的瀏覽器 Canvas 指標事件及 SVG 匯出方式，沿用 InkTrace 原有稿紙與筆跡格式。

JavaScript、HTML 和 CSS 使用兩個空格縮排，Python 使用四個空格。JavaScript 變數與函式採 `camelCase`，Python 採 `snake_case`，HTML 的 ID 與 CSS 類別採 `kebab-case`。既有草稿欄位名稱用於讀取瀏覽器已保存的資料。

開發資料夾可執行 `node test_core.cjs` 驗證草稿與 SVG 輸出。Apple Pencil 的書寫效果需在 iPad 實測。

原始碼採 MIT。Noto Sans TC 的授權見 `fonts/OFL.txt` 與 `fonts/NOTICE.txt`。公開部署方正瘦金書 GBK 前，請確認持有的授權涵蓋網站嵌入。 [方正字庫授權條款](https://www.foundertype.com/index.php/About/userAuth.html)
