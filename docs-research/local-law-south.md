# 台灣南部與東部離島地方法規查詢系統 · 技術調查

調查日期：2026-08-27（實測時間 2026-08-26T18:23–18:42 UTC）
方法：curl（`-I` 取標頭）＋ Playwright/Chromium 實際載入後 `querySelector` / `fetch`。
節流：每請求間隔 ≥1.2 秒。

---

## 0. 最重要的一項結論：11 站共用同一套系統

11 個站台**全部**是同一套 ASP.NET 產品「**主管法規共用系統（GLRS）**」的不同部署，
由 `<title>` 格式（`XX縣政府主管法規共用系統-法規內容-法規名稱`）、
相同的 ASP.NET control id 前綴 `ctl00_cp_content_*`、
相同的路由（`LawContent.aspx` / `SearchAllResultList.aspx` / `LawContentHistoryList.aspx`）證實。

差異只有三處：

| 差異點 | 說明 |
|---|---|
| **路徑前綴** | 8 站在網站根目錄；台南 `/glrsnewsout`、澎湖 `/glrsnewsout`、花蓮 `/glrsout` |
| **條文 DOM 模式** | 「TABLE 模式」（每條一個 `<tr>`）vs「BLOB 模式」（全部條文塞在一個 `<div>`） |
| **條號書寫** | 阿拉伯／中文數字混用，見第 6 節 |

**這代表 bookmarklet 只需寫一套解析器 + 一張站台設定表。**

### 站台一覽（全部實測 HTTP 200）

| 縣市 | 網域 | 路徑前綴 | DOM 模式 |
|---|---|---|---|
| 嘉義縣 | `law.cyhg.gov.tw` | （無） | BLOB |
| 嘉義市 | `law.chiayi.gov.tw` | （無） | BLOB |
| 台南市 | `law01.tainan.gov.tw` | `/glrsnewsout` | BLOB |
| 高雄市 | `outlaw.kcg.gov.tw` | （無） | BLOB |
| 屏東縣 | `ptlaw.pthg.gov.tw` | （無） | BLOB |
| 宜蘭縣 | `glrslaw.e-land.gov.tw` | （無） | **TABLE** |
| 花蓮縣 | `glrs.hl.gov.tw` | `/glrsout` | BLOB |
| 台東縣 | `law.taitung.gov.tw` | （無） | **TABLE** |
| 澎湖縣 | `law.penghu.gov.tw` | `/glrsnewsout` | BLOB |
| 金門縣 | `law.kinmen.gov.tw` | （無） | BLOB |
| 連江縣 | `law.matsu.gov.tw` | （無） | BLOB |

註：`law.tainan.gov.tw`、`law.pthg.gov.tw`、`law.e-land.gov.tw`、`law.hl.gov.tw`
皆為 **NXDOMAIN**（實測 `curl: (6) Could not resolve host`），不要使用這些猜測性網域。
`law.penghu.gov.tw/` 會 302 到 `/glrsnewsout/`；
`glrs.hl.gov.tw/` 會用 `<meta http-equiv="refresh" content="0; url=/glrsout/">` 轉向。

---

## 1. 通用規格（適用全部 11 站）

以 `BASE` 代表 `https://<網域><路徑前綴>`。

| 用途 | URL 樣式 |
|---|---|
| 法規條文頁 | `BASE/LawContent.aspx?id=<ID>` |
| 法規名稱搜尋 | `BASE/SearchAllResultList.aspx?KW=<URL編碼關鍵字>` |
| 歷史法規清單 | `BASE/LawContentHistoryList.aspx?id=<ID>` |
| 單一歷史版本 | `BASE/LawContentHistory.aspx?hid=<HID>&id=<ID>` |
| 分類清單 | `BASE/index.aspx?LawType=10%2c11`（自治條例／規則等） |

**法規 ID 格式**：`FL` 或 `GL` + 6 位數字，例如 `FL045222`、`GL000424`。
`FL` 多為較舊／來自全國法規資料庫同步者，`GL` 為該站自建者，兩者用法完全相同。

**不存在的端點**（實測回「系統發生非預期錯誤」）：
`LawSingle.aspx?id=..&no=..`、`LawArticleContent.aspx?id=..&no=..`。
**無法只取單一條文，必須抓整部法規再自行切條。**

