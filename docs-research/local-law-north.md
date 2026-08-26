# 台灣北區地方法規查詢系統技術規格調查

調查日期：2026-08-26（民國115年）
方法：playwright (chromium, ignoreHTTPSErrors) 實際載入 + querySelector 驗證；curl -I 取標頭；請求間隔 ≥1.2 秒。
所有 selector / 文字 / URL 皆為實測結果。

---

## 1. 臺北市 — https://laws.gov.taipei/Law/

系統名稱：臺北市法規查詢系統（ASP.NET MVC，非共用系統）

### 1.1 條文頁網址格式
- 所有條文：`https://laws.gov.taipei/Law/LawSearch/LawArticleContent/{ID}`
- 法規資訊/沿革：`https://laws.gov.taipei/Law/LawSearch/LawInformation/{ID}`

實測可開啟範例：
- https://laws.gov.taipei/Law/LawSearch/LawArticleContent/FL012579 （臺北市公有停車場收費費率自治條例）
- https://laws.gov.taipei/Law/LawSearch/LawArticleContent/FL003962 （臺北市土地使用分區管制自治條例，138 條）

其他實測有效端點（同一 ID）：
- `/Law/LawSearch/LawArticleAmend/{ID}` 異動條文
- `/Law/LawSearch/LawArticleContentSearch/{ID}` 條文檢索
- `/Law/LawSearch/LawArticleNoSearch/{ID}` 條號查詢（POST form，欄位 `ID`、`Date`、`norange`、`__RequestVerificationToken`）
- `/Law/LawSearch/LawRelateInterpretation/{ID}?no=5` 該條相關解釋令函

### 1.2 DOM 結構（實測 outerHTML）
```html
<article class="col-article">
  <ul class="law law-content">
    <li><div class="row">
        <div class="col-no">第 1 條</div>
        <div class="col-data">
            <div class="law-articlepre">臺北市為執行停車場法第三十一條規定，訂定公有停車場收費之差別費率
，特制定本自治條例。</div>
        </div>
        <div class="col-link"></div>
    </div></li>
```
- 單一條文容器：`article.col-article ul.law-content > li`（或內層 `div.row`）
- 條號：`.col-no` → 實際文字 `"第 1 條"`
- 條文內容：`.col-data .law-articlepre`（純文字，換行以真實 `\n` 保留，不是 `<br>`）
- 章節標題另以獨立 li 呈現。
- 註：內容由伺服器直出 HTML，但 `.col-no` 在 `domcontentloaded` 之後才穩定，建議 `networkidle` 或直接 fetch HTML 解析。

實測取到的條號序列（FL003962 前 5 個）：`第 1 條 | 第 1-1 條 | 第 2 條 | 第 2-1 條 | 第 3 條`，末尾 `第 97-5 條 … 第 98 條`。

### 1.3 法規名稱 → ID
搜尋端點（GET，可直接組網址）：
```
https://laws.gov.taipei/Law/LawSearch/SearchResult?SearchString.Keyword1={關鍵字}&SearchType=1
```
較完整版本（由表單送出後實測 URL）：
```
/Law/LawSearch/SearchResult?SearchString.Keyword1=停車&SearchString.Operaton1=AND&SearchString.Operaton2=AND&checkChgType=1&checkChgType=2&checkChgType=3&checkChgType=5&checkChgType=4,6,7,8&Sort=category&SearchType=1&AmendType=1,2,3,5,4,6,7,8&search=
```
結果頁取 ID：抓 `a[href*="/Law/LawSearch/LawInformation/"]`，路徑最後一段即 ID。
實測結果（關鍵字「停車」，臺北市 74 筆）：
- `FL051742` 臺北市各區行政中心停車場洽公便民停車收費標準
- `FL012579` 臺北市公有停車場收費費率自治條例
- `FL012567` 臺北市公有路外停車場委託經營自治條例

ID 格式：`FL` + 6 位數字。

