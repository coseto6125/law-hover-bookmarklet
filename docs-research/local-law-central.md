# 台灣「中部」地方法規查詢系統技術規格調查

調查日期：2026-08-26 / 2026-08-27（UTC+8）
方法：playwright (chromium 1.62.1) 實際載入頁面 + `page.evaluate()` querySelector 驗證，
以及 `curl -I` 取標頭。所有請求間隔 ≥1.3 秒。
全部結論皆有實測輸出佐證，未實測者明確標示。

---

## 0. 最重要的結論（先講）

**七站全部是同一套系統**：內政部/研考體系的「**主管法規共用系統**」（GLRS，
Government Law Retrieval System，ASP.NET WebForms）。
七站頁尾皆顯示 **系統版本：114.11.28**（僅「系統更新日期」不同），
頁面控制項命名完全一致（`ctl00$cp_content$...`）。

因此**一套 bookmarklet 邏輯可同時支援全部七站**，只要參數化 base URL。

差異只有兩點，且**與縣市無關、與「該筆法規的資料錄入方式」有關**（詳見第 8 節）：

| 差異 | 說明 |
|---|---|
| **DOM 模式** | `table` 模式（結構化，逐條一個 `<tr>`）vs `blob` 模式（整部法規塞在一個 `<div>` 內，靠 `<br>` 分行） |
| **條號書寫** | 阿拉伯數字 `第 1 條` vs 中文數字 `第一條` / `第　一　條`（全形空格） |

**同一站內兩種模式並存**，不能用「站台」判斷，必須用 DOM 探測（見第 9 節建議）。

---

## 1. 新竹縣

- **系統**：新竹縣政府主管法規共用系統
- **Base URL**：`https://hclaw.hsinchu.gov.tw/law/`
  （注意有 `/law/` 路徑前綴，`law.hsinchu.gov.tw` 這個網域**不存在**，DNS 解析失敗）
- **狀態**：✅ 可行

### 1.1 條文頁網址格式

```
https://hclaw.hsinchu.gov.tw/law/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 `document.title` |
|---|---|
| `https://hclaw.hsinchu.gov.tw/law/LawContent.aspx?id=GL000683` | 新竹縣政府主管法規共用系統-法規內容-新竹縣殯葬管理自治條例 |
| `https://hclaw.hsinchu.gov.tw/law/LawContent.aspx?id=GL000200` | 新竹縣政府主管法規共用系統-法規內容-新竹縣原住民族基礎建設工程預算經費執行原則 |

### 1.2 DOM 結構

實測 10 筆法規：**10 筆全為 `blob` 模式，0 筆 table 模式**。

- 外層容器：`div.law-reg-content.law-article`
- 條文容器：`#ctl00_cp_content_divLawContent08`（`DIV`，`class="ClearCss"`）
- **沒有「單一條文」的 selector**：整部法規的所有條文都在這一個 div 內，
  以 `<br>` 換行，條號只是純文字，**沒有任何包住單條的元素**。

實測 `document.querySelector('#ctl00_cp_content_divLawContent08').outerHTML` 節錄
（GL000683 新竹縣殯葬管理自治條例）：

```html
<div id="ctl00_cp_content_divLawContent08" class="ClearCss">&nbsp;&nbsp;&nbsp;第一章 總則<br>
第 &nbsp;一 &nbsp;條 &nbsp; &nbsp;為規範新竹縣（以下簡稱本縣）公、私立殯葬設施之設置、經營管理及殯葬<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;服務業、殯葬行為之管理輔導及裁罰，特制定本自治條例。<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;本縣殯葬之管理，除法律或中央法規另有規定外，適用本自治條例之規定。<br>
第 &nbsp;二 &nbsp;條 &nbsp; &nbsp;本自治條例所稱主管機關：在縣為新竹縣政府（以下簡稱本府）；在鄉（鎮、<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;市）為鄉（鎮、市）公所（以下簡稱各公所）。&nbsp;<br>
...
```

➜ **必須用文字切割（regex on innerText / innerHTML）取單條，無法用 selector。**

### 1.3 法規名稱 → ID

搜尋端點（GET，可直接組網址）：

```
https://hclaw.hsinchu.gov.tw/law/LawResult.aspx?NLawTypeID=all&KW={URL編碼關鍵字}&name=1&content=1&now=1&fei=1
```

參數意義（實測歸納）：
- `KW` 關鍵字；`name=1` 搜法規名稱；`content=1` 搜條文內容
- `now=1` 現行法規；`fei=1` 含廢止/停止適用
- **`name` 與 `content` 至少要有一個為 1**，否則回「請『正確』勾選您所要檢索的檢索項目！」錯誤頁（實測踩過）

從結果頁取 ID（實測）：

```js
document.querySelectorAll('a[href*="LawContent.aspx?id="]')
// -> href="LawContent.aspx?id=GL000200&kw=%e6%96%b0%e7%ab%b9%e7%b8%a3"
//    textContent = "新竹縣原住民族基礎建設工程預算經費執行原則"
```

即 **`<a>` 的 `href` 內 `id=` 參數為內部 ID，`textContent` 為法規全名**。

### 1.4 Content-Security-Policy

`curl -I https://hclaw.hsinchu.gov.tw/law/index.aspx` 實測完整回應標頭：

```
HTTP/1.1 200 OK
X-Frame-Options: SAMEORIGIN
SERVER: -
```

**沒有 `Content-Security-Policy` 標頭。** 也沒有 CSP `<meta>` 標籤
（playwright 檢查 `document.querySelectorAll('meta')` 只有 charset / X-UA-Compatible / viewport）。

➜ **connect-src 完全不受限**（連 `'self'` 都沒設）。同源取文必然可行。

**實地驗證同源 fetch**（在該站頁面內執行 `fetch(..., {credentials:'same-origin'})`）：

```
新竹縣 same-origin fetch => {"ok":true,"status":200,"len":43981,"hasLink":true}
```

### 1.5 歷史條文/沿革

實測該站條文頁存在的功能連結（`LawContent.aspx?id=GL000200`）：

| 功能 | 網址格式 |
|---|---|
| 條文檢索 | `LawContentSearch.aspx?id={ID}` |
| 法規沿革 | `LawContentSource.aspx?id={ID}` |
| 歷史法規 | `LawContentHistoryList.aspx?id={ID}` |

實測 `https://hclaw.hsinchu.gov.tw/law/LawContentHistoryList.aspx?id=GL000200`
→ 200，title = `新竹縣政府主管法規共用系統-歷史法規`。

歷史法規清單頁內再連到單一版本（格式與臺中市相同，見 4.5）：
`LawContentHistory.aspx?hid={歷史版本號}&id={ID}`

⚠️ 該站**沒有** `LawNoSearch.aspx`（條號查詢）連結；臺中市與彰化縣有（見第 8 節表）。

### 1.6 條號書寫格式

實測抓到的條號樣本（跨 10 筆法規）：

```
"第  一  條", "第  二  條", "第  三  條", "第  四  條", "第  五  條", "第  六  條",
"第1條", "第2條", "第3條", "第4條", "第4條之1",
"第十一條", "第十二條", "第二條"
```

➜ **中文數字與阿拉伯數字兩者皆有，同一站內混用**（取決於個別法規錄入方式）。
之X條實測為 **`第4條之1`** 這種寫法（「之」後接同型數字）。
中文數字版另可能出現 `第　一　條`（全形空格填充對齊）。

---

## 2. 新竹市

- **系統**：新竹市政府主管法規共用系統
- **Base URL**：`https://law.hccg.gov.tw/`（根目錄，無路徑前綴）
- **狀態**：✅ 可行

### 2.1 條文頁網址格式