---

## 2. Content-Security-Policy（第 4 題）

**實測結果：11 站全部「沒有 CSP 標頭」。**

`curl -I` 完整標頭範例（嘉義縣 `LawContent.aspx?id=GL000094`）：

```
HTTP/1.1 200 OK
Cache-Control: private
Content-Length: 27019
Content-Type: text/html; charset=utf-8
Set-Cookie: JSESSIONID=…; path=/; secure; HttpOnly; SameSite=Lax
Set-Cookie: __AntiXsrfToken=…; path=/; secure; HttpOnly; SameSite=Lax
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
X-UA-Compatible: IE=Edge
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Date: Wed, 26 Aug 2026 18:25:59 GMT
```

11 站逐一 `curl -I | grep -i content-security` 皆**無輸出**；
Playwright 讀 response headers 的 `content-security-policy` 也全部是 `null`；
HTML 內也沒有 `<meta http-equiv="Content-Security-Policy">`（實測 grep 無結果）。

**對 bookmarklet 的意義（比 law.moj.gov.tw 更寬鬆）：**

- 沒有 CSP ⇒ 沒有 `connect-src` 限制，同源 `fetch` 當然可行（已實測，見下）。
- 沒有 `style-src` 限制 ⇒ **inline style 可用**，不必像 law.moj.gov.tw 那樣改走 class-only 的路。
  （但為求跨站一致，仍建議沿用既有 class-only 寫法。）
- 只有 `X-Frame-Options: SAMEORIGIN`，影響 iframe 而非 fetch。

**同源 fetch 實測**（在各站條文頁上以 `page.evaluate` 執行）：

| 站 | `fetch(BASE+'/SearchAllResultList.aspx?KW=組織規程')` | 回應長度 | 第一筆命中 |
|---|---|---|---|
| 嘉義縣 | 200 ok | 29489 | 嘉義縣消防局組織規程 → `LawContent.aspx?id=FL045222&kw=...` |
| 嘉義市 | 200 ok | 30445 | 嘉義市殯葬管理所組織規程 → `id=FL025696` |
| 台南市 | 200 ok | 31362 | 臺南市政府衛生局組織規程 → `id=FL057985` |
| 高雄市 | 200 ok | 22924 | 高雄市市立高級中等學校組織規程準則 → `id=GL001775` |
| 屏東縣 | 200 ok | 29530 | 屏東縣政府消防局組織規程 → `id=FL041206` |
| 宜蘭縣 | 200 ok | 30156 | 宜蘭縣動植物防疫所組織規程 → `id=FL023575` |
| 花蓮縣 | 200 ok | 30348 | 花蓮縣政府組織自治條例 → `id=GL000556` |
| 台東縣 | 200 ok | 29330 | 臺東縣環境保護局組織規程 → `id=FL023990` |
| 澎湖縣 | 200 ok | 30039 | 澎湖縣政府消防局組織規程 → `id=FL022405` |
| 金門縣 | 200 ok | 29567 | 金門縣地政局組織規程 → `id=FL001881` |
| 連江縣 | 200 ok | 29609 | 連江縣政府組織自治條例 → `id=FL033849` |

**11/11 同源取文可行，不需伺服器。**

---

## 3. 條文 DOM 結構（第 2 題）

### 3a. TABLE 模式（宜蘭縣、台東縣）

包住單一條文的 selector：

```
#ctl00_cp_content_tableLawArticleBasic tr
```

- **條號**：`tr > td[scope="row"].th`
- **條文內容**：`tr > td:nth-child(2) > div.ClearCss`
- 章節標題列為 `td[colspan="2"].th.law-char-2`（沒有 `scope="row"`），過濾用。

實測（`https://law.taitung.gov.tw/LawContent.aspx?id=FL023844`，臺東縣議會組織自治條例）：

```
querySelector('#ctl00_cp_content_tableLawArticleBasic') → 命中
符合 td.th[scope=row] 的 tr 數：35
第 1 列條號 innerText：「第 1 條」
第 1 列內容 innerText：「本自治條例依地方立法機關組織準則第三條第二項規定制定之。」
```

原始 HTML：