### 1.4 CSP 標頭（curl -I 全文）
```
content-security-policy: frame-ancestors 'self' https://www.youtube.com; frame-src 'self' https://www.youtube.com; child-src 'self' https://www.youtube.com; default-src 'self' data:; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: https://www.youtube.com; media-src 'self' https://www.youtube.com; object-src 'none';
```
其他：`x-frame-options: DENY`、`strict-transport-security: max-age=2592000`、`server: Microsoft-IIS/10.0`。

**connect-src：未明示，回落到 `default-src 'self' data:`** → 同源 fetch 允許。
實測：於 `https://laws.gov.taipei/Law/` 頁面內 `fetch('/Law/LawSearch/LawArticleContent/FL012579')` → `OK 200 len=33549`。**可行**。
`x-frame-options: DENY` 表示不可用 iframe 嵌入，只能 fetch + parse。

### 1.5 歷史條文/沿革
有。
- 沿革總覽：`/Law/LawSearch/LawInformation/{ID}`
- 指定版本所有條文：`/Law/LawSearch/LawArticleContent/{ID}?date=YYYYMMDD`
  實測：`/Law/LawSearch/LawArticleContent/FL012579?date=20110706`、`?date=19960701`
- 指定版本異動條文：`/Law/LawSearch/LawArticleAmend/{ID}?date=YYYYMMDD`

### 1.6 條號書寫格式
阿拉伯數字，含空格：`第 1 條`、`第 5 條`。
之X 寫作連字號：`第 1-1 條`、`第 97-5 條`（不是「第一條之一」）。
章節標題另有中文數字，例如桃園同系統寫法；臺北章節格式未於本次條文列表中取樣。
解釋令函連結參數用純數字：`?no=5`。

---

## 2. 新北市 — https://web.law.ntpc.gov.tw/

系統名稱：新北市政府電子法規查詢系統（ASP.NET WebForms，較舊架構）

### 2.1 條文頁網址格式
- 法規首頁（含按鈕列）：`https://web.law.ntpc.gov.tw/Scripts/FLAWDAT01.aspx?lncode=1{fcode}`
- 所有條文：`https://web.law.ntpc.gov.tw/Scripts/FLAWDAT0202.aspx?fcode={fcode}`
- 單一條文：`https://web.law.ntpc.gov.tw/Scripts/FLAWDOC01.aspx?fcode={fcode}&flno={條號}`

實測可開啟範例：
- https://web.law.ntpc.gov.tw/Scripts/FLAWDAT0202.aspx?fcode=C0230055 （新北市公有停車場管理自治條例，200）
- https://web.law.ntpc.gov.tw/Scripts/FLAWDOC01.aspx?fcode=C0230055&flno=3 （單獨第 3 條，200）
- https://web.law.ntpc.gov.tw/Scripts/FLAWDAT01.aspx?lncode=1C0230055

**重要 ID 差異**：`lncode` 比 `fcode` 多一個前導字元。搜尋結果給 `lncode=1C0230055`，條文頁用 `fcode=C0230055`（去掉開頭的 `1`）。

失效端點（實測 200 但顯示「系統發生非預期錯誤」）：`FLAWDAT0201.aspx`、`FLAWDAT03.aspx`。

### 2.2 DOM 結構（實測 outerHTML，FLAWDAT0202）
```html
<table class="my-table tab-law01">
  <tbody><tr>
    <td class="col-th">
      <a href="FLAWDOC01.aspx?fcode=C0230055&amp;flno=1">第&nbsp;&nbsp;1&nbsp;&nbsp;條</a>&nbsp;&nbsp;
    </td>
    <td class="col-td">
<pre>為加強新北市（以下簡稱本市）公有停車場之經營管理，增進交通流暢，
改善交通秩序，制定本自治條例。</pre>
    </td>
  </tr>
```
- 單一條文容器：`table.tab-law01 tr`
- 條號：`td.col-th`（內含 `<a>`；文字含 `&nbsp;` 需正規化）
- 條文內容：`td.col-td pre`（`<pre>`，換行為真實 `\n`）
- 附件標記：`td.col-th img[alt="附件檔案"]`
- 頁首法規名稱：`#cph_content_lawheader_hlkLNNAME`；修正日期在同 `<td>` 文字 `(民國 113 年 07 月 29 日 修正)`