```
https://law.hccg.gov.tw/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://law.hccg.gov.tw/LawContent.aspx?id=FL021043` | 新竹市政府主管法規共用系統-法規內容-新竹市議會組織自治條例 |
| `https://law.hccg.gov.tw/LawContent.aspx?id=FL021059` | 新竹市政府主管法規共用系統-法規內容-新竹市各區公所組織規程 |

### 2.2 DOM 結構

實測 10 筆：**10 筆全為 `blob` 模式**。容器同新竹縣：
`div.law-reg-content.law-article` > `#ctl00_cp_content_divLawContent08`。

**特殊之處：新竹市的 blob 用 `<b>` 標記條號**（其他 blob 站沒有）。
實測 outerHTML 節錄（FL021043 新竹市議會組織自治條例）：

```html
<div id="ctl00_cp_content_divLawContent08" class="ClearCss">
<b>　　&nbsp;&nbsp;&nbsp;第&nbsp;一&nbsp;章&nbsp;總則</b><br>
<b>第&nbsp;1&nbsp;條</b><br>
本自治條例依地方制度法第五十四條第二項暨地方立法機關組織準則第三<br>
條第二項規定制定之。<br><br><br>
<b>　　&nbsp;&nbsp;&nbsp;第&nbsp;二&nbsp;章&nbsp;議員</b><br>
<b>第&nbsp;2&nbsp;條</b><br>
新竹市議會（以下簡稱本會）議員，由市民依法選舉之，任期四年，連選<br>
得連任。<br><br><br>
<b>第&nbsp;3&nbsp;條</b><br>
本會議員總額，依中華民國八十七年一月二十四日選出之議員名額為準共<br>
二十九名，如因人口變動有增加必要者，其名額之調整依地方立法機關組<br>
織準則第六條之規定。<br>
```

➜ 這類頁面**可用 `#ctl00_cp_content_divLawContent08 > b` 定位條號起點**，
但這是該筆法規的錄入風格，**不是全站保證**（同站其他法規未必有 `<b>`），
仍建議以文字 regex 為主、`<b>` 為輔。

### 2.3 法規名稱 → ID

```
https://law.hccg.gov.tw/LawResult.aspx?NLawTypeID=all&KW={kw}&name=1&content=1&now=1&fei=1
```

實測結果（KW=新竹市）：

```json
[["LawContent.aspx?id=FL022871","新竹市政府訴願案件閱卷須知"],
 ["LawContent.aspx?id=FL021059","新竹市各區公所組織規程"],
 ["LawContent.aspx?id=GL000200","新竹市政府環境影響評估審查委員會組織規程"]]
```

⚠️ 注意 `GL000200` 在新竹市 = 環評委員會組織規程，在新竹縣 = 原住民族工程執行原則。
**ID 只在單一站台內唯一，跨站不可共用。**

### 2.4 CSP

`curl -I https://law.hccg.gov.tw/index.aspx`：

```
HTTP/1.1 200 OK
X-Frame-Options: SAMEORIGIN
SERVER: -
```

**無 CSP 標頭、無 CSP meta。** connect-src 無限制。

同源 fetch 實測：`{"ok":true,"status":200,"len":43834,"hasLink":true}` ✅

### 2.5 歷史條文/沿革

實測條文頁存在：`LawContentSearch.aspx?id=` / `LawContentSource.aspx?id=` /
`LawContentHistoryList.aspx?id=`。

實測 `https://law.hccg.gov.tw/LawContentSource.aspx?id=FL021059` → 200，
title = `新竹市政府主管法規共用系統-法規沿革-新竹市各區公所組織規程`。

### 2.6 條號格式

實測樣本：

```
"第 1 條","第 2 條","第 3 條","第 4 條","第 5 條",
"第一條","第二條","第三條","第四條","第五條","第六條",
"第十三條","第五十四條","第三\n條"
```

➜ 兩種數字系統混用。
⚠️ `"第三\n條"` 顯示**條號可能被 `<br>` 從中截斷**（「第三」與「條」跨行），
regex 必須容忍條號內出現換行/空白。

---

## 3. 苗栗縣

- **系統**：苗栗縣政府主管法規共用系統
- **Base URL**：`https://law.miaoli.gov.tw/glrsnewsout/`
  （**必須含 `/glrsnewsout/` 路徑**；`https://law.miaoli.gov.tw/` 根目錄
  以 `curl -I` 測為連線失敗 `000`）
- **狀態**：✅ 可行

### 3.1 條文頁網址格式

```
https://law.miaoli.gov.tw/glrsnewsout/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://law.miaoli.gov.tw/glrsnewsout/LawContent.aspx?id=GL000210` | 苗栗縣政府主管法規共用系統-法規內容-苗栗縣電子遊戲場業設置自治條例 |
| `https://law.miaoli.gov.tw/glrsnewsout/LawContent.aspx?id=FL014246` | 苗栗縣政府主管法規共用系統-法規內容-苗栗縣動物保謢防疫所組織規程 |

### 3.2 DOM 結構

實測 10 筆：**10 筆全為 `blob` 模式**。

實測 `#ctl00_cp_content_divLawContent08` 的 `innerText`（GL000210）：

```
第 1 條　　
為規範苗栗縣電子遊戲場業之設置，以維護社會安寧、善良風俗、公共安
全及縣民身心健康，特制定本自治條例。


第 2 條　　
電子遊戲場業之設置，除依電子遊戲場業管理條例及相關法令外，並應依
本自治條例規定辦理。


第 3 條　　
本自治條例之主管機關為苗栗縣政府。
```

實測 outerHTML 節錄：

```html
<div id="ctl00_cp_content_divLawContent08" class="ClearCss">第 1 條　　<br>
為規範苗栗縣電子遊戲場業之設置，以維護社會安寧、善良風俗、公共安<br>
全及縣民身心健康，特制定本自治條例。<br><br><br>
第 2 條　　<br>
電子遊戲場業之設置，除依電子遊戲場業管理條例及相關法令外，並應依<br>
本自治條例規定辦理。<br><br><br>
```

➜ 條號獨立成行（`第 N 條` 後直接 `<br>`），比其他 blob 站好切。

### 3.3 法規名稱 → ID

```
https://law.miaoli.gov.tw/glrsnewsout/LawResult.aspx?NLawTypeID=all&KW={kw}&name=1&content=1&now=1&fei=1
```

實測（KW=苗栗縣）：

```json
[["LawContent.aspx?id=GL000098","苗栗縣各機關工作績優激勵實施辦法"],
 ["LawContent.aspx?id=FL014246","苗栗縣動物保謢防疫所組織規程"],
 ["LawContent.aspx?id=GL000211","苗栗縣性別平等教育委員會設置辦法"]]
```

⚠️ 結果頁的 `href` 是**相對路徑** `LawContent.aspx?id=...`，
解析時 base 必須是 `.../glrsnewsout/`，不是網域根。

### 3.4 CSP

`curl -I https://law.miaoli.gov.tw/glrsnewsout/index.aspx`：

```
HTTP/1.1 200 OK
X-Frame-Options: SAMEORIGIN
```

**無 CSP 標頭。** 同源 fetch 實測：
`{"ok":true,"status":200,"len":42666,"hasLink":true}` ✅

### 3.5 歷史條文/沿革

實測存在：`LawContentSearch.aspx?id=` / `LawContentSource.aspx?id=` /
`LawContentHistoryList.aspx?id=`。無 `LawNoSearch`。

### 3.6 條號格式

實測樣本：

```
"第 1 條","第 2 條","第 3 條","第 4 條","第 5 條","第 6 條",
"第八條","第九條","第十八條","第二十四條","第二十五條","第二十七條","第四十八條",
"第二十一\n條"
```

➜ 兩種混用；同樣有條號被換行截斷的情形（`第二十一\n條`）。

---

## 4. 臺中市

- **系統**：臺中市政府主管法規共用系統
- **Base URL**：`https://law.taichung.gov.tw/`
- **狀態**：✅ 可行（**結構最好的一站**）