```html
<table id="ctl00_cp_content_tableLawArticleBasic" class="table tab-list tab-nobg tab-law law-content">
 <tr><td colspan="2" class="th law-char-2" scope="col">   第 一 章 總則</td></tr>
 <tr>
  <td scope="row" class="th">第 1 條</td>
  <td><div class="ClearCss">
本自治條例依地方立法機關組織準則第三條第二項規定制定之。<br>
</div></td>
 </tr>
 ...
```

宜蘭縣同構（`id=FL023575`，宜蘭縣動植物防疫所組織規程）：
`tr` 數 = 10，第 1 列條號「第 1 條」，
內容「宜蘭縣政府(以下簡稱本府)為辦理轄內動植物疾病防治業務，依動物傳染病防治條例第八條第二項…」。

### 3b. BLOB 模式（其餘 9 站）

**沒有任何 selector 包住單一條文。** 整部法規是一團 HTML，全部塞在：

```
#ctl00_cp_content_divLawContent08        （常見；class="ClearCss"）
```

穩健寫法用前綴屬性選擇器（實測樣本 118 份檔案中出現 `divLawContent08` ×117、`divLawContent50` ×1）：

```js
document.querySelector('[id^="ctl00_cp_content_divLawContent"]')
```

外層固定結構（各站一致）：

```html
<div id="ctl00_cp_content_divContent" class="well law-reg law-content">
  <div class="law-reg-content law-article">
    <div id="ctl00_cp_content_divLawContent08" class="ClearCss"> …整部法規… </div>
  </div>
</div>
```

內部長相**因法規而異，沒有統一標記**，實測到三種：

1. **`<strong>` 標條號**（嘉義縣 `FL045222`，`strong` 共 14 個，第一個 innerText 為「第 一 條」）：
```html
<p><strong>第 一 條</strong> &nbsp; &nbsp;本規程依嘉義縣政府組織自治條例第十二條規定訂定之。<br>
<strong>第 二 條</strong>　　嘉義縣消防局（以下簡稱本局）置局長，承縣長之命綜理局<br>…
```
2. **Word 貼上的 `<p class="x_x_x_x_MsoNormal">` + `<span style="font-family: 標楷體">`**（台南市 `GL000424`）：
```html
<p class="x_x_x_x_MsoNormal" style="margin-left: 70.7pt; text-indent: -70.7pt; …">
<span style="font-family: 標楷體">第　一　條　　為推廣文化藝術展演活動，以提升臺南市總爺藝文中心（以下簡稱本中心）使用效能，並依規費法第十條第一項規定，訂定本辦法。</span></p>
```
3. **純 `<span>` + `<br>` 純文字排版**（高雄市 `GL001457`）：
```html
<span style="text-justify: inter-ideograph"><span>第 一 條　　為規範本市社會住宅承租者之申請資格、程序、租金計算、分級收費<br>
&nbsp; &nbsp; &nbsp; &nbsp; 、租賃與續租期限及其他事項，並依住宅法第二十五條第二項規定訂定本<br>…
```

**結論：BLOB 模式必須用文字切分，不能靠 DOM。**
建議取 `blob.innerText`，正規化空白（見第 6 節），再以條號正則切段。

`innerText` 實測樣本（皆為各站真實輸出）：

- 澎湖 `FL022405`：`第 一 條\n本規程依澎湖縣政府組織自治條例第十一條規定訂定之。\n\n第 二 條\n澎湖縣政府消防局（以下簡稱本局）置局長…`
- 金門 `FL001881`：`第 1 條\n本規程依金門縣政府組織自治條例第十二條規定訂定之。\n\n第 2 條\n金門縣地政局（以下簡稱本局）依法辦理本縣地政業務。`
- 連江 `FL033849`：`第一條\xa0 \xa0 本自治條例依地方制度法第六十二條第二項及地方行政機關組織準則第三條第二項規定\n\xa0 \xa0 \xa0 制定之。`
- 花蓮 `GL000556`：`第            一         條   　        本自治條例依地方行政機關組織準則第三條第二項規定制定之。`
- 嘉義市 `FL022418`：`第\xa0一\xa0章\xa0\xa0總則\n第\xa01\xa0條\n本自治條例依地方制度法第六十條規定訂定之。`
- 屏東 `FL052134`：`一、屏東縣政府（以下簡稱本府）為獎勵體育成績優秀運動選手及教練…`（要點類，用「一、」不用「第 X 條」）