單條頁（FLAWDOC01）取到的實際文字：
```
第 3 條  公有停車場得由本局依區域、流量、時段之不同，擇定費率種類、收費方
式、收費時間、設置地點、停車種類及繳費期限，分別公告之；並得因特
殊情況需要，採累進、折扣或差別費率方式計費。
前項收費費率及收費計算方式，依附表一之規定。
```

### 2.3 法規名稱 → ID
**沒有 GET 搜尋端點，必須 POST。** 實測：
- `Fname.aspx`（法規名稱查詢）：填 `#cph_content_txtFN`，送出後 **POST 回 `Fname.aspx` 自身**，URL 不變，結果直接渲染在同頁。
- `ncom.aspx`（綜合查詢）：欄位 `ctl00$cph_content$K1`~`K4`、`N1`、`N2`、送出鈕 `ctl00$cph_content$btnEXEC`。表單含 `__VIEWSTATE`、`__VIEWSTATEGENERATOR`、`__VIEWSTATEENCRYPTED`、`CSRFToken`。
- 直接 GET `Fname.aspx?ID=A&page=1` → 無任何結果連結（參數無效）。

結果頁取 ID：抓 `a[href^="/Scripts/FLAWDAT01.aspx?lncode="]`，取 `lncode` 參數，去掉開頭 `1` 得 `fcode`。
實測（Fname 查「停車」）：
- `1C0230055` 新北市公有停車場管理自治條例
- `1C0230099` 新北市政府交通局處理違反停車場法事件統一裁罰基準
- `1C0230024` 新北市政府辦理公有路外停車場評鑑實施要點

ID 格式：`1` + 字母 + 7 位數字（如 `1C0230055`）。前 3 碼 `C023` 對應機關類別。

**對 bookmarklet 的影響**：名稱→ID 需經 POST + VIEWSTATE，成本高。建議做法：預先離線爬一份「法規名稱 → fcode」對照表，bookmarklet 端只做本地查表 + 直接 GET `FLAWDAT0202.aspx?fcode=…`。

### 2.4 CSP 標頭（curl -I 全文）
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.google-analytics.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://www.google-analytics.com;frame-src 'self'; frame-ancestors 'self';img-src * 'self' data: https://www.google-analytics.com;
```
其他：`X-Frame-Options: SAMEORIGIN`、`X-Content-Type-Options: nosniff`。

**connect-src 明確含 `'self'`** → 同源 fetch 允許。
實測：於 `https://web.law.ntpc.gov.tw/` 內 `fetch('/Scripts/FLAWDAT0202.aspx?fcode=C0230055')` → `OK 200 len=24234`。**可行**。

### 2.5 歷史條文/沿革
有，且兩者分開：
- 法規沿革：`https://web.law.ntpc.gov.tw/Scripts/FLAWDAT07.aspx?fname={fcode}`
  實測 `?fname=C0230055` 取到 4 筆制修正紀錄全文。
- 歷史法規（修正前原條文）：`https://web.law.ntpc.gov.tw/Scripts/FLAWDAT08.aspx?fname={fcode}`
  實測列出「民國 113/109/106 年…修正前原條文」三個版本，並直接印出原第 11 條全文。
- 注意參數名是 `fname` 而不是 `fcode`。
- 單條頁下方另有「歷史法條」連結。

### 2.6 條號書寫格式
阿拉伯數字，以 `&nbsp;` 補齊寬度：原始 HTML 為 `第&nbsp;&nbsp;1&nbsp;&nbsp;條`，`innerText` 為 `第  1  條`（雙空格）。
單條頁標題則為 `第 3 條`（單空格）。
URL 參數 `flno` 用純阿拉伯數字：`flno=3`。
沿革內文用中文數字：「一百零二年五月八日…修正公布第 3、6、11 條條文」（日期中文，條號阿拉伯）。
之X 格式本次未直接取樣到；同型系統慣例 `flno` 用 `3-1`，使用前應實測。

---