### 4.1 條文頁網址格式

```
https://law.taichung.gov.tw/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://law.taichung.gov.tw/LawContent.aspx?id=GL002048` | 臺中市政府主管法規共用系統-法規內容-臺中市都市計畫保護區農業區土地使用審查辦法 |
| `https://law.taichung.gov.tw/LawContent.aspx?id=GL000371` | 臺中市政府主管法規共用系統-法規內容-臺中市議會組織自治條例 |

其他有效變體（實測）：
- 友善列印：`LawContent.aspx?media=print&id={ID}`
- 帶關鍵字高亮：`LawContent.aspx?id={ID}&kw={關鍵字}`

⚠️ 實測 `LawContent.aspx?id=FL056290`（不存在的 ID）**仍回 HTTP 200**，
但 title 只有 `臺中市政府主管法規共用系統-`（無法規名），且無 `.law-reg-content`。
➜ **不能用 status code 判斷 ID 是否有效，要看 title 或內容容器是否存在。**

### 4.2 DOM 結構 ★

實測 10 筆：**9 筆為 `table` 模式**，1 筆 other（無條文容器）。

- 外層：`div.law-reg-content.law-article`
- 條文表：`#ctl00_cp_content_tableLawArticleBasic`
  （`class="table tab-list tab-nobg tab-law law-content"`）
- **單一條文 = 一個 `<tr>`（含 2 個 `<td>`）**
- 章節標題 = 一個 `<tr>`（含 1 個 `<td colspan="2" class="th law-char">` 或 `th law-char-2`）

實測 `#ctl00_cp_content_tableLawArticleBasic` 的 outerHTML（GL000371 臺中市議會組織自治條例）：

```html
<table id="ctl00_cp_content_tableLawArticleBasic" class="table tab-list tab-nobg tab-law law-content">
<tbody><tr>
  <td colspan="2" class="th law-char" scope="col">第一章　　總則</td>
</tr>
<tr>
  <td scope="row" class="th"></td>
  <td><div class="ClearCss"><p><span style="font-family: 細明體"><span style="font-size: 1em">第一條　　本自治條例依地方制度法第五十四條第一項及地方立法機關組<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;織準則第三條第一項規定制定之。</span></span></p>
</div></td>
</tr>
<tr>
  <td scope="row" class="th"></td>
  <td><div class="ClearCss"><span style="font-size: 1em">第二條 &nbsp; &nbsp;臺中市議會(以下簡稱本會)行使地方制度法所賦予之職權。</span></div></td>
</tr>
```

**⚠️ 臺中市的重大陷阱：`<td class="th">`（第一欄）是空的！**

實測 GL002048：`td.th` 共 32 個，其中**只有 5 個非空**，那 5 個全是章節標題
（`th law-char-2`，例如 `第一章 總則`、`第二章 基地條件與審查作業`）。
**所有條文列的第一個 `<td class="th">` 都是空字串。**

實測逐列輸出（GL002048）：

```json
[{"tds":1,"cls":["th law-char-2"],"txt":["第一章 總則"]},
 {"tds":2,"cls":["th",""],"txt":["","第一條　　本辦法依都市計畫法臺中市施行自治條例（以下簡稱本自治條\n　　　例）第三十五條第四項及第三十八條第四項規定訂定之。"]},
 {"tds":2,"cls":["th",""],"txt":["","第二條　　本辦法之主管機關為臺中市政府(以下簡稱本府)。"]},
 {"tds":2,"cls":["th",""],"txt":["","第三條　　使用都市計畫保護區、農業區土地設置本自治條例第三十五條\n　　　第一項第一款至第十三款或第三十八條第一項規定之各項設施者，\n　　　應依本辦法申請核准。..."]}]
```

➜ **臺中市的條號在「第二個 `<td>` 的文字開頭」，不在第一個 `<td>`。**
這與彰化縣**完全相反**（見 5.2），是本次調查最重要的差異點。

**臺中市取單條的正確作法**：

```js
const rows = [...document.querySelectorAll('#ctl00_cp_content_tableLawArticleBasic tr')]
  .filter(tr => tr.querySelectorAll('td').length === 2);
// 條文全文（含條號）
rows[0].querySelectorAll('td')[1].innerText
// -> "第一條　　本辦法依都市計畫法臺中市施行自治條例（以下簡稱本自治條\n　　　例）第三十五條第四項及第三十八條第四項規定訂定之。"
// 條文本體容器
rows[0].querySelector('td:nth-child(2) > div.ClearCss')
```

條號需再從該字串開頭 regex 取出。

也有 `blob` 樣式的臺中市法規（例如行政規則類），實測
`LawContent.aspx?id=GL002209`（臺中市政府警察局公務車輛使用管理規定）
是 table 模式但條號為「一、二、三、」的**點列式要點**，非「第N條」：

```html
<tr><td scope="row" class="th"></td>
<td><div class="ClearCss"><span style="font-family: 細明體"><span style="font-size: 1em">五、公務車輛應依適用車種表設置特殊標幟及設備，並依原編列購車預算<br>...
```

➜ **「要點/須知/規定」類法規用「一、二、三、」而非「第N條」，
bookmarklet 需決定是否支援（目前 law.moj.gov.tw 版本應該也有同樣問題）。**

### 4.3 法規名稱 → ID ★

**搜尋表單**（實測 `LawQuery.aspx` 的欄位）：

```
ctl00$cp_content$txtKW        (text)     關鍵字
ctl00$cp_content$chklawname   (checkbox) 搜名稱
ctl00$cp_content$chklawcontent(checkbox) 搜內容
ctl00$cp_content$chklawnow    (checkbox) 現行
ctl00$cp_content$chklawfei    (checkbox) 廢止
ctl00$cp_content$chkLawTypes{2,6,7,8,9}  法規類別
ctl00$cp_content$tbLNumber    (text)     條號
ctl00$cp_content$txtStartDate / txtEndDate
ctl00$cp_content$btnQuery     (submit)
FORM ACTION: https://law.taichung.gov.tw/LawQuery.aspx  method=post
```

**但送出後會 redirect 到 GET 網址**，實測 playwright 填表送出後
`page.url()` 變成：

```
https://law.taichung.gov.tw/LawResult.aspx?NLawTypeID=all&KW=%e5%81%9c%e8%bb%8a&name=1&content=1&now=1&fei=1
```

➜ **可完全繞過 POST，直接組 GET 網址。這是 bookmarklet 的關鍵。**

從結果頁取 ID（實測 outerHTML）：

```html
<td><i id="ctl00_cp_content_rptList_ctl02_spanLawFilesRela" class="bi bi-paperclip"></i>
<a id="ctl00_cp_content_rptList_ctl02_hlkLawName"
   href="LawContent.aspx?id=GL002209&amp;kw=%e5%81%9c%e8%bb%8a">臺中市政府警察局公務車輛使用管理規定</a>
<div id="ctl00_cp_content_rptList_ctl02_divHLawName"></div></td>
```

取法：

```js
[...document.querySelectorAll('a[href*="LawContent.aspx?id="]')]
  .map(a => [a.getAttribute('href').match(/id=([A-Z]{2}\d+)/)[1], a.textContent.trim()])
```

實測完整搜尋（KW=都市計畫法臺中市施行自治條例）回傳 10 筆，
其中精確命中 `["LawContent.aspx?id=GL002020", "都市計畫法臺中市施行自治條例"]`。

⚠️ **搜尋是模糊比對、依日期排序，精確名稱不保證排第一**（實測該筆排第 2）。
bookmarklet 應在結果中做**完全字串比對**挑出目標，不可直接取第一筆。

⚠️ 另一個實測結果：結果頁還有分類過濾連結，格式為
`LawResult.aspx?NCategoryID={分類ID}&GroupID=&CategoryID=&KW=...`，
可用來縮小範圍。頁尾顯示「共 309 筆，頁次：1 / 31」，
每頁筆數可調（10/20/30/40）。