### 3c. 模式普查（每站抽 6–8 部真實法規，共 88 份）

以 `SearchAllResultList.aspx?KW=自治條例` 取前 8 個 id 逐一抓取，
判準為 HTML 是否含 `tableLawArticleBasic`：

```
嘉義縣 TABLE=0 BLOB=8      宜蘭縣 TABLE=8 BLOB=0
嘉義市 TABLE=0 BLOB=7      花蓮縣 TABLE=0 BLOB=8
台南市 TABLE=0 BLOB=8      台東縣 TABLE=8 BLOB=0
高雄市 TABLE=0 BLOB=6      澎湖縣 TABLE=0 BLOB=7
屏東縣 TABLE=0 BLOB=8      金門縣 TABLE=0 BLOB=8
                            連江縣 TABLE=0 BLOB=8
```

**注意：模式是「逐部法規」而非「逐站」決定的。**
另一輪以分類清單（`index.aspx?LawType=10,11`）抽樣時，
宜蘭 `GL000189` 為 BLOB、台東 `FL027319` 為 BLOB。
**因此程式必須每頁先偵測，不可用站台白名單硬編。**
偵測法：`if (document.querySelector('#ctl00_cp_content_tableLawArticleBasic')) TABLE else BLOB`。

---

## 4. 法規名稱 → ID（第 3 題）

**端點**（GET，無需 POST、無需 VIEWSTATE、無需登入）：

```
BASE/SearchAllResultList.aspx?KW=<encodeURIComponent(法規名稱)>
```

可加 `&type=B`（法規）／`E`（英譯）／`D`（草案），預設即 `B`。

**從結果頁取 ID**：

```js
const doc = new DOMParser().parseFromString(html, 'text/html');
const hits = [...doc.querySelectorAll('table.tab-result a[href*="LawContent.aspx?id="]')]
  .map(a => ({ name: a.textContent.trim(),
                id: a.getAttribute('href').match(/id=([A-Z]{2}\d+)/)[1] }));
```

結果表 selector：`table.table.table-hover.tab-list.tab-result`；
每列 `<tr>` 三欄（序、資料日期、法規名稱）；
連結 id 為 `ctl00_cp_content_rptBList_ctl<NN>_hlkLawName`。

實際回應片段（嘉義縣，`KW=自治條例`，共 176 筆）：

```html
<li class="active"><a href="SearchAllResultList.aspx?KW=%e8%87%aa%e6%b2%bb%e6%a2%9d%e4%be%8b&type=B">法規查詢<span class="badge">176</span></a></li>
…
<td colspan="2"><a id="ctl00_cp_content_rptBList_ctl01_hlkLawName"
   href="LawContent.aspx?id=FL045222&amp;kw=%e8%87%aa%e6%b2%bb%e6%a2%9d%e4%be%8b">嘉義縣消防局組織規程</a>
```

命中數可從 `span.badge` 取得。11 站以 `KW=組織規程` 實測的命中數：
嘉義縣（未計）、嘉義市 24、台南市 204、高雄市 5、屏東縣 28、宜蘭縣 42、
花蓮縣 32、台東縣 28、澎湖縣 23、金門縣 45、連江縣 22。

**注意**：這是**全文/模糊比對**，不是精確法規名比對，
且名稱前綴常含縣市名（「嘉義縣消防局組織規程」）。
bookmarklet 需在結果中做精確名稱比對，或優先取完全相等者。

`LawQuery.aspx` 是完整檢索表單，但為 ASP.NET PostBack（含 `__VIEWSTATE`、
`__VIEWSTATEENCRYPTED`、`__EVENTVALIDATION`、26 個 `cbCategoryID*`），**不建議使用**。
`SearchAllResultList.aspx` 純 GET 已足夠。

---

## 5. 歷史條文／沿革（第 5 題）

**11 站全部有。** 條文頁上有按鈕：

```html
<a id="ctl00_cp_content_lawheader1_aLawContentHistory" class="btn btn-default"
   href="LawContentHistoryList.aspx?id=FL045222">歷史法規</a>
```