## 3. 基隆市 — https://exlaw.klcg.gov.tw/

**正確網址（自行找出並實測）**：`https://exlaw.klcg.gov.tw/`
（`law.klcg.gov.tw`、`law.kl.gov.tw`、`kllaw.klcg.gov.tw` 皆無回應）
系統名稱：基隆市政府主管法規共用系統（與桃園同一套「法規共用系統」ASP.NET WebForms）

### 3.0 TLS 注意事項
憑證由 `TWCA Secure SSL Certification Authority` 簽發，本機預設 CA store 無此中介憑證：
```
curl: (60) SSL certificate problem: unable to get local issuer certificate
```
需 `curl -k` 或 playwright `ignoreHTTPSErrors:true`。瀏覽器（含系統信任庫）一般正常。
另實測該站不穩定，曾出現 30 秒逾時（GL000794 首次載入失敗，重試成功）。節流要更保守。

### 3.1 條文頁網址格式
- `https://exlaw.klcg.gov.tw/LawContent.aspx?id={ID}`

實測可開啟範例：
- https://exlaw.klcg.gov.tw/LawContent.aspx?id=FL020381 （基隆市政府組織自治條例）
- https://exlaw.klcg.gov.tw/LawContent.aspx?id=GL000764 （基隆市政府停車場委外營運監督委員會設置要點）

### 3.2 DOM 結構 — **與桃園不同，這是最大的坑**
基隆五個法規全部實測（GL000795 / GL000768 / FL020381 / FL055070 / GL000764）：
```
#ctl00_cp_content_tableLawArticleBasic  -> 不存在 (table:false, trs:0)
.law-article 的子元素 -> DIV#ctl00_cp_content_divLawContent08
```
即基隆**沒有結構化條文表格**，全部條文塞在單一 div 內，以 `<br>` 與 `<span style="font-family: 新細明體">` 分隔：
```html
<div class="law-reg-content law-article">
  <div id="ctl00_cp_content_divLawContent08" class="ClearCss">
    <span style="font-family: 新細明體"><span>第 一 條<br>
本自治條例依地方制度法第六十二條及地方行政機關組織準則第三條規定<br>
制定之。<br>
<br>
第 二 條<br>
基隆市政府（以下簡稱本府）置市長一人，綜理市政，…
```
- 容器：`#ctl00_cp_content_divLawContent08`（或 `.law-article`）
- 條號：**無獨立元素**，只能用正則從文字流切分，例如 `/^第\s*[一二三四五六七八九十百零0-9\-]+\s*條/m`
- 條文內容：條號行之後到下一個條號行之前的文字

實測 `.law-article` innerText 起始（FL020381）：
`第一條 本辦法依… / 第二條 …`（GL000794 為 `第一條 本辦法依大眾捷運法第七條第四項規定訂定之。 第二條 …`）
注意 span 內外寫法不一致：同一頁同時出現 `第 一 條`（有空格）與 `第三條`（無空格）。

### 3.3 法規名稱 → ID
與桃園完全相同（共用系統）：
- 搜尋表單：`https://exlaw.klcg.gov.tw/LawQuery.aspx`，關鍵字欄位 `ctl00$cp_content$txtKW`，送出鈕 `ctl00$cp_content$btnQuery`
- **送出後導向可直接 GET 的結果頁**（實測 URL）：
```
https://exlaw.klcg.gov.tw/LawResult.aspx?NLawTypeID=all&KW={urlencoded關鍵字}&name=1&content=1&now=1&fei=1
```
- 結果頁取 ID：抓 `a[href^="LawContent.aspx?id="]`，取 `id` 參數。
- `LawQueryResult.aspx?TY=ONEBAR&KW=…` 實測 200 但無結果連結，**不要用**。

實測（KW=停車）：
- `GL000764` 基隆市政府停車場委外營運監督委員會設置要點
- `FL020381` 基隆市政府組織自治條例
- `FL055070` 基隆市市有財產管理作業辦法

ID 格式：`FL`/`GL` + 6 位數字。`FL` 多為自治條例/辦法，`GL` 多為要點/規定。