### 4.4 CSP

`curl -I https://law.taichung.gov.tw/index.aspx` **完整標頭**：

```
HTTP/1.1 200 OK
Cache-Control: private
Content-Length: 38035
Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
X-UA-Compatible: IE=Edge
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Date: Wed, 26 Aug 2026 18:24:57 GMT
Set-Cookie: JSESSIONID=…; path=/; secure; HttpOnly; SameSite=Lax
Set-Cookie: __AntiXsrfToken=…; path=/; secure; HttpOnly; SameSite=Lax
Set-Cookie: TS01ff2a7f=01889f1e...; Path=/; Secure; HttpOnly; SameSite=None
```

**沒有 `Content-Security-Policy`。** playwright 檢查頁面 `<meta>` 也只有：

```html
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta id="ctl00_RWDSetup" name="viewport" content="width=590">
```

➜ **connect-src 不是 `'self'`，而是「根本沒有 CSP」。比 law.moj.gov.tw 更寬鬆。**
同源取文毫無障礙；理論上連跨域 fetch 都不會被 CSP 擋（仍受 CORS 限制）。

同源 fetch 實測：`{"ok":true,"status":200,"len":91997,"hasLink":true}` ✅

⚠️ 頁面有反 XFS 腳本：`if (top != self) { top.location = self.location; }`
➜ **不能用 iframe 嵌入這些頁面**，會把父頁面導走。bookmarklet 必須用 fetch。

### 4.5 歷史條文/沿革 ★（臺中市功能最完整）

實測條文頁的完整功能列（`LawContent.aspx?id=GL002048` 實際抓到的 `<a>`）：

| 功能 | 網址格式 |
|---|---|
| 法規內容 | `LawContent.aspx?id={ID}#lawmenu` |
| 編章節 | `LawContentChapter.aspx?id={ID}#lawmenu` |
| 條文檢索 | `LawContentSearch.aspx?id={ID}#lawmenu` |
| **條號查詢** | `LawNoSearch.aspx?id={ID}#lawmenu` |
| 法規沿革 | `LawContentSource.aspx?id={ID}#lawmenu` |
| **歷史法規** | `LawContentHistoryList.aspx?id={ID}` |
| 友善列印 | `LawContent.aspx?media=print&id={ID}` |

**歷史法規清單** 實測 `LawContentHistoryList.aspx?id=GL002020` → 200，
內容為版本清單（115.12.23 / 107.11.02 / 107.05.16 / 105.06.21 / 104.05.07 / 103.02.06 ...），
清單內連結實測為：

```json
["LawContentHistory.aspx?hid=86038&id=GL002020",
 "LawContentHistory.aspx?hid=86832&id=GL002020",
 "LawContentHistory.aspx?hid=86037&id=GL002020",
 "LawContentHistory.aspx?hid=85613&id=GL002020",
 "LawContentHistory.aspx?hid=84696&id=GL002020"]
```

**單一歷史版本網址格式**：

```
LawContentHistory.aspx?hid={歷史版本ID}&id={法規ID}
```

實測 `https://law.taichung.gov.tw/LawContentHistory.aspx?hid=86038&id=GL002020`
→ 200，title = `臺中市政府主管法規共用系統-歷史法規`。

**條號查詢 `LawNoSearch.aspx`**（可直接跳單條，對 bookmarklet 很有用）：
實測該頁的說明文字（原文照錄）：

```
請輸入條號：
說明	範例
半型之逗點 "," 以區隔條號。
半型之減號 "-" 表示連續之條號區間。
半型之句點 "." 表示有"之" 的條號。
範例1：查詢第 1、11、12、13、35。
設定方式：1,11-13,35
範例2：查詢第 100-1或第100條之1。
設定方式：100.1
```

➜ **語法明確：`1,11-13,35` / 之1 用 `100.1`。**
⚠️ 但實測欄位 `ctl00$cp_content$txtkeyword` 送出後 URL 未變
（`https://law.taichung.gov.tw/LawNoSearch.aspx?id=GL002048`，是 POST postback），
**`?no=5` 這種 GET 參數無效**（實測 `LawNoSearch.aspx?id=GL002048&no=5` 回的仍是空白輸入頁）。
➜ **條號查詢無法用純 GET 觸發，bookmarklet 想用它必須模擬 ASP.NET postback
（帶 `__VIEWSTATE` / `__EVENTVALIDATION`），成本較高。建議改用 fetch 全文再自行切條。**

### 4.6 條號格式

臺中市為 **table 模式**，條號混在第二個 td 的文字開頭，實測樣本：

```
第一條　　本自治條例依地方制度法第五十四條第一項...
第二條 　 臺中市議會(以下簡稱本會)行使地方制度法所賦予之職權。
第三條    本會議員由本市市民依法選舉之，任期四年，連選得連任。
```

章節：`第一章　　總則`、`第二章　　議員`（`td.th.law-char`）
或 `第一章 總則`（`td.th.law-char-2`）

➜ 實測的臺中市自治條例/自治規則以 **中文數字 `第一條`** 為主，
條號與內文之間以**全形空格 `　` 或多個半形空格**分隔。
之X條格式在臺中市樣本中未直接抓到，但依 `LawNoSearch` 說明頁明示為
「**第100條之1**」（中文語句）/ 輸入語法 `100.1`。

---

## 5. 彰化縣

- **系統**：彰化縣政府主管法規共用系統
- **Base URL**：`https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/`
  （**注意主機名是 `lawsearch`，路徑 `GLRSNEWSOUT` 為大寫**；
  `law.chcg.gov.tw` 這個網域**不存在**，DNS 失敗）
- **狀態**：✅ 可行（**結構最乾淨的一站**）

### 5.1 條文頁網址格式

```
https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawContent.aspx?id=FL004895` | 彰化縣政府主管法規共用系統-法規內容-彰化縣處理妨害交通車輛自治條例 |
| `https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawContent.aspx?id=GL000483` | 彰化縣政府主管法規共用系統-法規內容-彰化縣政府辦公場所防止針孔攝影處理作業要點 |

### 5.2 DOM 結構 ★（最佳）

實測 10 筆：**10 筆全為 `table` 模式**。

**彰化縣的 `<td class="th">` 有填條號**（與臺中市相反）：

實測 `#ctl00_cp_content_tableLawArticleBasic` 的 outerHTML（FL004895）：

```html
<table id="ctl00_cp_content_tableLawArticleBasic" class="table tab-list tab-nobg tab-law law-content">
<tbody><tr>
  <td scope="row" class="th">第 1 條</td>
  <td><div class="ClearCss">
彰化縣政府（以下簡稱本府）為消除道路障礙，維護交通秩序與安全，特<br>制定本自治條例。<br>
</div></td>
</tr>
<tr>
  <td scope="row" class="th">第 2 條</td>
  <td><div class="ClearCss">
本自治條例所稱之車輛如下：<br>一、二輪以上之各型機動車輛。<br>二、聯結車、全聯結車、半聯結車、拖車、全拖車、半拖車、曳引車及拖<br>&nbsp;&nbsp;&nbsp;&nbsp;架。<br>三、以人力、獸力行駛之車輛。<br>四、其他可行駛於道路之動力機械。<br>
</div></td>
</tr>
```

實測逐列擷取結果：

| `td[0].className` | `td[0].innerText` | `td[1].innerText`（節錄） |
|---|---|---|
| `th` | `第 1 條` | 彰化縣政府（以下簡稱本府）為消除道路障礙，維護交通秩序與安全，特制定本自治條例。 |
| `th` | `第 2 條` | 本自治條例所稱之車輛如下：一、二輪以上之各型機動車輛。... |
| `th` | `第 3 條` | 車輛有下列情事之一者，得拖吊離現場，並予以保管：... |
| `th` | **`第 3 條之1`** | 電動輔助自行車及微型電動二輪車有下列情事之一者，得拖吊離現場，並予以沒入：... |
| `th` | `第 4 條` | 車輛拖吊、離之執行與保管，以本縣警察局為執行機關。... |
| `th` | `第 5 條` | 拖吊、離車輛時，應配置警察一人隨車執行簽證舉發事項... |