- 清單頁：`BASE/LawContentHistoryList.aspx?id=<ID>`
- 單一版本：`BASE/LawContentHistory.aspx?hid=<HID>&id=<ID>`

實測（每站皆 HTTP 200，取到 ≥1 個 `hid`）：

| 站 | 樣本 | 取得的歷史連結 |
|---|---|---|
| 嘉義縣 | FL045222 | `hid=391679`, `391562`, `391273`, `503`, `126` |
| 嘉義市 | FL022418 | `hid=30884` |
| 台南市 | GL000424 | `hid=13573`, `13406` |
| 高雄市 | GL001457 | `hid=21035`, `10673` |
| 屏東縣 | FL052134 | `hid=656`, `155` |
| 宜蘭縣 | FL023575 | `hid=2156`, `2087` |
| 花蓮縣 | GL000556 | `hid=2879`, `2828` |
| 台東縣 | FL023844 | `hid=11474`, `1059`, `839` |
| 澎湖縣 | FL022405 | `hid=2556`, `2557` |
| 金門縣 | FL001881 | `hid=11119`, `1068` |
| 連江縣 | FL033849 | `hid=10369`, `10310` |

`hid` 是**該站內部流水號，跨站不通用**。

---

## 6. 條號書寫格式（第 6 題）—— 這是本任務最麻煩的部分

**沒有統一格式。同一站內不同法規就不一樣。** 實測結果：

### 6a. TABLE 模式的 `td.th`

| 站 | 樣本 | 條號原文 |
|---|---|---|
| 台東 | FL023844 / FL022301 / GL000102 … | `第 1 條`（阿拉伯，兩側半形空格） |
| 宜蘭 | FL023575, FL044008 | `第 1 條` |
| 宜蘭 | FL023591, FL023592, FL023610, FL023618, FL023622, FL030364 | `第一條`（中文，無空格） |

**之X條**（台東實測）：
- `FL046124` → `第 16 條之1`（阿拉伯，「之」後無空格）
- `GL000135` → `第4條之1`、`第6條之1`、`第6條之2`（**完全無空格**）

### 6b. BLOB 模式的內文（`innerText` 原文，用 Python `repr` 呈現）

```
台南市 FL057985  '第\u3000一\u3000條'      ← 全形空格 U+3000 + 中文數字
台南市 FL058290  '第\u3000二\u3000條'
嘉義市 FL022819  '第一條'                   ← 無空格 + 中文數字
嘉義市 FL025765  '第\u3000一\u3000條'
嘉義縣 FL045222  '第 一 條'                 ← 半形空格 + 中文數字
嘉義縣 FL031619  '第一條'
屏東縣 FL041229  '第\xa0一\xa0條'           ← NBSP U+00A0 + 中文數字
屏東縣 FL031620  '第 一 條'
澎湖縣 FL022716  '第\xa01\xa0條'            ← NBSP + 阿拉伯
澎湖縣 FL022754  '第\u3000一\u3000條'
金門縣 FL001881  '第 1\n條'                 ← 中間有換行！
金門縣 FL030838  '第\xa01\xa0條'
金門縣 FL033051  '第九條'
連江縣 GL000203  '第\xa0\n一\xa0 條'        ← NBSP + 換行 + 空格混雜
連江縣 GL000372  '第一條'
花蓮縣 FL023938  '第\xa0 \xa0 \xa0 \xa0一\xa0 \xa0 \xa0 \xa0 \xa0 條'   ← 極端
花蓮縣 FL048261  '第\xa0 \xa0 一 \xa0\xa0 條'
花蓮縣 FL036873  '第\xa026\xa0條'
高雄市 GL000627  '第\u3000\u3000一\u3000 \u3000條'
高雄市 GL000595  '第 一 條'
```

### 6c. 實作建議

解析前**必須先正規化**：

```js
const norm = s => s.replace(/[\u00a0\u3000\s]+/g, '');   // 去掉 NBSP、全形空格、換行
// 之後統一比對：/^第([0-9０-９一二三四五六七八九十百]+)條(?:之([0-9一二三四五六七八九十]+))?/
```