### 3.4 CSP 標頭（curl -kI 全文）
```
HTTP/1.1 200 OK
Cache-Control: private
Content-Type: text/html; charset=utf-8
Set-Cookie: JSESSIONID=…; path=/; secure; HttpOnly; SameSite=Lax
Set-Cookie: __AntiXsrfToken=…; path=/; secure; HttpOnly; SameSite=Lax
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
X-UA-Compatible: IE=Edge
Strict-Transport-Security: max-age=31536000
SERVER: -
```
**完全沒有 Content-Security-Policy 標頭。**（`curl -kI …LawContent.aspx?id=FL020381 | grep -ic content-security-policy` → `0`）
無 CSP = 無 connect-src 限制，同源與跨源 fetch 皆不受 CSP 阻擋（跨源仍受 CORS 管）。
實測：站內 `fetch('/LawContent.aspx?id=FL020381')` → `OK 200 len=30720`。**可行**。

### 3.5 歷史條文/沿革
有，與桃園相同：
- 法規沿革：`https://exlaw.klcg.gov.tw/LawContentSource.aspx?id={ID}`（實測連結 `LawContentSource.aspx?id=FL020381#lawmenu`）
- 歷史法規清單：`https://exlaw.klcg.gov.tw/LawContentHistoryList.aspx?id={ID}`
- 指定歷史版本：`LawContentHistory.aspx?hid={hid}&id={ID}`（型式同桃園，基隆未逐一取樣 hid）

### 3.6 條號書寫格式
**中文數字**：`第 一 條`、`第 二 條`、`第三條`、`第四條`、`第十一條`、`第十二條`。
同一頁面內空格有無不一致（`第 一 條` 與 `第三條` 並存），parser 必須容忍 `第\s*[中文數字]+\s*條`。
之X 格式本次未取樣到；依中文數字慣例應為「第○條之○」，使用前需實測。

---

## 4. 桃園市 — https://law.tycg.gov.tw/

系統名稱：桃園市政府主管法規共用系統（與基隆同一套，但條文頁為結構化表格）

### 4.1 條文頁網址格式
- `https://law.tycg.gov.tw/LawContent.aspx?id={ID}`

實測可開啟範例：
- https://law.tycg.gov.tw/LawContent.aspx?id=GL000352 （桃園市發展低碳綠色城市自治條例）
- https://law.tycg.gov.tw/LawContent.aspx?id=GL001046 （桃園市公有收費停車場身心障礙者優惠停車查核作業要點）

注意：無效 ID（例如 `FL051478`，那是臺北市的 ID）仍回 200，但 title 為空、`.law-article` 無子元素。需靠此判斷 404。

### 4.2 DOM 結構（實測 outerHTML）
```html
<div class="law-reg-content law-article">
  <table id="ctl00_cp_content_tableLawArticleBasic" class="table tab-list tab-nobg tab-law law-content">
    <tbody>
    <tr>
      <td colspan="2" class="th law-char-2" scope="col">　第 1 章  總則</td>
    </tr>
    <tr>
      <td scope="row" class="th">第 1 條</td>
      <td><div class="ClearCss">為因應氣候變遷，減緩溫室氣體成長，落實低碳生活，發展再生能源，建<br>
立低碳綠色城市，特制定本自治條例。</div></td>
    </tr>
```
- 單一條文容器：`#ctl00_cp_content_tableLawArticleBasic tr`（等同 `.law-article table.law-content tr`）
- 條號：`td.th[scope="row"]` → 實際文字 `"第 1 條"`
- 條文內容：`td:nth-child(2) > div.ClearCss`（換行為 `<br>`，縮排用 `&nbsp;` 或全形空白）
- 章節列：`td.th.law-char-2[colspan="2"]` → `"　第 1 章  總則"`，靠 `colspan` / `law-char-2` 區分
- 實測 tr 數：GL001046 → 7、GL000240 → 3、GL002730 → 28