**彰化縣取單條的 selector（最乾淨）**：

```js
const rows = [...document.querySelectorAll('#ctl00_cp_content_tableLawArticleBasic tr')]
  .filter(tr => tr.querySelectorAll('td').length === 2);
rows[3].querySelector('td.th').innerText            // -> "第 3 條之1"   ← 條號
rows[3].querySelector('td:nth-child(2) div.ClearCss').innerText  // -> 條文內容
```

➜ **條號與內容完全分離，這是七站中最理想的結構。**

### 5.3 法規名稱 → ID

```
https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawResult.aspx?NLawTypeID=all&KW={kw}&name=1&content=1&now=1&fei=1
```

實測（KW=彰化縣）：

```json
[["LawContent.aspx?id=FL087849","彰化縣縣有建築改良物報廢報損標準作業程序"],
 ["LawContent.aspx?id=GL000293","修正「彰化縣高級中等學校課業輔導及自習活動實施要點」，自115年9月1日實施生效。"],
 ["LawContent.aspx?id=GL000483","彰化縣政府辦公場所防止針孔攝影處理作業要點"]]
```

⚠️ 注意第 2 筆：**結果中會混入「公告」型項目，其「名稱」是一整句公告文字**
（`修正「...」，自115年9月1日實施生效。`）。
bookmarklet 做名稱比對時要能濾掉這種，或用 `「」` 內文字再比對。

### 5.4 CSP

`curl -I https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/index.aspx`：

```
HTTP/1.1 200 OK
x-frame-options: SAMEORIGIN
```

**無 CSP 標頭。** 同源 fetch 實測：
`{"ok":true,"status":200,"len":43613,"hasLink":true}` ✅

### 5.5 歷史條文/沿革

實測條文頁存在的功能連結：

| 功能 | 網址格式 |
|---|---|
| 條文檢索 | `LawContentSearch.aspx?id={ID}` |
| **條號查詢** | `LawNoSearch.aspx?id={ID}` |
| 法規沿革 | `LawContentSource.aspx?id={ID}` |
| 歷史法規 | `LawContentHistoryList.aspx?id={ID}` |

➜ **彰化縣與臺中市一樣有 `LawNoSearch`**（其他五站沒有）。
歷史版本網址同臺中市：`LawContentHistory.aspx?hid={hid}&id={ID}`
（此點由臺中市實測確認，彰化縣的 `LawContentHistoryList` 頁面本次未逐一點入取 hid，
**屬未逐項實測，標示為「格式推定同臺中市」**）。

### 5.6 條號格式

實測樣本（跨 10 筆法規）：

```
"第 1 條","第 2 條","第 3 條","第 3 條之1","第 4 條","第 5 條",
"第一條","第二條","第三條","第四條","第五條","第六條"
```

➜ 兩種數字系統混用。
**之X條實測確認為 `第 3 條之1`** ——
即「條」在前、「之」在後，且**「之」後的數字是阿拉伯數字，中間無空格**。

---

## 6. 南投縣

- **系統**：南投縣政府主管法規共用系統
- **Base URL**：`https://glrs.nantou.gov.tw/`
  （**主機名是 `glrs`**；`law.nantou.gov.tw` 不存在，DNS 失敗）
- **狀態**：✅ 可行（**條文結構最糟的一站**）

### 6.1 條文頁網址格式

```
https://glrs.nantou.gov.tw/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://glrs.nantou.gov.tw/LawContent.aspx?id=FL021818` | 南投縣政府主管法規共用系統-法規內容-南投縣政府組織自治條例 |
| `https://glrs.nantou.gov.tw/LawContent.aspx?id=GL000685` | 南投縣政府主管法規共用系統-法規內容-南投縣動物保護自治條例 |

### 6.2 DOM 結構 ⚠️（最麻煩）

實測 10 筆：**10 筆全為 `blob` 模式**。

而且南投縣的 blob **內含 Microsoft Word 貼上的殘留標記**
（`class="x_MsoNormal"`、inline style `margin-left: 80pt; text-indent: -80pt`、
`font-family: 新細明體`），實測 outerHTML（FL023129）：

```html
<div id="ctl00_cp_content_divLawContent08" class="ClearCss">
<p class="x_MsoNormal" style="margin-left: 80pt; text-indent: -80pt">
<span style="font-size: 16pt; font-family: &quot;新細明體&quot;, &quot;serif&quot;; color: rgba(0, 0, 0, 1)">第　一　條　　南投縣政府（以下簡稱本府）為辦理文化藝術財團法人（以下簡稱文化法人）之設立許可及監督事宜，特制定本自治條例。<span lang="EN-US"></span></span></p>
<p class="x_MsoNormal" style="margin-left: 80pt; text-indent: -80pt">
<span style="font-size: 16pt; font-family: &quot;新細明體&quot;, &quot;serif&quot;; color: rgba(0, 0, 0, 1)">第　二　條　　本自治條例所稱文化法人，指依捐助章程規定其主要業務以舉辦文化藝術為目的，其受益範圍為南投縣，經由本府許可設立，並向法院登記之地方性文化法人。<span lang="EN-US"></span></span></p>
```

實測 `innerText`（FL021818 南投縣政府組織自治條例）：

```
第　一　條　　本自治條例依地方制度法第六十二條第二項暨地方行政機關組織準則第三條第二項規定制定之。

第　二　條　　南投縣政府（以下簡稱本府）依法辦理縣自治事項，執行上級機關委辦事項及監督鄉（鎮、市）自治事項。

第　三　條　　本府置縣長一人，對外代表本縣，綜理縣政，並指揮監督本府及所屬機關員工。置副縣長二人，襄助縣長處理縣政，由縣長任命，報請內政部備查。縣長卸任、辭職、去職或死亡時，應隨同離職。
```

➜ **好消息**：南投縣的 blob 至少每條一個 `<p class="x_MsoNormal">`，
所以 `#ctl00_cp_content_divLawContent08 > p` 常常剛好是一條。
➜ **壞消息**：這只是 Word 貼上的副產品，**沒有保證**，
其他法規可能全部擠在一個 `<p>` 或用 `<br>`。仍需以文字 regex 為主。

### 6.3 法規名稱 → ID

```
https://glrs.nantou.gov.tw/LawResult.aspx?NLawTypeID=all&KW={kw}&name=1&content=1&now=1&fei=1
```

實測（KW=南投縣）：

```json
[["LawContent.aspx?id=GL000385","南投縣公立殯葬設施免費使用標準"],
 ["LawContent.aspx?id=GL000695","南投縣社區大學學員入校選課要點"],
 ["LawContent.aspx?id=GL000694","南投縣政府及所屬各機關學校行政罰鍰案件及執行憑證管理作業要點"]]
```

### 6.4 CSP

`curl -I https://glrs.nantou.gov.tw/index.aspx` **完整標頭**：

```
HTTP/2 200
server: HiNetCDN
date: Wed, 26 Aug 2026 18:37:00 GMT
content-type: text/html; charset=utf-8
content-length: 35902
vary: Accept-Encoding
cache-control: private
set-cookie: JSESSIONID=…; path=/; secure; HttpOnly; SameSite=Lax
set-cookie: __AntiXsrfToken=…; path=/; secure; HttpOnly; SameSite=Lax
set-cookie: TS01138292=017271803a0b...; Path=/
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
x-xss-protection: 1; mode=block
x-ua-compatible: IE=Edge
strict-transport-security: max-age=31536000
x-cache: MISS, MISS, EXPIRED
x-request-id: fdd92338d08e6f81bee3cc314134e287
accept-ranges: bytes
```