並**兩種數字系統都要支援**（阿拉伯與中文），且需能互轉，
因為引用文字（「第七十七條之二」）與目標頁條號（「第 77 條之2」）常不同系統。

### 6d. 大量「要點／原則」類法規根本沒有「條」

改用「一、二、三、」點次（全形頓號），例如：

- 屏東 `FL052134`「屏東縣體育獎勵金頒發要點」→ `一、屏東縣政府（以下簡稱本府）…`
- 台南 `FL059817`「臺南市小型學校午餐費補助處理原則」→ `一、本處理原則之訂定…`
- 花蓮 `FL045654`「教育專業人員獎懲作業要點」→ `一、花蓮縣政府（以下簡稱本府）…`
- 嘉義縣 `GL000094`「災害防救辦公室設置要點」→ `一、嘉義縣政府（以下簡稱本府）…`
- 台東 `FL041527`（TABLE 模式）→ `td.th` **為空字串**，內容為 `一、臺東縣政府…`

台東 `FL041527` 的實際 HTML（注意條號欄是空的）：

```html
<tr>
  <td scope="row" class="th"></td>
  <td><div class="ClearCss">一、臺東縣政府為期使本縣國民中學學校（以下簡稱各校）每週授課節<br>
&nbsp;&nbsp;&nbsp; 數得有依據，…</div></td>
</tr>
```

而且列表頁的更新公告用的正是「點」：
「修正『嘉義縣政府災害防救辦公室設置要點』**第 4 點**附表二」。
**bookmarklet 若只認「第X條」，會漏掉相當比例的地方法規。**

---

## 7. 逐站範例網址（第 1 題，每站 ≥2 個，皆實測可直接開啟 HTTP 200）

| 縣市 | 範例 1 | 範例 2 |
|---|---|---|
| 嘉義縣 | `https://law.cyhg.gov.tw/LawContent.aspx?id=FL045222`（嘉義縣消防局組織規程） | `https://law.cyhg.gov.tw/LawContent.aspx?id=GL000094`（嘉義縣政府災害防救辦公室設置要點） |
| 嘉義市 | `https://law.chiayi.gov.tw/LawContent.aspx?id=FL022418`（嘉義市里民大會暨基層建設座談會自治條例） | `https://law.chiayi.gov.tw/LawContent.aspx?id=FL025696`（嘉義市殯葬管理所組織規程） |
| 台南市 | `https://law01.tainan.gov.tw/glrsnewsout/LawContent.aspx?id=GL000424`（臺南市總爺藝文中心場地使用管理辦法） | `https://law01.tainan.gov.tw/glrsnewsout/LawContent.aspx?id=FL059817`（臺南市小型學校午餐費補助處理原則） |
| 高雄市 | `https://outlaw.kcg.gov.tw/LawContent.aspx?id=GL001457`（高雄市社會住宅出租辦法） | `https://outlaw.kcg.gov.tw/LawContent.aspx?id=GL000026`（高雄市老人福利機構評鑑及獎勵辦法） |
| 屏東縣 | `https://ptlaw.pthg.gov.tw/LawContent.aspx?id=FL052134`（屏東縣體育獎勵金頒發要點） | `https://ptlaw.pthg.gov.tw/LawContent.aspx?id=FL041206`（屏東縣政府消防局組織規程） |
| 宜蘭縣 | `https://glrslaw.e-land.gov.tw/LawContent.aspx?id=FL023575`（宜蘭縣動植物防疫所組織規程） | `https://glrslaw.e-land.gov.tw/LawContent.aspx?id=FL023591` |
| 花蓮縣 | `https://glrs.hl.gov.tw/glrsout/LawContent.aspx?id=GL000556`（花蓮縣政府組織自治條例） | `https://glrs.hl.gov.tw/glrsout/LawContent.aspx?id=FL045654`（教育專業人員獎懲作業要點） |
| 台東縣 | `https://law.taitung.gov.tw/LawContent.aspx?id=FL023844`（臺東縣議會組織自治條例） | `https://law.taitung.gov.tw/LawContent.aspx?id=FL023990`（臺東縣環境保護局組織規程） |
| 澎湖縣 | `https://law.penghu.gov.tw/glrsnewsout/LawContent.aspx?id=FL022405`（澎湖縣政府消防局組織規程） | `https://law.penghu.gov.tw/glrsnewsout/LawContent.aspx?id=FL022755`（澎湖縣鄉縣轄市衛生所組織規程） |
| 金門縣 | `https://law.kinmen.gov.tw/LawContent.aspx?id=FL001881`（金門縣地政局組織規程） | `https://law.kinmen.gov.tw/LawContent.aspx?id=GL000046` |
| 連江縣 | `https://law.matsu.gov.tw/LawContent.aspx?id=FL033849`（連江縣政府組織自治條例） | `https://law.matsu.gov.tw/LawContent.aspx?id=GL000288` |