### 4.3 法規名稱 → ID
- 搜尋表單：`https://law.tycg.gov.tw/LawQuery.aspx`，關鍵字欄位 `ctl00$cp_content$txtKW`，送出鈕 `ctl00$cp_content$btnQuery`
- **可直接 GET 的結果頁**（實測導向 URL）：
```
https://law.tycg.gov.tw/LawResult.aspx?NLawTypeID=all&KW={urlencoded關鍵字}&name=1&content=1&now=1&fei=1
```
參數意義：`name=1` 查名稱、`content=1` 查內容、`now=1` 現行、`fei=1` 含廢止。
- 結果頁取 ID：`a[href^="LawContent.aspx?id="]` 的 `id` 參數（連結另帶 `&kw=` 用於高亮）。

實測（KW=停車）：
- `GL001046` 桃園市公有收費停車場身心障礙者優惠停車查核作業要點
- `GL000352` 桃園市發展低碳綠色城市自治條例
- `GL000184` 桃園市政府住宅發展及都市更新處組織規程

ID 格式：`GL`/`FL` + 6 位數字。

### 4.4 CSP 標頭（curl -I 全文）
```
Content-Security-Policy: default-src 'self'; img-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; frame-src 'self'; frame-ancestors 'self'
```
其他：`X-Frame-Options: SAMEORIGIN`、`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`、`X-Content-Type-Options: nosniff`。

**connect-src 未明示，回落到 `default-src 'self'`** → 僅允許同源 fetch，跨源 fetch 會被 CSP 擋。
實測：站內 `fetch('/LawContent.aspx?id=GL000352')` → `OK 200 len=29430`。**可行（同源）**。
注意 `style-src 'self'`（無 `unsafe-inline`）→ bookmarklet **不能用 inline `<style>` 或 `element.style.cssText` 以外的注入樣式表**；`el.style.x=` 屬性設定不受 style-src 管制，但注入 `<style>` 標籤會被擋。臺北市與新北市有 `style-src 'unsafe-inline'`，基隆無 CSP，只有桃園有此限制。

### 4.5 歷史條文/沿革
有（實測頁面上的真實連結）：
- 法規沿革：`https://law.tycg.gov.tw/LawContentSource.aspx?id={ID}`（頁面連結為 `LawContentSource.aspx?id=GL000352#lawmenu`）
- 歷史法規清單：`https://law.tycg.gov.tw/LawContentHistoryList.aspx?id={ID}`
- 指定歷史版本：`https://law.tycg.gov.tw/LawContentHistory.aspx?hid={hid}&id={ID}`
  實測 GL000352 清單取到 `hid=13376`、`hid=1900`、`hid=1341`

### 4.6 條號書寫格式
**阿拉伯數字**：`第 1 條`、`第 5 條`（與臺北市相同）。
之X 用連字號：`第 3-1 條`（實測 GL000184 條號序列 `第 1 條 | 第 2 條 | 第 3 條 | 第 3-1 條 | 第 4 條 …`）。
章節：`第 1 章`（阿拉伯數字，前有全形空白）。

---

## 5. 總結表

### 5.1 可行性

| 站台 | 網域 | 條文頁可 GET | DOM 結構化 | 名稱→ID 可 GET | 同源 fetch 實測 | 歷史條文 | 結論 |
|---|---|---|---|---|---|---|---|
| 臺北市 | laws.gov.taipei | ✅ | ✅ 極佳 `.col-no`/`.law-articlepre` | ✅ GET SearchResult | ✅ 200/33549 | ✅ `?date=` | **可行（最佳）** |
| 桃園市 | law.tycg.gov.tw | ✅ | ✅ 佳，table `td.th`/`div.ClearCss` | ✅ GET LawResult.aspx | ✅ 200/29430 | ✅ hid | **可行** |
| 新北市 | web.law.ntpc.gov.tw | ✅ | ✅ 佳，`td.col-th`/`td.col-td pre` | ❌ 僅 POST+VIEWSTATE | ✅ 200/24234 | ✅ FLAWDAT07/08 | **可行（需預建 ID 對照表）** |
| 基隆市 | exlaw.klcg.gov.tw | ✅ | ❌ **無結構**，單一 div + `<br>` | ✅ GET LawResult.aspx | ✅ 200/30720 | ✅ hid | **可行但需正則切分** |