**無 CSP 標頭。** 注意本站掛在 **HiNet CDN** 後面（有快取層）。

同源 fetch 實測：`{"ok":true,"status":200,"len":44447,"hasLink":true}` ✅

### 6.5 歷史條文/沿革

實測條文頁只有：`LawContentSearch.aspx?id=` / `LawContentSource.aspx?id=`。

⚠️ 實測的南投縣樣本頁面中，**部分法規沒有「歷史法規」連結**
（例如 `GL000695` 只抓到 條文檢索 + 法規沿革，無 `LawContentHistoryList`）。
系統本身支援該頁，但**該筆法規若無歷史版本就不顯示連結**。
➜ bookmarklet 不能假設 `LawContentHistoryList.aspx?id=` 一定有內容。

### 6.6 條號格式 ⚠️

實測樣本：

```
"第　一　條","第　二　條","第　三　條","第　四　條","第　五　條",
"第十條","第十七條","第十八條","第三十條","第四十四條","第四十六條","第四十九條之一",
"第二十一條之一","第二十一條之二"
```

➜ **南投縣幾乎全用中文數字**，且個位數條號用 **全形空格 `　`（U+3000）填充**：
`第　一　條`（第 + 全形空格 + 一 + 全形空格 + 條）。

➜ **之X條實測為 `第四十九條之一`、`第二十一條之一`、`第二十一條之二`**
——**「之」後也是中文數字**，與彰化縣的 `第 3 條之1` 完全不同。

**這是解析上最需要注意的一站：條號 regex 必須同時處理全形空格與中文數字之X。**

---

## 7. 雲林縣

- **系統**：雲林縣政府主管法規共用系統
- **Base URL**：`https://law.yunlin.gov.tw/`
- **狀態**：✅ 可行，**但 curl 會被擋（Cloudflare）**

### 7.1 ⚠️ 重要：curl 403，瀏覽器 200

`curl -I https://law.yunlin.gov.tw/` 實測：

```
HTTP/2 403
date: Wed, 26 Aug 2026 18:37:02 GMT
content-type: text/html; charset=UTF-8
cache-control: private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0
expires: Thu, 01 Jan 1970 00:00:01 GMT
referrer-policy: same-origin
x-frame-options: SAMEORIGIN
server: cloudflare
cf-ray: a314f208685cc4ed-TPE
```

即使加上完整 Chrome User-Agent 與 `Accept-Language: zh-TW` 仍為 403
（實測 `LawQuery.aspx`、`glrsnewsout/LawQuery.aspx` 皆 403）。

**但用 playwright（真實 chromium）載入 → HTTP 200，一切正常。**
實測 `title` = `雲林縣政府主管法規共用系統-最新訊息`，
內容正常渲染（抓到 115.08.20 起的最新法規清單）。

➜ **結論：這是 Cloudflare 的 bot 過濾，只擋無頭 HTTP client，不擋真實瀏覽器。
對 bookmarklet 而言完全無影響**（bookmarklet 就是在真實瀏覽器內執行，
且是同源 fetch 帶 cookie，會通過 Cloudflare）。
**但對「用 curl/server 抓資料」的做法是致命的。**

同源 fetch 實測（在該站頁面內執行）：
`{"ok":true,"status":200,"len":42770,"hasLink":true}` ✅

### 7.2 條文頁網址格式

```
https://law.yunlin.gov.tw/LawContent.aspx?id={ID}
```

實測 200 OK 範例：

| 網址 | 實測 title |
|---|---|
| `https://law.yunlin.gov.tw/LawContent.aspx?id=FL028306` | 雲林縣政府主管法規共用系統-法規內容-雲林縣議會組織自治條例 |
| `https://law.yunlin.gov.tw/LawContentSource.aspx?id=FL028306` | 雲林縣政府主管法規共用系統-法規沿革-雲林縣議會組織自治條例 |

⚠️ 本站只實測到 1 筆「自治條例」樣本（搜尋 `自治條例` 精確結尾比對僅命中 1 筆），
**第二個「條文頁」範例以 `LawContentSource` 補上。**
若要更多條文頁範例，可用第 7.4 節搜尋端點自行取得，
實測搜尋 `管理` 有回傳 10 筆有效 `LawContent.aspx?id=` 連結（9 blob + 1 other）。

### 7.3 DOM 結構

實測（樣本 10 筆：9 blob + 1 other）：**blob 模式**。
容器同其他 blob 站：`#ctl00_cp_content_divLawContent08`（`div.ClearCss`）。

實測 `innerText`（FL028306 雲林縣議會組織自治條例）：

```
第一章　　總則

第一條　　本自治條例依地方立法機關組織準則第三條第二項規定制定之。


第二章  　議員


第二條　　雲林縣議會 (以下簡稱本會) 議員，由縣民依法選舉之，任期四
　　　年，連選得連任。

第三條　　本會議員總額，依地方立法機關組織準則第六條之規定。

第四條　　本會議員當選人應於上屆任期屆滿之日；依宣誓條例規定宣誓就
      職。不依規定宣誓者，視同未就職。
　　　　　前項宣誓就職典禮...
```

➜ 章節（`第一章　　總則`）與條文（`第一條　　...`）**混在同一個 blob 內，
且沒有任何標記區分**，regex 必須排除 `第N章`/`第N節`/`第N編`。

### 7.4 法規名稱 → ID

```
https://law.yunlin.gov.tw/LawResult.aspx?NLawTypeID=all&KW={kw}&name=1&content=1&now=1&fei=1
```

實測回傳 HTTP 200，並成功取得 `a[href*="LawContent.aspx?id="]` 連結。
取法與其他六站完全相同。

實測首頁抓到的導覽連結（證明是同一套系統）：

```json
["SiteMapPage.aspx","index.aspx","EngNewsList.aspx","LawCategoryMain.aspx",
 "LawQuery.aspx","DraftForum.aspx","WebList.aspx",
 "/index.aspx?LawType=14","/index.aspx?LawType=15%2c16%2c17"]
```

### 7.5 CSP

由於 curl 403，**CSP 改由 playwright 取實際回應標頭**：

```
雲林縣 LawContent.aspx / index.aspx
  response.headers()['content-security-policy'] === undefined  (null)
```

curl 取到的 403 頁面標頭中也**沒有 CSP**（只有 `referrer-policy: same-origin`）。

➜ **無 CSP 標頭。** connect-src 無限制。

⚠️ 說明：**題目要求「用 curl -I 取得 CSP 全文」這一項，雲林縣無法用 curl 完成**
（403 Cloudflare）。已改用真實瀏覽器取得回應標頭，結論為「無 CSP」。

### 7.6 歷史條文/沿革

實測條文頁存在：
`LawContentSearch.aspx?id={ID}` / `LawContentSource.aspx?id={ID}` /
`LawContentHistoryList.aspx?id={ID}`（部分法規）。

實測 `https://law.yunlin.gov.tw/LawContentSource.aspx?id=FL028306` → 200 ✅

無 `LawNoSearch`。

### 7.7 條號格式

實測樣本：

```
"第一條","第二條","第三條","第四條","第六條","第七條",
"第二十條","第二十四條","第二十九條","第三十條","第三十一條","第三十二條","第三十五條"
```

之X條實測：**`第三十三條之一`**（中文數字，同南投縣風格）。

➜ **雲林縣幾乎全用中文數字。**

---

## 8. 共用系統分析（第 7 題）

### 8.1 是否共用？→ 是，七站全部共用

證據：

1. **頁尾系統版本字串完全相同**：七站皆 `系統版本：114.11.28`
   （僅「系統更新日期」不同：新竹縣 114.12.05 / 新竹市 115.01.19 /
   苗栗縣 114.12.15 / 臺中市 114.12.04 / 彰化縣 115.01.14 / 南投縣 115.05.29）