---

## 8. 總結表：可行性

| 縣市 | 可存取 | 無 CSP 阻礙 | 同源 fetch 實測 | 搜尋端點 | 歷史條文 | 條文可解析 | **結論** |
|---|---|---|---|---|---|---|---|
| 嘉義縣 | ✅ | ✅ 無 CSP | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |
| 嘉義市 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |
| 台南市 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行**（注意 `/glrsnewsout`） |
| 高雄市 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |
| 屏東縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |
| 宜蘭縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | TABLE / BLOB 混合 | **可行**（最佳） |
| 花蓮縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行**（注意 `/glrsout`，條號空白極亂） |
| 台東縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | TABLE / BLOB 混合 | **可行**（最佳） |
| 澎湖縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行**（注意 `/glrsnewsout`；伺服器偶爾逾時） |
| 金門縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |
| 連江縣 | ✅ | ✅ | ✅ 200 | ✅ | ✅ | BLOB 文字切分 | **可行** |

**11 站全部可行，沒有任何一站不可行。**

### 已觀察到的注意事項（非阻斷）

1. **澎湖縣（`law.penghu.gov.tw`）伺服器偶發逾時**：3 次請求中出現 1 次
   `curl: (28) Connection timed out`，重試即成功。需要重試機制。
2. **花蓮縣（`glrs.hl.gov.tw`）與台東縣（`law.taitung.gov.tw`）有 WAF**：
   使用 Playwright 預設 headless UA 時回 `HTTP 500 "The URL you requested has been blocked"`；
   換成一般 Chrome UA 後即正常 200。實務上 bookmarklet 在真實瀏覽器執行，不受影響。
3. **`X-Frame-Options: SAMEORIGIN`**：11 站皆有。不要用跨站 iframe 取文，用同源 `fetch`。
4. **台東縣 HSTS 極短**（`max-age=12`），無實質影響。
5. **無法取單一條文**，必須抓整部法規（回應約 20–35 KB）再切。建議做 per-id 快取。

### 建議的站台設定表

```js
const SITES = {
  'law.cyhg.gov.tw':      { name: '嘉義縣', base: '' },
  'law.chiayi.gov.tw':    { name: '嘉義市', base: '' },
  'law01.tainan.gov.tw':  { name: '臺南市', base: '/glrsnewsout' },
  'outlaw.kcg.gov.tw':    { name: '高雄市', base: '' },
  'ptlaw.pthg.gov.tw':    { name: '屏東縣', base: '' },
  'glrslaw.e-land.gov.tw':{ name: '宜蘭縣', base: '' },
  'glrs.hl.gov.tw':       { name: '花蓮縣', base: '/glrsout' },
  'law.taitung.gov.tw':   { name: '臺東縣', base: '' },
  'law.penghu.gov.tw':    { name: '澎湖縣', base: '/glrsnewsout' },
  'law.kinmen.gov.tw':    { name: '金門縣', base: '' },
  'law.matsu.gov.tw':     { name: '連江縣', base: '' },
};
// 條文頁 : `${base}/LawContent.aspx?id=${id}`
// 搜尋   : `${base}/SearchAllResultList.aspx?KW=${encodeURIComponent(name)}`
// 歷史   : `${base}/LawContentHistoryList.aspx?id=${id}`
```

---

## 附註：未修改任何專案檔案

`/home/enor/enor_agi/misc/law-hover-bookmarklet` 底下**未做任何寫入**。
所有暫存檔位於 `/tmp/`（`probe.js`、`probe2.js`、`probe3.js`、`hl.js`、`sample.sh`、`s2.sh`、抓取的 HTML）。