四站皆無「不可行」。無需登入、無 WAF 阻擋、無 JS 加密。

### 5.2 CSP 對照

| 站台 | connect-src 實際生效值 | 同源 fetch | style-src inline | frame 嵌入 |
|---|---|---|---|---|
| 臺北市 | `'self' data:`（由 default-src 繼承） | ✅ | ✅ `'unsafe-inline'` | ❌ X-Frame-Options: DENY |
| 新北市 | `'self' https://www.google-analytics.com`（明示） | ✅ | ✅ `'unsafe-inline'` | ⚠️ SAMEORIGIN |
| 基隆市 | 無 CSP 標頭 | ✅ | ✅ 無限制 | ⚠️ SAMEORIGIN |
| 桃園市 | `'self'`（由 default-src 繼承） | ✅ | ❌ **無 unsafe-inline** | ⚠️ SAMEORIGIN |

**bookmarklet 設計結論**：四站都可用同源 `fetch()` 取文，這是最重要的一點。但四站 `script-src` 都沒有 `'unsafe-eval'`，臺北/新北/桃園有 `'unsafe-inline'`，基隆無 CSP。`javascript:` bookmarklet 在有 CSP 但含 `'unsafe-inline'` 的頁面上，現代瀏覽器一般不受 script-src 阻擋（bookmarklet 被視為使用者主動行為，Chrome/Firefox 皆豁免），但桃園的 `style-src 'self'` 會實質阻擋注入 `<style>`，UI 樣式須改用 element inline style property 或 Shadow DOM + adoptedStyleSheets（後者同樣受 style-src 管制，需實測）。

### 5.3 條號格式對照

| 站台 | 條號格式 | 之X 表示 | 章節 |
|---|---|---|---|
| 臺北市 | `第 1 條` 阿拉伯 | `第 1-1 條`、`第 97-5 條` | — |
| 新北市 | `第  1  條` 阿拉伯（雙 nbsp）；URL `flno=3` | 未取樣，須實測 | — |
| 基隆市 | `第 一 條` / `第三條` **中文數字，空格不一致** | 未取樣，推測「第○條之○」，須實測 | — |
| 桃園市 | `第 1 條` 阿拉伯 | `第 3-1 條` | `　第 1 章  總則` |

parser 必須同時支援阿拉伯與中文數字，且容忍任意空白。基隆是唯一用中文數字的站。

### 5.4 系統家族

- **法規共用系統**（同一廠商同一套程式）：基隆 `exlaw.klcg.gov.tw` + 桃園 `law.tycg.gov.tw`。網址、表單欄位 ID、搜尋端點、沿革端點完全一致，**唯獨條文頁 DOM 不同**（桃園有 table，基隆沒有）。建議寫成同一 adapter + 兩種內容 parser fallback：先試 `#ctl00_cp_content_tableLawArticleBasic`，找不到則對 `#ctl00_cp_content_divLawContent08` 做正則切分。此 fallback 也能自動涵蓋其他縣市的同型系統。
- 臺北市、新北市各自獨立，需個別 adapter。

### 5.5 實作建議優先序

1. 桃園 + 基隆（共用一個 adapter，覆蓋最廣，搜尋可 GET）
2. 臺北（DOM 最乾淨，但 adapter 全新寫）
3. 新北（DOM 好，但名稱→ID 需離線預建對照表，工作量最大）

### 5.6 未驗證項目（誠實列出）

- 新北市 `flno` 對「之X」條號的參數寫法（未找到含之X的新北法規樣本）
- 基隆市「之X」條號的實際中文寫法
- 基隆市 `LawContentHistory.aspx` 的實際 hid 值（僅由桃園同型端點推得端點格式，基隆的 HistoryList 未逐一開啟）
- 臺北市章節標題的 DOM class（本次取樣的法規無章節）
- 各站 CORS 標頭（未測；但同源 fetch 已足夠，跨源非必要）