2. **頁面標題格式一致**：`{縣市}政府主管法規共用系統-法規內容-{法規名}`
3. **ASP.NET 控制項 ID 完全一致**：
   `ctl00_cp_content_divLawContent08`、`ctl00_cp_content_tableLawArticleBasic`、
   `ctl00$cp_content$txtKW`、`ctl00_cp_content_rptList_ctl01_hlkLawName`
4. **URL schema 完全一致**：`LawContent.aspx?id=` / `LawResult.aspx?...` /
   `LawQuery.aspx` / `LawCategoryMain.aspx?type=M&CategoryID=` /
   `LawContentSource.aspx?id=` / `LawContentHistoryList.aspx?id=`
5. **ID 格式一致**：`GL######` / `FL######`（2 大寫字母 + 6 位數字）
6. **同樣的錯誤訊息**：搜尋參數不對時七站都回
   「請『正確』勾選您所要檢索的檢索項目！」
7. **同樣的反 XFS 腳本**：`if (top != self) { top.location = self.location; }`

### 8.2 差異在哪

| 縣市 | Base URL | 路徑前綴 | table 模式 | blob 模式 | `LawNoSearch` | 條號主要形式 | 特殊狀況 |
|---|---|---|---|---|---|---|---|
| 新竹縣 | `hclaw.hsinchu.gov.tw` | `/law/` | 0/10 | **10/10** | ✗ | 混用 | — |
| 新竹市 | `law.hccg.gov.tw` | `/` | 0/10 | **10/10** | ✗ | 混用 | blob 用 `<b>` 包條號 |
| 苗栗縣 | `law.miaoli.gov.tw` | `/glrsnewsout/` | 0/10 | **10/10** | ✗ | 混用 | 條號獨立成行 |
| **臺中市** | `law.taichung.gov.tw` | `/` | **9/10** | 0/10 | **✓** | 中文數字 | **`td.th` 是空的**，條號在第 2 個 td 內 |
| **彰化縣** | `lawsearch.chcg.gov.tw` | `/GLRSNEWSOUT/` | **10/10** | 0/10 | **✓** | 混用 | **`td.th` 有條號**（最佳） |
| 南投縣 | `glrs.nantou.gov.tw` | `/` | 0/10 | **10/10** | ✗ | 中文數字+全形空格 | Word 殘留 `x_MsoNormal`；掛 HiNet CDN |
| 雲林縣 | `law.yunlin.gov.tw` | `/` | 0/10 | 9/10 | ✗ | 中文數字 | **Cloudflare 擋 curl（403）** |

**分組**：

- **A 組（table 模式）**：臺中市、彰化縣 —— 有 `LawNoSearch`，條文可用 selector 逐條取
  - **A1 臺中市**：`td.th` 空白，條號在 `td[1]` 文字開頭
  - **A2 彰化縣**：`td.th` 內含條號，內容在 `td[1] > div.ClearCss`
- **B 組（blob 模式）**：新竹縣、新竹市、苗栗縣、南投縣、雲林縣
  —— 無 `LawNoSearch`，整部法規在一個 div，只能用文字切割

⚠️ **再次強調：這個分組是「本次抽樣 10 筆的統計結果」，不是站台的硬性保證。**
實測已見臺中市有 1 筆 other（無標準容器），雲林縣有 1 筆 other。
**正確做法是每次載入後探測 DOM，而非以縣市查表。**

---

## 9. 給 bookmarklet 的實作建議

### 9.1 站台偵測

```js
const HOSTS = {
  'hclaw.hsinchu.gov.tw':   {name:'新竹縣', base:'/law/'},
  'law.hccg.gov.tw':        {name:'新竹市', base:'/'},
  'law.miaoli.gov.tw':      {name:'苗栗縣', base:'/glrsnewsout/'},
  'law.taichung.gov.tw':    {name:'臺中市', base:'/'},
  'lawsearch.chcg.gov.tw':  {name:'彰化縣', base:'/GLRSNEWSOUT/'},
  'glrs.nantou.gov.tw':     {name:'南投縣', base:'/'},
  'law.yunlin.gov.tw':      {name:'雲林縣', base:'/'},
};
```

### 9.2 取文流程（同源，無 CSP 阻礙）

```js
// 1) 名稱 -> ID
const r = await fetch(`${BASE}LawResult.aspx?NLawTypeID=all&KW=${encodeURIComponent(name)}&name=1&content=1&now=1&fei=1`, {credentials:'same-origin'});
const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
const hit = [...doc.querySelectorAll('a[href*="LawContent.aspx?id="]')]
  .find(a => a.textContent.trim() === name);   // 必須完全比對，勿取第一筆
const id = hit.getAttribute('href').match(/id=([A-Z]{2}\d+)/)[1];

// 2) ID -> 條文
const r2 = await fetch(`${BASE}LawContent.aspx?id=${id}`, {credentials:'same-origin'});
const d2 = new DOMParser().parseFromString(await r2.text(), 'text/html');
```

**七站皆已實測同源 fetch 成功**（`ok:true, status:200, hasLink:true`）。

### 9.3 條文擷取（必須雙模式）

```js
function extractArticles(doc) {
  const table = doc.querySelector('#ctl00_cp_content_tableLawArticleBasic');
  if (table) {
    return [...table.querySelectorAll('tr')]
      .filter(tr => tr.querySelectorAll('td').length === 2)
      .map(tr => {
        const td = tr.querySelectorAll('td');
        const th = td[0].innerText.trim();
        // 彰化縣: 條號在 td[0]；臺中市: td[0] 為空，條號在 td[1] 開頭
        return th ? {no: th, text: td[1].innerText.trim()}
                  : {no: null, text: td[1].innerText.trim()};  // 需再從 text 開頭 regex 取條號
      });
  }
  const blob = doc.querySelector('#ctl00_cp_content_divLawContent08');
  if (blob) return splitByRegex(blob.innerText);   // 文字切割
  return null;   // 該筆法規無標準結構（實測確實存在）
}
```

### 9.4 條號 regex（依實測樣本設計）

必須同時涵蓋以下**全部實測到的寫法**：

```
第 1 條        (彰化/苗栗/新竹市)  半形空格
第1條          (新竹縣)            無空格
第一條         (臺中/雲林/新竹市)  中文數字
第　一　條      (南投/新竹縣)       全形空格 U+3000
第  一  條      (新竹縣)            多個半形空格
第&nbsp;一&nbsp;條  (新竹市 HTML)   nbsp
第三\n條       (新竹市/苗栗)       ← 條號被 <br> 截斷！
第 3 條之1      (彰化)              之 + 阿拉伯數字
第4條之1        (新竹縣)            之 + 阿拉伯數字
第四十九條之一   (南投)              之 + 中文數字
第二十一條之二   (南投)              之 + 中文數字
第三十三條之一   (雲林)              之 + 中文數字
```

建議 regex（`\s` 需含 U+3000 與 `\u00a0`）：

```js
const SP = '[\\s\\u3000\\u00a0]*';
const NUM = '[0-9０-９一二三四五六七八九十百零]+';
const ART = new RegExp(
  `第${SP}(${NUM})${SP}條(?:${SP}之${SP}(${NUM}))?`, 'g'
);
```

⚠️ **同時要排除章節**：`第一章`、`第二節`、`第三編`、`第四款`、`第五目`
（blob 模式中章節與條文混在一起，實測雲林/新竹縣皆有此問題）。

### 9.5 已知陷阱清單（全部實測確認）

1. **不能用 iframe** —— 七站都有 `if (top != self) top.location = self.location;`
2. **不能用 status code 判斷 ID 有效** —— 無效 ID 也回 200（臺中市 `FL056290` 實測）
3. **搜尋必須 `name=1` 或 `content=1`** —— 否則回錯誤頁
4. **搜尋結果不保證第一筆是精確命中** —— 依日期排序（臺中市實測精確名稱排第 2）
5. **搜尋結果會混入「公告」** —— 名稱是一整句話（彰化縣實測）
6. **ID 跨站不唯一** —— `GL000200` 在新竹縣/新竹市是不同法規
7. **相對路徑要用正確 base** —— 苗栗縣 `/glrsnewsout/`、彰化縣 `/GLRSNEWSOUT/`、新竹縣 `/law/`
8. **條號可能被 `<br>` 截斷** —— `第三\n條`
9. **「要點/須知」類用「一、二、三、」不用「第N條」** —— 臺中市 `GL002209` 實測
10. **`LawNoSearch` 是 POST postback，無法用 GET 觸發** —— 臺中市實測 `?no=5` 無效
11. **雲林縣 curl 被 Cloudflare 擋** —— bookmarklet 無影響，但別用 server 抓
12. **部分法規無「歷史法規」連結** —— 南投縣 `GL000695` 實測

---

## 10. 總結表：可行 / 不可行

| 縣市 | 站台 | 開啟 | 條文頁 | 搜尋 API | 同源 fetch | CSP | 歷史法規 | DOM 可解析 | **總評** |
|---|---|---|---|---|---|---|---|---|---|
| **新竹縣** | `hclaw.hsinchu.gov.tw/law/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 43981B | 無 CSP | ✅ HistoryList | ⚠️ blob，需文字切割 | **✅ 可行** |
| **新竹市** | `law.hccg.gov.tw/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 43834B | 無 CSP | ✅ Source+History | ⚠️ blob（有 `<b>` 輔助） | **✅ 可行** |
| **苗栗縣** | `law.miaoli.gov.tw/glrsnewsout/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 42666B | 無 CSP | ✅ HistoryList | ⚠️ blob（條號獨立行，較好切） | **✅ 可行** |
| **臺中市** | `law.taichung.gov.tw/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 91997B | 無 CSP | ✅ **最完整**（含 hid 單版本） | ✅ **table**（但 `td.th` 空） | **✅ 可行（推薦優先）** |
| **彰化縣** | `lawsearch.chcg.gov.tw/GLRSNEWSOUT/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 43613B | 無 CSP | ✅ HistoryList+NoSearch | ✅ **table，條號獨立 `td.th`（最佳）** | **✅ 可行（結構最佳）** |
| **南投縣** | `glrs.nantou.gov.tw/` | ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 44447B | 無 CSP | ⚠️ 部分法規無 History | ⚠️ blob + Word 殘留，條號全形+中文之X | **✅ 可行（解析最費工）** |
| **雲林縣** | `law.yunlin.gov.tw/` | ⚠️ **curl 403**／瀏覽器 ✅ 200 | ✅ 實測 2 例 | ✅ GET | ✅ 42770B | 無 CSP | ✅ Source（部分有 History） | ⚠️ blob，章節條文混雜 | **✅ 可行（但禁用 curl/server 抓取）** |

### 結論

- **七站全部可行**，沒有任何一站不可行。
- **七站全部沒有 CSP 標頭**（連 `connect-src 'self'` 都沒有），
  **同源取文毫無障礙，且已在七站逐一實測 `fetch()` 成功**。
  這比 `law.moj.gov.tw`（有 `connect-src 'self'`）更寬鬆。
- **七站共用同一套「主管法規共用系統」v114.11.28**，
  一套邏輯 + 一張 host 對照表即可全數支援。
- **唯一的實作複雜度來自 DOM 雙模式（table / blob）與條號書寫的六種變體**，
  兩者都**不能用縣市查表決定，必須執行時探測**。

### 需要注意的唯一「限制」

**雲林縣的 Cloudflare 會回 403 給 curl / 無頭 HTTP client。**
這對 bookmarklet（在真實瀏覽器內同源執行）**沒有影響**，已實測確認；
但若未來想用 server-side 預先建索引，雲林縣這條路走不通。

---

## 附錄：本次實測驗證的全部網址（皆回 HTTP 200）

```
200 | 新竹縣政府主管法規共用系統-法規內容-新竹縣殯葬管理自治條例                        | https://hclaw.hsinchu.gov.tw/law/LawContent.aspx?id=GL000683
200 | 新竹縣政府主管法規共用系統-法規內容-新竹縣原住民族基礎建設工程預算經費執行原則      | https://hclaw.hsinchu.gov.tw/law/LawContent.aspx?id=GL000200
200 | 新竹縣政府主管法規共用系統-歷史法規                                            | https://hclaw.hsinchu.gov.tw/law/LawContentHistoryList.aspx?id=GL000200
200 | 新竹市政府主管法規共用系統-法規內容-新竹市議會組織自治條例                        | https://law.hccg.gov.tw/LawContent.aspx?id=FL021043
200 | 新竹市政府主管法規共用系統-法規內容-新竹市各區公所組織規程                        | https://law.hccg.gov.tw/LawContent.aspx?id=FL021059
200 | 新竹市政府主管法規共用系統-法規沿革-新竹市各區公所組織規程                        | https://law.hccg.gov.tw/LawContentSource.aspx?id=FL021059
200 | 苗栗縣政府主管法規共用系統-法規內容-苗栗縣電子遊戲場業設置自治條例                  | https://law.miaoli.gov.tw/glrsnewsout/LawContent.aspx?id=GL000210
200 | 苗栗縣政府主管法規共用系統-法規內容-苗栗縣動物保謢防疫所組織規程                    | https://law.miaoli.gov.tw/glrsnewsout/LawContent.aspx?id=FL014246
200 | 臺中市政府主管法規共用系統-法規內容-臺中市都市計畫保護區農業區土地使用審查辦法        | https://law.taichung.gov.tw/LawContent.aspx?id=GL002048
200 | 臺中市政府主管法規共用系統-法規內容-臺中市議會組織自治條例                        | https://law.taichung.gov.tw/LawContent.aspx?id=GL000371
200 | 臺中市政府主管法規共用系統-歷史法規                                            | https://law.taichung.gov.tw/LawContentHistory.aspx?hid=86038&id=GL002020
200 | 彰化縣政府主管法規共用系統-法規內容-彰化縣處理妨害交通車輛自治條例                  | https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawContent.aspx?id=FL004895
200 | 彰化縣政府主管法規共用系統-法規內容-彰化縣政府辦公場所防止針孔攝影處理作業要點        | https://lawsearch.chcg.gov.tw/GLRSNEWSOUT/LawContent.aspx?id=GL000483
200 | 南投縣政府主管法規共用系統-法規內容-南投縣政府組織自治條例                        | https://glrs.nantou.gov.tw/LawContent.aspx?id=FL021818
200 | 南投縣政府主管法規共用系統-法規內容-南投縣動物保護自治條例                        | https://glrs.nantou.gov.tw/LawContent.aspx?id=GL000685
200 | 雲林縣政府主管法規共用系統-法規內容-雲林縣議會組織自治條例                        | https://law.yunlin.gov.tw/LawContent.aspx?id=FL028306
200 | 雲林縣政府主管法規共用系統-法規沿革-雲林縣議會組織自治條例                        | https://law.yunlin.gov.tw/LawContentSource.aspx?id=FL028306
```

## 附錄 B：查無此站的網域（DNS 解析失敗，供排除）

```
law.hsinchu.gov.tw   -> 000 (無此網域，新竹縣正確為 hclaw.hsinchu.gov.tw/law/)
law.chcg.gov.tw      -> 000 (無此網域，彰化縣正確為 lawsearch.chcg.gov.tw/GLRSNEWSOUT/)
law.nantou.gov.tw    -> 000 (無此網域，南投縣正確為 glrs.nantou.gov.tw)
lawsearch.yunlin.gov.tw -> 000
glrs.yunlin.gov.tw      -> 000
```
