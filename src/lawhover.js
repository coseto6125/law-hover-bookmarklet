/* 法條懸停 bookmarklet - 在法規網站上就地顯示被引用的條文
 * 同源 fetch，不需伺服器。各站 CSP 的 connect-src 'self' 允許。
 */
(function () {
  'use strict';
  if (window.__lawhover__) { window.__lawhover__.toggle(); return; }

  var HOST = location.origin;
  var LC = HOST + '/LawClass/';     // 中央站路徑前綴，出現 5 次
  var ENC = encodeURIComponent;     // 出現 8 次
  var T_HIST = '查看完整沿革';
  var T_WHOLE = '（全文修正）';

  /* ---------- 站台設定 ----------
   * 同源政策使得書籤只能取得「當前網域」的條文，因此支援多站的做法是
   * 讓同一份書籤在各站都能運作，而非從中央站去抓地方法規。
   *
   * 每個站台需描述：
   *   match       判斷目前頁面屬於哪個站
   *   name        站台名稱（顯示用）
   *   selfLaw()   取出本頁法規的識別碼與名稱
   *   articleUrl  組出單一條文的網址
   *   searchUrl   由法規名稱搜尋的網址
   *   pickId      從搜尋結果頁取出法規識別碼
   *   parse       從條文頁解析出條號與內容
   *   history     沿革頁網址（沒有則為 null）
   */
  var SITES = [
    {
      id: 'moj',
      name: '全國法規資料庫',
      match: /(^|\.)law\.moj\.gov\.tw$/,
      idParam: 'pcode',
      headSel: '.col-no',
      resultSel: 'a[href*="pcode="]',
      idRe: /pcode=([A-Z0-9]+)/i,
      selfLaw: function () {
        var m = /pcode=([A-Z0-9]+)/i.exec(location.search);
        if (!m) return null;
        var el = document.querySelector('#hlLawName, #pnLawFla .h2, .table-list .h3');
        return { id: m[1], name: el ? el.textContent.trim() : '本法' };
      },
      articleUrl: function (id, flno) {
        return LC + 'LawSingle.aspx?pcode=' + id + '&flno=' + ENC(flno);
      },
      searchUrl: function (name) {
        return HOST + '/Law/LawSearchResult.aspx?ty=ONEBAR&kw=' + ENC(name) + '&sNo=0';
      },
      historyUrl: function (id) { return LC + 'LawHistory.aspx?pcode=' + id; }
    },
    {
      id: 'taipei',
      name: '臺北市法規查詢系統',
      match: /(^|\.)laws\.gov\.taipei$/,
      idParam: 'FL',
      headSel: '.col-no',
      // 臺北搜尋結果連到 /Law/LawSearch/LawInformation/FL039973
      resultSel: 'a[href*="LawInformation/"]',
      idRe: /LawInformation\/(FL\d+)/i,
      selfLaw: function () {
        // 網址形如 /Law/LawSearch/LawArticleContent/FL039973
        var m = /\/(FL\d+)/i.exec(location.pathname);
        if (!m) return null;
        var el = document.querySelector('.cont-title, .law-title, .col-article h3');
        var nm = el ? el.textContent.trim() : '';
        if (!nm || nm.length > 40) {
          // 退回頁面上第一個條號所屬區塊的標題
          var h = document.querySelector('h3');
          nm = h ? h.textContent.split('\n')[0].trim() : '本法規';
        }
        return { id: m[1], name: nm };
      },
      articleUrl: function (id) {
        // 台北沒有單條端點，取全文後再由 parse 挑出該條
        return HOST + '/Law/LawSearch/LawArticleContent/' + id;
      },
      searchUrl: function (name) {
        return HOST + '/Law/Search/SearchResult?SearchString.Keyword1=' + ENC(name);
      },
      historyUrl: function (id) {
        return HOST + '/Law/LawSearch/LawInformation/' + id;
      },
      wholePage: true      // articleUrl 回傳全文，需自行挑條
    }
  ];

  /* 地方法規：20 個縣市共用同一套「主管法規共用系統」，
   * 端點與參數完全相同，只有 host 與路徑前綴不同。
   * 條文 DOM 有兩種模式（table / blob），需執行時探測而非查表，
   * 因為同一套系統在不同縣市的樣板不一致。 */
  var GLRS = {
    'exlaw.klcg.gov.tw': '基隆市', 'law.tycg.gov.tw': '桃園市',
    'hclaw.hsinchu.gov.tw/law': '新竹縣', 'law.hccg.gov.tw': '新竹市',
    'law.miaoli.gov.tw/glrsnewsout': '苗栗縣', 'law.taichung.gov.tw': '臺中市',
    'lawsearch.chcg.gov.tw/GLRSNEWSOUT': '彰化縣', 'glrs.nantou.gov.tw': '南投縣',
    'law.yunlin.gov.tw': '雲林縣', 'law.cyhg.gov.tw': '嘉義縣',
    'law.chiayi.gov.tw': '嘉義市', 'law01.tainan.gov.tw/glrsnewsout': '臺南市',
    'outlaw.kcg.gov.tw': '高雄市', 'ptlaw.pthg.gov.tw': '屏東縣',
    'glrslaw.e-land.gov.tw': '宜蘭縣', 'glrs.hl.gov.tw/glrsout': '花蓮縣',
    'law.taitung.gov.tw': '臺東縣', 'law.penghu.gov.tw/glrsnewsout': '澎湖縣',
    'law.kinmen.gov.tw': '金門縣', 'law.matsu.gov.tw': '連江縣'
  };

  // 找出目前頁面對應的共用系統設定（含路徑前綴）
  var glrsKey = (function () {
    var h = location.hostname;
    if (GLRS[h]) return h;
    for (var k in GLRS) {
      if (k.indexOf(h + '/') === 0 &&
          location.pathname.toLowerCase().indexOf('/' + k.split('/')[1].toLowerCase()) === 0) return k;
    }
    return null;
  })();

  if (glrsKey) {
    var glrsBase = HOST + (glrsKey.indexOf('/') > 0 ? '/' + glrsKey.split('/')[1] : '');
    SITES.push({
      id: 'glrs',
      name: GLRS[glrsKey] + '法規查詢系統',
      match: /.*/,
      // table 模式用 td.th[scope=row]；blob 模式沒有條號元素，故可能為 0
      headSel: 'td.th[scope="row"], .col-no',
      // 地方共用系統搜尋結果連到 LawContent.aspx?id=GL000683
      resultSel: 'a[href*="LawContent"][href*="id="]',
      idRe: /[?&]id=([A-Za-z0-9]+)/i,
      selfLaw: function () {
        var m = /[?&]id=([A-Za-z0-9]+)/i.exec(location.search);
        if (!m) return null;
        // 法規名在 <title> 最後一段：「○○縣政府主管法規共用系統-法規內容-○○自治條例」
        var t = document.title.split('-');
        var nm = t.length > 2 ? t[t.length - 1].trim() : '';
        if (!nm) {
          var el = document.querySelector('#ctl00_cp_content_lbLawName, .law-name');
          nm = el ? el.textContent.trim() : '本法規';
        }
        return { id: m[1], name: nm };
      },
      articleUrl: function (id) { return glrsBase + '/LawContent.aspx?id=' + id; },
      searchUrl: function (name) { return glrsBase + '/SearchAllResultList.aspx?KW=' + ENC(name); },
      historyUrl: function (id) { return glrsBase + '/LawContentHistoryList.aspx?id=' + id; },
      wholePage: true
    });
  }

  var SITE = (function () {
    for (var i = 0; i < SITES.length; i++) {
      if (SITES[i].match.test(location.hostname)) return SITES[i];
    }
    return null;
  })();
  var CN = { 零:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10,
             壹:1, 貳:2, 參:3, 肆:4, 伍:5, 陸:6, 柒:7, 捌:8, 玖:9, 拾:10 };

  // 中文數字轉阿拉伯（支援 十/百/千，如 七十七、一百二十）
  function cn2num(s) {
    s = String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var total = 0, section = 0, num = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '千' || c === '仟') { section += (num || 1) * 1000; num = 0; }
      else if (c === '百' || c === '佰') { section += (num || 1) * 100; num = 0; }
      else if (c === '十' || c === '拾') { section += (num || 1) * 10; num = 0; }
      else if (CN[c] !== undefined) { num = CN[c]; }
      else if (/\d/.test(c)) { num = num * 10 + parseInt(c, 10); }
    }
    total = section + num;
    return total || null;
  }

  var NUM = '[0-9０-９一二三四五六七八九十百千零壹貳參肆伍陸柒捌玖拾佰仟]+';
  /* 法規名稱可能的結尾字。順序重要：長字尾必須排在短字尾之前，
   * 否則「憲法增修條文」會先被「條文」以外的短字尾切斷。
   *   憲法增修條文 → 中華民國憲法增修條文
   *   編           → 建築技術規則建築設計施工編
   *   憲法         → 中華民國憲法（不能只靠「法」，否則名稱會被切成「國憲法」） */
  var SUFFIX = '(?:憲法增修條文|自治條例|自治規則|施行條例|組織條例|條例|規則|辦法|標準|' +
               '細則|準則|通則|規程|規範|要點|基準|公約|憲法|編|法)';
  var TAIL = '(?:\\s*第\\s*(' + NUM + ')\\s*項)?(?:\\s*第\\s*(' + NUM + ')\\s*款)?';
  // 具名引用：法規名稱 + 第X條(之X) + 可選 項/款
  var RE = new RegExp(
    /* 長度上限放寬：官方法規名可達 40 字以上，例如
     * 「營造業承攬工程造價限額工程規模範圍申報淨值及一定期間承攬總額認定辦法」（34 字）。
     * 原本 20/30 字上限會讓具名比對失敗，接著裸條號規則把內部的「第3條」
     * 綁成本頁法規，顯示出條號正確但法規完全錯誤的條文（codex review 實測）。 */
    /* 下限必須是 1 不是 2：SUFFIX 含單字元的「法」，若要求名稱前段至少 2 字，
     * 「民法」「刑法」「憲法」這類 2 字法規名就完全比對不到，接著被裸條號規則
     * 綁成本頁法規，顯示完全不相干的條文且無任何提示
     * （fable review 以 8574 個真實條文段落實測，公司法第192條即為實例）。 */
    '(?:「([^」]{2,60}?' + SUFFIX + ')」|([\\u4e00-\\u9fa5]{1,45}?' + SUFFIX + '))' +
    '\\s*第\\s*(' + NUM + ')\\s*條' +
    '(?:\\s*之\\s*(' + NUM + '))?' + TAIL,
    'g');
  // 裸條號：本法／同法／前法規名皆省略，指向當前頁面的法規
  // （法規內文最常見的形式，如「依第九十九條規定」「本法第五條」）
  var SUFFIX_ONLY = new RegExp('^' + SUFFIX + '$');
  // 這些字既是法規名字尾，本身也是真實存在的法規
  var REAL_LAW_NAMES = ['憲法', '民法', '刑法'];
  /* 自指詞（指本頁法規）與前指詞（指前文最近提到的法規）語意不同，必須分開。
   * 「同法」「該法」在條文中一律是前指，綁成本頁法規會顯示另一部法的條文
   * （codex review 實測：行政程序法頁面上「建築法第五條及同法第七條」，
   *   後者被綁成行政程序法）。 */
  var SELF_WORDS = ['本法', '本條例', '本規則', '本辦法', '本標準', '本細則',
                    '本準則', '本通則'];
  var ANAPHORA = ['同法', '同條例', '同規則', '同辦法', '該法', '該條例', '該規則', '該辦法'];

  /* 自指詞的實際指向。
   * 子法常定義「○○法（以下簡稱本法）」，此時「本法」指母法而非本頁。
   * 同一部法規可能定義多組別名（如所得稅法與臺灣地區與大陸地區人民關係條例），
   * 因此必須建立「自指詞 → 法規」對照，不能只記第一組
   * （codex review 實測：只記第一組會讓「本條例」也指向所得稅法）。 */
  var aliasCache;
  function aliasMap() {
    if (aliasCache !== undefined) return aliasCache;
    aliasCache = {};
    var txt = (document.body ? document.body.textContent : '').slice(0, 8000);
    // 非貪婪：只取最靠近括號的法規名，避免把前文（含本頁法規名）吃進來
    var re = new RegExp('([\\u4e00-\\u9fa5]{2,45}?' + SUFFIX +
      ')\\s*[（(]\\s*(?:以下)?\\s*簡稱\\s*(本[\\u4e00-\\u9fa5]{1,3}|該[\\u4e00-\\u9fa5]{1,3})\\s*[）)]', 'g');
    var m;
    while ((m = re.exec(txt)) !== null) {
      /* 別名定義本身有「（以下簡稱X）」這個明確的右邊界，
       * 左邊界只需切到句讀，不可用 cutLeft：法規名內部常含「與」「及」
       * （如「臺灣地區與大陸地區人民關係條例」會被切成「大陸地區人民關係條例」）。 */
      /* 左邊界：先切句讀，再剝除公文前綴（「本細則依」這類）。
       * 不可用 cutLeft，法規名內部常含「與」「及」
       *（「臺灣地區與大陸地區人民關係條例」會被切成「大陸地區人民關係條例」）。 */
      var nm = trimName(String(m[1]).replace(/^[\s\S]*?[。；;，,：:）)]/, ''));
      // 頁面標題與內文相連時，法規名前面可能黏著本頁法規名，需剝除
      if (SELF && SELF.name && nm.indexOf(SELF.name) === 0 && nm.length > SELF.name.length) {
        nm = nm.slice(SELF.name.length);
      }
      // 剝除殘留的「本X依」「依」等公文用語
      nm = nm.replace(/^本[\u4e00-\u9fa5]{1,3}(?:係)?依/, '').replace(/^(?:係)?依(?:據|照)?/, '');
      if (!nm || nm.length < 2 || SUFFIX_ONLY.test(nm)) continue;
      if (nm === (SELF && SELF.name)) continue;
      if (!aliasCache[m[2]]) aliasCache[m[2]] = nm;   // 同一詞以第一個定義為準
    }
    return aliasCache;
  }

  /* 依實際命中的自指詞決定指向；該詞沒有專屬定義時才回退本頁法規。 */
  function selfTarget(word) {
    var a = aliasMap();
    if (word && a[word]) return { name: a[word], pcode: null };
    return { name: SELF.name, pcode: SELF.pcode };
  }
  var SELF_PREFIX = '(?:本法|本條例|本規則|本辦法|本標準|本細則|本準則|本通則|同法|同條例|該法)?';
  var RE_SELF = new RegExp(
    SELF_PREFIX + '\\s*第\\s*(' + NUM + ')\\s*條(?:\\s*之\\s*(' + NUM + '))?' + TAIL,
    'g');

  /* 司法院解釋：釋字（舊制）與憲判字（憲訴法新制）。
   * 兩者端點不同：
   *   釋字   ExContent.aspx?ty=C&CC=D&CNO=748
   *   憲判字 ExContent.aspx?ty=CJ&JNO=6&JYEAR=115（需年度）
   * 「大法官釋字第 748 號」「司法院釋字第748號」等寫法都要涵蓋。 */
  var RE_EX = new RegExp(
    '(?:司法院|大法官)?\\s*釋字\\s*第\\s*(' + NUM + ')\\s*號', 'g');
  var RE_CJ = new RegExp(
    '(' + NUM + ')\\s*年度?\\s*憲判字\\s*第\\s*(' + NUM + ')\\s*號', 'g');

  // 常見黏在法規名前的公文用字，需剝除（「案建築法」→「建築法」）
  var PREFIX = ['前項', '前二項', '前三項', '前條', '前款', '本項', '各該', '上開',
                '另依', '另按', '復依', '爰按', '茲按', '另', '復', '爰', '茲',
                '本法依', '本條例依', '本規則依', '本辦法依', '本法係依', '本條例係依',
                '本法', '本條例', '本規則', '本辦法',
                '依據', '按照', '違反', '有關', '案內', '參照', '準用', '適用', '依照', '茲依',
                '不受', '不適用', '未依', '得依', '應依', '亦同', '所稱', '規定', '準此',
                '依', '按', '案', '及', '與', '或', '暨', '之', '為', '該', '本', '同',
                '前開', '前揭', '所定', '規定', '爰依', '查', '據', '以', '因', '就', '對',
                '參', '如', '至', '而', '並', '且', '惟', '但', '故', '則', '乃', '係'];
  // 這些是法規官方全名的一部分，剝除前綴時不可越過它們
  var KEEP = ['中華民國', '臺灣省', '台灣省', '直轄市', '縣（市）'];
  /* 法規名的左邊界。
   * 原本只靠前綴黑名單修剪，遇到「第一百六十四條及民法」「行政機關依中央法規標準法」
   * 這類真實條文就會把前一段吃進來，導致完全查不到（codex review 實測三例）。
   * 改為先以硬邊界切開：條號結尾、連接詞、標點之後才是法規名的起點。 */
  /* 邊界只認明確的語法標記：
   *   完整的「第N條/項/款/目」（不可只認單一個「條」字，
   *   否則「中華民國憲法增修條文」會被切成「文」）
   *   標點、連接詞、動詞
   * 取最後一個邊界之後的部分作為法規名。 */
  var HARD_EDGE = new RegExp(
    '(?:第\\s*' + NUM + '\\s*[條項款目]|[、，,；;。．：:（）()「」『』《》〈〉\\s]|' +
    '及|或|與|暨|準用|適用|規定|所稱|依據|依照|按照|依|按)', 'g');
  function cutLeft(raw) {
    var last = 0, m;
    HARD_EDGE.lastIndex = 0;
    while ((m = HARD_EDGE.exec(raw)) !== null) {
      var end = m.index + m[0].length;
      if (end < raw.length) last = end;
      if (HARD_EDGE.lastIndex <= m.index) HARD_EDGE.lastIndex = m.index + 1;
    }
    return last > 0 ? raw.slice(last) : raw;
  }

  function trimName(name) {
    var changed = true;
    while (changed && name.length > 2) {
      // 已經以官方全名前綴開頭就停手
      var keep = false;
      for (var g = 0; g < KEEP.length; g++) {
        if (name.indexOf(KEEP[g]) === 0) { keep = true; break; }
      }
      if (keep) break;
      changed = false;
      for (var i = 0; i < PREFIX.length; i++) {
        var p = PREFIX[i];
        if (name.length - p.length >= 2 && name.indexOf(p) === 0) {
          name = name.slice(p.length); changed = true; break;
        }
      }
    }
    return name;
  }

  var REPORT_TO = 'cosetoenor@gmail.com';
  /* 立法院法律系統：歷史條文全文與修法理由的來源。
   * 跨域（lis.ly.gov.tw），中央站 CSP 的 connect-src 'self' 禁止 fetch，
   * frame-src 'self' 也禁止 iframe，兩者實測皆被擋。
   * 但 www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=xxxxx 是公開網址，
   * 會列出該法律所有版本的連結，使用者可另開分頁查看，不需登入或 session。 */
  var HOST_LY = 'https://lis.ly.gov.tw';
  var LY_REDIRECT = 'https://www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=';
  var errLog = [];       // 供回報使用的錯誤記錄（僅記錄本工具自身的失敗）
  function logErr(kind, detail) {
    errLog.push({ t: new Date().toISOString().slice(11, 19), kind: kind, detail: String(detail).slice(0, 200) });
    if (errLog.length > 20) errLog.shift();
  }

  var pcodeCache = {};   // 法規名 -> pcode
  var artCache = {};     // pcode|flno -> {title, lines[]}

  /* 取回文字內容，含重試。
   * 實測原站偶發 fetch failed 與 HTTP 400；公司網路經 proxy 時更常見。
   * 重試兩次、間隔遞增，避免使用者看到不必要的「查不到」。
   * 4xx（除 408/429）為明確拒絕，不重試。
   */
  // 取回並解析為 DOM，7 處 fetch 有 5 處需要，合併省去重複
  function fetchDoc(url) { return fetchText(url).then(parseHTML); }

  function fetchText(url, attempt) {
    attempt = attempt || 0;
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (r.ok) return r.text();
      var retriable = r.status >= 500 || r.status === 408 || r.status === 429 || r.status === 400;
      if (retriable && attempt < 2) return retry(url, attempt);
      throw new Error('HTTP ' + r.status);
    }, function (err) {
      if (attempt < 2) return retry(url, attempt);
      throw new Error(err && err.message ? err.message : '連線失敗');
    });
  }
  function retry(url, attempt) {
    return new Promise(function (res) { setTimeout(res, 600 * (attempt + 1)); })
      .then(function () { return fetchText(url, attempt + 1); });
  }

  /* 把抓回來的 HTML 解析成 DOM。
   * 注意：DOMParser 產生的文件雖不會渲染，其中的 <style>/<link> 仍會觸發
   * 本頁的 style-src-elem 檢查而在主控台留下 CSP 違規（實測 Chromium 確認）。
   * 我們只需要條文文字，因此先移除所有樣式與腳本節點再解析。
   */
  function parseHTML(html) {
    var cleaned = String(html)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')
      .replace(/\sstyle\s*=\s*'[^']*'/gi, '');
    return new DOMParser().parseFromString(cleaned, 'text/html');
  }

  // 搜尋結果的候選名稱評分。
  // 實測發現三種必須處理的情形（見 test/pcode.js）：
  //   1. 完全相符：「土地法」→ 土地法
  //   2. 官方全名帶前綴：「刑法」→ 中華民國刑法
  //   3. 官方名稱帶括號註記：「都市計畫法臺灣省施行細則」→ ...（89.12.29 訂定）
  // 同時必須排除「○○施行法」「○○施行細則」這類名稱包含但實為另一部法規者。
  var NOISE = ['本法規有附件', 'EN', '英譯法規', '沿革', '歷史法規'];
  function scoreCandidate(title, want) {
    if (!title || NOISE.indexOf(title) >= 0) return -1;
    if (title === want) return 100;
    // 去除括號註記後再比一次（涵蓋情形 3）
    var bare = title.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    if (bare === want) return 90;
    // 官方全名以「中華民國」等前綴開頭（涵蓋情形 2）
    if (bare.length > want.length && bare.slice(-want.length) === want) {
      // 僅接受純前綴差異，且前綴不得使其成為另一部法規
      var pre = bare.slice(0, bare.length - want.length);
      if (/^(中華民國|臺灣省|台灣省)$/.test(pre)) return 80;
      return -1;   // 如「陸海空軍刑法」「監獄行刑法」屬不同法規
    }
    return -1;
  }

  function findPcode(name) {
    if (pcodeCache[name]) return Promise.resolve(pcodeCache[name]);
    return once('pc|' + name, function () { return findPcode_(name); });
  }
  function findPcode_(name) {
    if (pcodeCache[name]) return Promise.resolve(pcodeCache[name]);
    // 本頁若就是該法規，直接用網址上的 pcode，免一次搜尋
    var self = /pcode=([A-Z0-9]+)/i.exec(location.search);
    var h1 = document.querySelector('#hlLawName, .table-list .h3, h2');
    if (self && h1 && h1.textContent.trim().indexOf(name) >= 0) {
      pcodeCache[name] = self[1];
      return Promise.resolve(self[1]);
    }
    var url = SITE.searchUrl(name);
    return fetchDoc(url).then(function (doc) {
      var rows = doc.querySelectorAll(SITE.resultSel || 'a[href*="pcode="]');
      var best = null, bestScore = 0;
      for (var i = 0; i < rows.length; i++) {
        var href = rows[i].getAttribute('href') || '';
        // 英譯版是另一套內容，條號對不上，必須排除
        if (/\/ENG\//i.test(href)) continue;
        var m = (SITE.idRe || /pcode=([A-Z0-9]+)/i).exec(href);
        if (!m) continue;
        var sc = scoreCandidate(rows[i].textContent.trim(), name);
        if (sc > bestScore) { bestScore = sc; best = m[1]; if (sc === 100) break; }
      }
      if (best) { pcodeCache[name] = best; return best; }
      throw new Error('找不到法規「' + name + '」');
    });
  }

  var histCache = {};
  /* 取得法規沿革，並挑出提到指定條號的修法紀錄。
   * 原站沒有「歷史條文」功能（LawOldVer 等端點皆回 400），
   * 但沿革頁載明每次修法動到哪幾條，足以回答「這條何時改過」。
   * 讀舊函釋時，這是判斷條文是否已異動的關鍵線索。 */
  function fetchHistory(pcode) {
    if (histCache[pcode]) return Promise.resolve(histCache[pcode]);
    return once('hist|' + pcode, function () { return fetchHistory_(pcode); });
  }
  function fetchHistory_(pcode) {
    var url = SITE.historyUrl ? SITE.historyUrl(pcode) : null;
    if (!url) return Promise.reject(new Error('本站未提供沿革'));
    return fetchText(url).then(function (html) {
      var doc = parseHTML(html);
      /* 沿革條目的呈現方式各站差異極大（元素列、純文字段落、表格），
       * 用選擇器逐一適配很脆弱。改為對整份文字做切分：
       * 沿革條目一律是「N. 中華民國…」的形態，直接以此切割最可靠。 */
      var whole = (doc.body || doc).textContent.replace(/\u00a0/g, ' ');
      var itemRe = /(^|\s)(\d+)\.\s*(中華民國[\s\S]*?)(?=(?:\s\d+\.\s*中華民國)|$)/g;
      var texts = [], mm2;
      while ((mm2 = itemRe.exec(whole)) !== null) {
        var body = mm2[3].replace(/\s+/g, ' ').trim();
        if (body.length > 400) body = body.slice(0, 400);   // 避免吃到頁尾雜訊
        texts.push(mm2[2] + '. ' + body);
      }
      var list = [], seen = {};
      for (var i = 0; i < texts.length; i++) {
        var t = texts[i];
        if (seen[t]) continue;
        seen[t] = 1;
        // 「令修正公布第 40、77-3、77-4、87 條條文」→ 取出條號清單
        var arts = [];
        // 注意排除「全文 14 條」這種總數描述，它不是被修正的條號清單
        var seg = /(?:^|[^全文])第\s*([0-9\-、，,\s]+?)\s*條/g, m2;
        while ((m2 = seg.exec(t)) !== null) {
          m2[1].split(/[、，,\s]+/).forEach(function (x) {
            x = x.trim();
            if (x && arts.indexOf(x) < 0) arts.push(x);
          });
        }
        // 中央用中文數字（一百十一年五月十一日），地方多用阿拉伯數字（115年1月23日）
        var dm = /中華民國\s*([0-9〇一二三四五六七八九十百零]{1,6}\s*年\s*[0-9一二三四五六七八九十]{1,3}\s*月\s*[0-9一二三四五六七八九十]{1,4}\s*日)/.exec(t)
              || /中華民國([^總令國]{2,24}?)(?:總統|行政院|國民政府|令|國民大會)/.exec(t);
        // 全文修正／制定公布時沒有列出個別條號，視為「動到所有條文」
        var whole = /全文修正|制定公布|全文.{0,4}條|訂定發布|制定/.test(t) && !arts.length;
        list.push({ text: t, arts: arts, when: dm ? dm[1].trim() : '', whole: whole });
      }
      /* 立法院法律系統有歷史條文全文與修法理由，但位於 lis.ly.gov.tw，
       * 中央站的 CSP（connect-src 'self'、frame-src 'self'）禁止跨域取文與內嵌，
       * 實測 fetch 與 iframe 皆被擋。因此只能提供連結讓使用者另開分頁。
       * 沿革頁本身就有「立法歷程」連結，可取出法律編號 CODE。 */
      /* 立法院入口有兩種格式（實測 18 部法規歸納）：
       *   多數：ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=01158
       *   分編立法者（如民法）：LawRedirectLY.aspx?pcode=B0000001
       *     民法分為總則、債、物權等 5 編，各有自己的 CODE，
       *     故導向中央站的選擇頁，由使用者挑要看哪一編。 */
      var lyCode = null, lyUrl = null;
      /* 立法院版本網址由三段組成：識別碼^日期碼^保留段。
       * 同一部法規的識別碼固定，日期碼為「法律編號+民國年月日」，
       * 因此只要取得一次識別碼，就能組出跳到任一版本的網址。
       * 識別碼需由轉址頁取得，這裡先記下 code，實際取用時再抓。 */
      var lyA = doc.querySelector('a[href*="LawRedirect.ashx"]');
      if (lyA) {
        var cm = /CODE=(\d+)/.exec(lyA.getAttribute('href') || '');
        if (cm) { lyCode = cm[1]; lyUrl = LY_REDIRECT + cm[1]; }
      }
      if (!lyUrl && doc.querySelector('a[href*="LawRedirectLY.aspx"]')) {
        lyUrl = HOST + '/LawClass/LawRedirectLY.aspx?pcode=' + pcode;
      }
      histCache[pcode] = { url: url, list: list, lyCode: lyCode, lyUrl: lyUrl, lyKey: null };
      return histCache[pcode];
    });
  }

  // 挑出動到指定條號的修法紀錄
  /* 挑出動到指定條號的修法紀錄。
   * 「全文修正」「制定公布」不會列出個別條號，但確實動到每一條，
   * 必須納入，否則像憲法這種只有一次制定公布的法規會顯示「未修正」。
   *
   * 效能：條號上色要對整頁每一條查一次（民法 1439 條），
   * 線性掃描會是 O(條數 × 沿革筆數)。改為首次呼叫時建索引，之後 O(1)。 */
  function historyFor(hist, flno) {
    if (!hist.byArt) {
      var idx = {}, all = [];
      for (var i = 0; i < hist.list.length; i++) {
        var r = hist.list[i];
        if (r.whole) { all.push(r); continue; }
        for (var j = 0; j < r.arts.length; j++) {
          (idx[r.arts[j]] || (idx[r.arts[j]] = [])).push(r);
        }
      }
      hist.byArt = idx;
      hist.wholes = all;
    }
    var named = hist.byArt[String(flno)];
    if (!named) return hist.wholes.length ? hist.wholes.slice() : [];
    // 維持沿革原順序（新到舊）
    return named.concat(hist.wholes);
  }

  var exCache = {};
  var cjIndex = null;   // 憲判字：年+號 -> JC 流水號

  /* 憲判字的內容頁需要內部流水號 JC，無法由年度與號碼推算，
   * 必須先從清單頁建立對照表。清單一次 20 筆，逐頁往後找。 */
  function findCJ(year, no) {
    var key = year + '-' + no;
    if (cjIndex && cjIndex[key]) return Promise.resolve(cjIndex[key]);
    cjIndex = cjIndex || {};
    var page = 1;
    function scanPage() {
      if (page > 6) throw new Error('清單中找不到此號憲判字');
      var url = HOST + '/Law/LawSearchJudge.aspx?ty=B5&set=0&page=' + page + '&psize=20';
      return fetchText(url).then(function (html) {
        var re = /ExContent\.aspx\?ty=CJ&(?:amp;)?JC=([A-Z0-9]+)&(?:amp;)?JNO=(\d+)&(?:amp;)?JYEAR=(\d+)/g, m;
        var found = null, any = false;
        while ((m = re.exec(html)) !== null) {
          any = true;
          cjIndex[m[3] + '-' + m[2]] = m[1];
          if (m[3] === String(year) && m[2] === String(no)) found = m[1];
        }
        if (found) return found;
        if (!any) throw new Error('清單中找不到此號憲判字');
        page++;
        return scanPage();
      });
    }
    return Promise.resolve().then(scanPage);
  }
  /* 取回司法院解釋。
   * kind='C'：釋字，只需號碼；kind='CJ'：憲判字，需年度 + 號碼。
   * 不存在的號碼原站回 302 轉址，內容區會缺，據此判定失敗。 */
  function fetchExplain(kind, no, year) {
    var key = kind + '|' + no + '|' + (year || '');
    if (exCache[key]) return Promise.resolve(exCache[key]);
    var pre = kind === 'CJ'
      ? findCJ(year, no).then(function (jc) {
          return HOST + '/LawClass/ExContent.aspx?ty=CJ&JC=' + jc +
                 '&JNO=' + no + '&JYEAR=' + year + '&JCASE=' + encodeURIComponent('憲判');
        })
      : Promise.resolve(LC + 'ExContent.aspx?ty=C&CC=D&CNO=' + no);
    var url;
    return pre.then(function (u) { url = u; return fetchDoc(u); }).then(function (doc) {
      var kv = {};
      var rows = doc.querySelectorAll('tr, .row');
      for (var i = 0; i < rows.length; i++) {
        var t = rows[i].textContent.replace(/\s+/g, ' ').trim();
        var m = /^(發文單位|解釋字號|解釋日期|解釋爭點|判決日期|裁判字號)：\s*([\s\S]*)$/.exec(t);
        if (m && !kv[m[1]]) kv[m[1]] = m[2].trim();
      }
      var pres = doc.querySelectorAll('.text-pre');
      if (!pres.length) throw new Error('查無此號解釋');
      var main = pres[0].textContent.replace(/\n\s+/g, '\n').trim();
      var title = kv['解釋字號'] || kv['裁判字號'] ||
        (kind === 'CJ' ? year + ' 年憲判字第 ' + no + ' 號' : '釋字第 ' + no + ' 號');
      // 驗證取回的確實是這一號，查不到比查錯安全
      if (String(title).replace(/\s/g, '').indexOf(String(no) + '號') < 0) {
        throw new Error('字號驗證失敗');
      }
      var res = {
        title: title, date: kv['解釋日期'] || kv['判決日期'] || '',
        issue: kv['解釋爭點'] || '', text: main,
        reason: pres.length > 1 ? pres[1].textContent.replace(/\n\s+/g, '\n').trim() : '',
        url: url
      };
      exCache[key] = res;
      return res;
    });
  }

  /* 條號正規化：各站寫法不一（阿拉伯／中文數字、全形、空白、之X），
   * 統一轉成 "77-2" 這種形式才能比對。 */
  function normFlno(t) {
    // 之X 條有兩種寫法：「第 77 條之 2」與「第 77-2 條」，兩者都要認得
    var m = /第\s*([0-9０-９一二三四五六七八九十百千]+)(?:\s*[-\u2010-\u2015\uff0d]\s*([0-9０-９]+))?\s*條(?:\s*之\s*([0-9０-９一二三四五六七八九十百千]+))?/
      .exec(String(t).replace(/\u3000/g, ' '));
    if (!m) return null;
    var a = cn2num(m[1]);
    if (!a) return null;
    var sub = m[2] || m[3];
    return sub ? a + '-' + cn2num(sub) : String(a);
  }

  /* 從「整部法規」的頁面中挑出指定條文。
   * 地方法規站沒有單條端點，只能取全文再切。兩種樣板都要支援：
   *   table 模式：每條一個 <tr>，條號在 td.th
   *   blob  模式：全部條文塞在一個 div，只能靠條號文字切分
   * 模式必須執行時探測，同一套系統在不同縣市的樣板並不一致。 */
  function pickFromWhole(doc, flno) {
    var want = String(flno);

    // table 模式
    var rows = doc.querySelectorAll('#ctl00_cp_content_tableLawArticleBasic tr, .row');
    for (var i = 0; i < rows.length; i++) {
      var no = rows[i].querySelector('td.th[scope="row"], .col-no');
      if (!no) continue;
      if (normFlno(no.textContent) !== want) continue;
      var data = rows[i].querySelector('td:nth-child(2) .ClearCss, .col-data, td:nth-child(2)');
      if (!data) continue;
      return { title: no.textContent.trim(), lines: splitLines(data) };
    }

    // blob 模式：整團文字用條號切
    var blob = doc.querySelector('#ctl00_cp_content_divLawContent08, .law-content, .ClearCss');
    if (blob) {
      var txt = blob.textContent.replace(/\r/g, '');
      var re = /第\s*[0-9０-９一二三四五六七八九十百千]+\s*條(?:\s*之\s*[0-9０-９一二三四五六七八九十百千]+)?/g;
      var marks = [], m;
      while ((m = re.exec(txt)) !== null) marks.push({ i: m.index, t: m[0], end: re.lastIndex });
      for (var k = 0; k < marks.length; k++) {
        if (normFlno(marks[k].t) !== want) continue;
        var body = txt.slice(marks[k].end, k + 1 < marks.length ? marks[k + 1].i : txt.length);
        var lines = body.split('\n').map(function (x) { return x.trim(); })
          .filter(Boolean)
          .map(function (x) { return { text: x, top: !/^[一二三四五六七八九十]、/.test(x) }; });
        if (lines.length) return { title: marks[k].t.trim(), lines: lines };
      }
    }
    return null;
  }

  function splitLines(node) {
    var out = [];
    node.querySelectorAll('div, p').forEach(function (d) {
      if (d.querySelector('div, p')) return;    // 只取葉節點，避免重複
      var tx = d.textContent.trim();
      if (tx) out.push({ text: tx, top: !/^[一二三四五六七八九十]、/.test(tx) });
    });
    if (!out.length) {
      node.textContent.split('\n').forEach(function (x) {
        x = x.trim();
        if (x) out.push({ text: x, top: !/^[一二三四五六七八九十]、/.test(x) });
      });
    }
    return out;
  }

  /* 進行中的請求也要快取，否則滑鼠在同一標記上移動會重複發出請求
   * （codex review 實測：完成前送兩次 mouseover 會打兩次 fetch）。
   * 失敗時移除，讓下次可重試。 */
  var inFlight = {};
  function once(key, make) {
    if (inFlight[key]) return inFlight[key];
    var pr = make().then(function (v) { delete inFlight[key]; return v; },
                         function (e) { delete inFlight[key]; throw e; });
    inFlight[key] = pr;
    return pr;
  }

  function fetchArticle(pcode, flno) {
    var key = pcode + '|' + flno;
    if (artCache[key]) return Promise.resolve(artCache[key]);
    return once('art|' + key, function () { return fetchArticle_(pcode, flno); });
  }
  function fetchArticle_(pcode, flno) {
    var key = pcode + '|' + flno;
    var url = SITE.articleUrl(pcode, flno);
    // 取全文的站台以法規為快取單位，避免同一部法規重複下載
    var pageKey = SITE.wholePage ? 'page|' + pcode : null;
    var get = pageKey && artCache[pageKey]
      ? Promise.resolve(artCache[pageKey])
      : fetchDoc(url).then(function (doc) {
          if (pageKey) artCache[pageKey] = doc;
          return doc;
        });

    return get.then(function (doc) {
      var lawName = (doc.querySelector('#hlLawName, #ctl00_cp_content_lbLawName') || {}).textContent || '';
      var title, lines;

      if (SITE.wholePage) {
        var got = pickFromWhole(doc, flno);
        if (!got) throw new Error('條文中找不到第 ' + flno + ' 條');
        title = got.title; lines = got.lines;
      } else {
        var box = doc.querySelector('.law-reg-content');
        if (!box) throw new Error('無法解析條文');
        var noEl = box.querySelector('.col-no, .h3');
        title = noEl ? noEl.textContent.trim() : ('第 ' + flno + ' 條');
        lines = [];
        box.querySelectorAll('.law-article > div').forEach(function (d) {
          var tx = d.textContent.trim();
          if (tx) lines.push({
            text: tx,
            top: /show-number|line-0000/.test(d.className) && !/line-000[1-9]/.test(d.className)
          });
        });
        if (!lines.length) {
          var tx = box.textContent.replace(/\s+/g, ' ').trim();
          if (tx) lines.push({ text: tx, top: true });
        }
      }

      /* 驗證：確定抓回來的是這一條，查不到比查錯安全。
       * 先前用 indexOf 子字串比對，只攔得住「取回較短的條號」，
       * 「要第 7 條卻拿到第 77 條」會通過，而這正是最誤導人的方向。
       * 改用 normFlno 正規化後等值比對（已處理全形、中文數字、之X）。
       * normFlno 解不出來時維持放行，避免原站標題格式異常導致全部失效。 */
      var gotNo = normFlno(title);
      if (gotNo && gotNo !== String(flno)) throw new Error('條號驗證失敗');
      var res = { title: title, law: lawName.trim(), lines: lines, url: url, pcode: pcode };
      artCache[key] = res;
      return res;
    });
  }

  /* ---------- 樣式（CSP style-src 相容） ----------
   * 教訓（使用者實測回報兩次）：
   *   1. `style-src` 不只管 <style> 元素，style="" 屬性同樣受管轄。
   *   2. 連 CSSOM 的 el.style.setProperty 也被 Chrome 視為 inline style 而阻擋。
   * 唯一可靠途徑：把樣式寫進「樣式表規則」。規則層級不算 inline style，不受限制。
   * 動態值（面板座標、顯示與否）改為改寫既有規則的內容，而非碰元素的 style。
   */
  var PFX = 'lh-' + Math.random().toString(36).slice(2, 8) + '-';
  var CLS = {
    mark: PFX + 'm', panel: PFX + 'p', head: PFX + 'h', body: PFX + 'b',
    line: PFX + 'l', sub: PFX + 's', hit: PFX + 'x', foot: PFX + 'f',
    link: PFX + 'a', toast: PFX + 't', err: PFX + 'e', note: PFX + 'n',
    hidTa: PFX + 'hta',
    toastIn: PFX + 'ti', toastDot: PFX + 'td', toastNum: PFX + 'tn',
    toastSub: PFX + 'ts', hide: PFX + 'hide',
    fab: PFX + 'fab', dlg: PFX + 'dlg', dlgIn: PFX + 'dgi', dlgH: PFX + 'dgh',
    row: PFX + 'row', opt: PFX + 'opt', ta: PFX + 'ta', btn: PFX + 'btn',
    btnP: PFX + 'btnp', dgf: PFX + 'dgf', lbl: PFX + 'lbl', diag: PFX + 'dg2',
    rptLink: PFX + 'rl', hist: PFX + 'hs', histI: PFX + 'hi',
    headMark: PFX + 'hm', headOn: PFX + 'ho', headOff: PFX + 'hf'
  };

  var RULES = [
    '.' + CLS.mark + '{border-bottom:1.5px dotted #c0392b;cursor:help;background:rgba(192,57,43,.06)}',
    /* 用 fixed 而非 absolute：absolute 需換算 scrollY，頁面一捲動座標就過時，
     * 導致面板跑出畫面上緣（實測小視窗會發生）。fixed 直接對應可視範圍。 */
    '.' + CLS.panel + '{position:fixed;top:0;left:0;z-index:2147483647;max-width:520px;' +
      'max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;' +
      '-webkit-overflow-scrolling:touch;background:#fff;border:1px solid #c8ccd4;border-radius:8px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;text-align:left;color:#1a1a1a;' +
      'font:14px/1.75 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}',
    '.' + CLS.hide + '{display:none !important}',
    /* 複製退路用的暫時 textarea：需可被選取，故不能 display:none */
    '.' + CLS.hidTa + '{position:fixed;top:0;left:0;width:1px;height:1px;' +
      'padding:0;border:0;opacity:0;pointer-events:none}',
    '.' + CLS.head + '{font-weight:700;color:#8a1f1f;margin-bottom:8px;font-size:14px}',
    '.' + CLS.body + '{border-top:1px solid #eee;padding-top:8px}',
    '.' + CLS.line + '{margin:2px 0}',
    '.' + CLS.sub + '{margin:2px 0;padding-left:1.6em}',
    '.' + CLS.hit + '{background:#fff3cd;border-left:3px solid #e0a800;padding-left:8px}',
    '.' + CLS.foot + '{margin-top:10px;padding-top:8px;border-top:1px solid #eee;font-size:12px}',
    '.' + CLS.link + '{color:#0b63c5;text-decoration:none;margin-right:14px;cursor:pointer}',
    '.' + CLS.err + '{color:#8a1f1f;font-weight:600}',
    '.' + CLS.note + '{color:#666;font-size:12px;margin-top:6px}',
    /* 啟用提示：置頂置中。使用者剛從書籤列點下來，視線就在畫面上緣，
       放右下角容易完全沒看到，導致誤以為書籤沒作用。 */
    '.' + CLS.toast + '{position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
      'display:flex;justify-content:center;pointer-events:none;padding:14px 12px 0}',
    '.' + CLS.toastIn + '{display:flex;align-items:center;gap:11px;max-width:92vw;' +
      'background:#12321f;color:#fff;padding:13px 22px 13px 18px;border-radius:12px;' +
      'border:1px solid rgba(255,255,255,.18);' +
      'box-shadow:0 10px 34px rgba(0,0,0,.34),0 2px 8px rgba(0,0,0,.2);' +
      'font:15px/1.4 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif;' +
      'animation:' + PFX + 'drop .42s cubic-bezier(.2,1.3,.4,1) both}',
    '@keyframes ' + PFX + 'drop{from{opacity:0;transform:translateY(-22px) scale(.94)}' +
      'to{opacity:1;transform:none}}',
    '.' + CLS.toastDot + '{width:26px;height:26px;flex:0 0 26px;border-radius:50%;' +
      'background:#2f9e5f;display:flex;align-items:center;justify-content:center;' +
      'font:700 15px/1 system-ui,sans-serif;color:#fff}',
    '.' + CLS.toastNum + '{font-weight:700}',
    '.' + CLS.toastSub + '{opacity:.82;font-size:13px;margin-left:2px}',
    /* 回報入口：常駐右下角，讓使用者遇到問題時找得到 */
    '.' + CLS.fab + '{position:fixed;right:16px;bottom:16px;z-index:2147483646;' +
      'display:flex;align-items:center;gap:7px;background:#fff;color:#31415c;' +
      'border:1px solid #d8d4cb;border-radius:999px;padding:9px 15px 9px 13px;cursor:pointer;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.14);opacity:.55;' +
      'font:13px/1 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif;' +
      'transition:opacity .2s,box-shadow .2s,transform .2s}',
    '.' + CLS.fab + ':hover{opacity:1;box-shadow:0 6px 20px rgba(0,0,0,.2);transform:translateY(-1px)}',
    '.' + CLS.dlg + '{position:fixed;inset:0;z-index:2147483647;background:rgba(16,24,40,.55);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'font:14px/1.7 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#16233a}',
    '.' + CLS.dlgIn + '{background:#fff;border-radius:14px;max-width:520px;width:100%;' +
      'max-height:88vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.36);' +
      'animation:' + PFX + 'drop .3s cubic-bezier(.2,1.2,.4,1) both}',
    '.' + CLS.dlgH + '{padding:17px 20px;border-bottom:1px solid #e8e5de;font-weight:700;' +
      'font-size:16px;display:flex;align-items:center;gap:9px}',
    '.' + CLS.row + '{padding:16px 20px 4px}',
    '.' + CLS.lbl + '{font-weight:700;font-size:13.5px;margin-bottom:9px;color:#31415c}',
    '.' + CLS.opt + '{display:flex;gap:11px;align-items:flex-start;border:1.5px solid #e0ddd5;' +
      'border-radius:10px;padding:12px 14px;margin-bottom:9px;cursor:pointer;transition:all .18s;' +
      'background:#fdfcfa}',
    '.' + CLS.opt + ':hover{border-color:#c0a98a;background:#faf8f4}',
    '.' + CLS.opt + '[data-on="1"]{border-color:#9c2b2b;background:#fdf4f4;' +
      'box-shadow:0 0 0 3px rgba(156,43,43,.09)}',
    '.' + CLS.ta + '{width:100%;min-height:74px;border:1px solid #ddd9d0;border-radius:9px;' +
      'padding:10px 12px;font:13px/1.65 inherit;color:#16233a;background:#fdfcfa;resize:vertical;' +
      'box-sizing:border-box}',
    '.' + CLS.ta + ':focus{outline:2px solid #9c2b2b;outline-offset:-1px;border-color:#9c2b2b}',
    '.' + CLS.diag + '{width:100%;min-height:96px;border:1px solid #e4e1d9;border-radius:9px;' +
      'padding:10px 12px;font:11.5px/1.6 ui-monospace,Consolas,monospace;color:#5a6577;' +
      'background:#f7f6f2;resize:vertical;box-sizing:border-box}',
    '.' + CLS.dgf + '{display:flex;gap:9px;align-items:center;padding:14px 20px;' +
      'border-top:1px solid #e8e5de;background:#faf9f6;border-radius:0 0 14px 14px}',
    '.' + CLS.btn + '{font:500 14px/1 inherit;padding:10px 17px;border-radius:9px;' +
      'border:1px solid #d8d4cb;background:#fff;color:#31415c;cursor:pointer;transition:all .18s}',
    '.' + CLS.btn + ':hover{border-color:#9aa3b2;color:#16233a}',
    '.' + CLS.btnP + '{background:#9c2b2b;border-color:#9c2b2b;color:#fff;font-weight:700}',
    '.' + CLS.btnP + ':hover{background:#8a2424;border-color:#8a2424;color:#fff}',
    '.' + CLS.rptLink + '{color:#9c2b2b;cursor:pointer;text-decoration:underline;' +
      'text-underline-offset:2px;font-size:12px;margin-left:10px}',
    /* 修法紀錄：讀舊函釋時需要知道這條後來改過沒有 */
    '.' + CLS.hist + '{margin-top:9px;padding:8px 11px;background:#fdf6e3;' +
      'border-left:3px solid #c99a2e;border-radius:0 5px 5px 0;font-size:12px;line-height:1.7}',
    '.' + CLS.histI + '{color:#6b5a2e;margin:1px 0}',
    /* 條號標題：以顏色區分修正過與未修正，使用者不必逐條滑過去。
     * 判準用「明列本條條號的修正」，不含全文修正
     *（全文修正每條都有，不具區辨力）。 */
    '.' + CLS.headMark + '{cursor:help;border-radius:3px;transition:background .15s}',
    '.' + CLS.headOn + '{background:rgba(224,168,0,.22);' +
      'border-bottom:2px solid #c99a2e;font-weight:700}',
    '.' + CLS.headOn + ':hover{background:rgba(224,168,0,.38)}',
    '.' + CLS.headOff + '{border-bottom:1.5px dotted #b9b4a8;opacity:.9}',
    '.' + CLS.headOff + ':hover{background:rgba(0,0,0,.04)}',
    /* 標記閃現：讓使用者一眼看到「哪些字被標起來了」 */
    '@keyframes ' + PFX + 'flash{0%,100%{background:rgba(192,57,43,.06)}' +
      '35%{background:rgba(224,168,0,.5)}}',
    '.' + PFX + 'fl{animation:' + PFX + 'flash 1.1s ease-in-out 2}'
  ];

  // 面板座標專用規則，其內容會隨每次顯示而改寫（不碰元素的 style 屬性）
  var POS_SEL = '.' + CLS.panel;
  var posRule = null;

  function pageNonce() {
    var list = document.querySelectorAll('style[nonce],script[nonce],link[nonce]');
    for (var i = 0; i < list.length; i++) {
      // 瀏覽器會遮蔽 nonce 屬性，需優先讀 property
      var v = list[i].nonce || list[i].getAttribute('nonce');
      if (v) return v;
    }
    return '';
  }

  // 建立我們自己的樣式表；優先用 <style nonce>，失敗則沿用同源既有樣式表
  var sheet = (function () {
    try {
      var st = document.createElement('style');
      var nc = pageNonce();
      if (nc) { try { st.nonce = nc; } catch (e) {} st.setAttribute('nonce', nc); }
      st.appendChild(document.createTextNode(RULES.join('\n')));
      (document.head || document.documentElement).appendChild(st);
      if (st.sheet && st.sheet.cssRules && st.sheet.cssRules.length) return st.sheet;
      if (st.parentNode) st.parentNode.removeChild(st);
    } catch (e) {}
    // 備援：把規則插進任何一張同源、可寫入的既有樣式表
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      try {
        var sh = sheets[i];
        if (!sh.cssRules) continue;               // 跨網域樣式表會拋錯
        RULES.forEach(function (r) { sh.insertRule(r, sh.cssRules.length); });
        return sh;
      } catch (e) {}
    }
    return null;
  })();

  // 取得面板座標規則，供後續改寫
  if (sheet) {
    try {
      for (var ri = 0; ri < sheet.cssRules.length; ri++) {
        if (sheet.cssRules[ri].selectorText === POS_SEL) { posRule = sheet.cssRules[ri]; break; }
      }
    } catch (e) {}
  }

  // 改寫規則本身，而非元素的 style，藉此完全避開 CSP inline style 限制
  function setPanelPos(top, left, maxH) {
    if (posRule && posRule.style) {
      try {
        posRule.style.setProperty('top', top + 'px');
        posRule.style.setProperty('left', left + 'px');
        if (maxH) posRule.style.setProperty('max-height', maxH + 'px');
        return true;
      } catch (e) {}
    }
    return false;
  }

  function sty(el) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (!c) continue;
      // 容許以空白分隔的多個 class；classList.add 不接受含空白的單一字串
      var parts = String(c).split(/\s+/);
      for (var j = 0; j < parts.length; j++) if (parts[j]) el.classList.add(parts[j]);
    }
    return el;
  }
  function show(el) { el.classList.remove(CLS.hide); }
  function hide(el) { el.classList.add(CLS.hide); }

  /* ---------- 面板 ---------- */
  var panel = sty(document.createElement('div'), CLS.panel, CLS.hide);
  document.body.appendChild(panel);

  var hideTimer = null;
  panel.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
  panel.addEventListener('mouseleave', scheduleHide);
  function scheduleHide() { hideTimer = setTimeout(function () { hide(panel); }, 250); }

  /* 面板定位。
   * 優先顯示在標記下方；下方放不下且上方空間足夠時才往上翻。
   * 兩邊都放不下時（視窗矮或條文長），貼齊可視範圍並讓面板自行捲動，
   * 絕不可超出畫面上緣，否則使用者看不到條號標題（實測 500px 高的視窗會發生）。 */
  var GAP = 6, EDGE = 8;
  var lastAnchor = null;

  function showPanel(el, buildFn) {
    clearTimeout(hideTimer);
    panel.innerHTML = '';
    buildFn(panel);
    show(panel);
    lastAnchor = el;
    place(el);
    /* 沿革等內容是非同步填入的，填完高度會變。
     * 不重新定位的話，長條文會超出畫面下緣（實測 80 款的條文會）。 */
    if (!showPanel.ro && window.ResizeObserver) {
      showPanel.ro = new ResizeObserver(function () {
        if (lastAnchor && !panel.classList.contains(CLS.hide)) place(lastAnchor);
      });
      showPanel.ro.observe(panel);
    }
  }

  function place(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight, vw = document.documentElement.clientWidth;
    var ph = panel.offsetHeight, pw = panel.offsetWidth;
    var below = vh - r.bottom - GAP;          // 標記下方可用高度
    var above = r.top - GAP;                  // 標記上方可用高度

    var top;
    if (ph <= below) {
      top = r.bottom + GAP;                   // 放得下，顯示在下方
    } else if (ph <= above) {
      top = r.top - ph - GAP;                 // 上方放得下，往上翻
    } else {
      // 兩邊都放不下：貼齊空間較大的一側，面板自行捲動
      top = below >= above ? r.bottom + GAP : Math.max(EDGE, vh - ph - EDGE);
    }
    // 最後把座標夾在可視範圍內，寧可蓋住標記也不能跑出畫面
    top = Math.max(EDGE, Math.min(top, vh - Math.min(ph, vh - EDGE * 2) - EDGE));

    var left = Math.max(EDGE, Math.min(r.left, vw - pw - EDGE));
    /* 高度上限依定位後的可用空間決定。
     * 靜態的 max-height:100vh 在 top 有偏移時仍會超出下緣，
     * 使用者看不到面板底部的「複製條文」等連結（實測 80 款的長條文會發生）。 */
    setPanelPos(top, left, Math.max(120, vh - top - EDGE));
  }

  /* 連結建構器。原本 12 處都在重複 el + href + target + rel + click 這組樣板，
   * 抽成一個函式後，新增連結只需一行。opt:
   *   href  網址   open 開新視窗（'ly' 用命名視窗）  fn 自訂點擊行為
   *   title 提示   cls 額外類別 */
  function link(text, opt) {
    var a = el('a', CLS.link, text);
    if (opt.href) a.href = opt.href;
    if (opt.title) a.setAttribute('title', opt.title);
    if (opt.fn) {
      a.addEventListener('click', function (e) { e.preventDefault(); opt.fn.call(a, e); });
    } else if (opt.open === 'ly') {
      a.target = 'lawhover_ly'; a.rel = 'noopener';
      a.addEventListener('click', openLyWindow);
    } else if (opt.open !== false) {
      a.target = '_blank'; a.rel = 'noopener';
    }
    return a;
  }

  /* 複製到剪貼簿。
   * 手機瀏覽器對 navigator.clipboard 有額外限制，非使用者手勢或未取得權限時
   * 會拋 NotAllowedError（實測 Android/iOS 皆然），且它回傳 Promise，
   * 用 try/catch 包不住。因此需要三段式：
   *   1. clipboard API（桌機與部分手機）
   *   2. execCommand('copy')（手機的可靠退路）
   *   3. 都失敗時選取文字讓使用者自己複製，並明說
   * 回傳 Promise，成功 resolve('api'|'exec')，失敗 reject。 */
  function copyText(txt) {
    function fallback() {
      return new Promise(function (res, rej) {
        var ta = document.createElement('textarea');
        ta.value = txt;
        // 不能用 inline style（CSP），改以 CSSOM 之外的屬性把它移出視野
        ta.setAttribute('readonly', '');
        ta.classList.add(CLS.hidTa);
        document.body.appendChild(ta);
        try {
          ta.select();
          ta.setSelectionRange(0, txt.length);   // iOS 需要這一步
          var okc = document.execCommand('copy');
          document.body.removeChild(ta);
          okc ? res('exec') : rej(new Error('execCommand 失敗'));
        } catch (e) {
          if (ta.parentNode) document.body.removeChild(ta);
          rej(e);
        }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return 'api'; }, fallback);
    }
    return fallback();
  }

  /* 複製按鈕：三處都在做「複製→改文字→還原」，抽成一個。 */
  function copyLink(text, getText) {
    return link(text, { fn: function () {
      var self = this;
      copyText(getText()).then(function () {
        self.textContent = '已複製 \u2713';
      }, function () {
        // 真的複製不了時，讓使用者知道該怎麼辦
        self.textContent = '請長按選取複製';
      });
      setTimeout(function () { self.textContent = text; }, 2200);
    } });
  }

  /* 面板頁尾：條文、解釋、沿革三種面板的頁尾結構相同，只是連結不同。 */
  function footer(box, links) {
    var f = el('div', CLS.foot);
    for (var i = 0; i < links.length; i++) if (links[i]) f.appendChild(links[i]);
    box.appendChild(f);
    return f;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) sty(n, cls);
    if (text != null) n.textContent = text;
    return n;
  }

  function renderArticle(box, art, hit) {
    hit = hit || {};
    var head = el('div', CLS.head);
    head.textContent = (art.law ? art.law + ' ' : '') + art.title +
      (hit.xiang ? ' · 第' + hit.xiang + '項' : '') + (hit.kuan ? '第' + hit.kuan + '款' : '');
    box.appendChild(head);

    var body = el('div', CLS.body);
    var topIdx = 0;
    art.lines.forEach(function (ln) {
      if (ln.top) topIdx++;
      var d = el('div', ln.top ? CLS.line : CLS.sub, ln.text);
      if (hit.xiang && ln.top && topIdx === hit.xiang) sty(d, CLS.hit);
      body.appendChild(d);
    });
    box.appendChild(body);

    /* 修法紀錄：條號標題與條文引用兩邊都要有。
     * 讀到某條引用時同樣需要知道「這條後來改過沒有」，
     * 拿今天的條文對照當年的函釋是會誤讀的。 */
    /* 修法紀錄：條號標題與條文引用兩邊都要有。
     * 讀到某條引用時同樣需要知道「這條後來改過沒有」。 */
    if (art.pcode && hit.flno) {
      var hbox = el('div', CLS.hist);
      hbox.appendChild(el('div', CLS.histI, '查詢修法紀錄…'));
      box.appendChild(hbox);
      fetchHistory(art.pcode).then(function (h) {
        hbox.innerHTML = '';
        histList(hbox, h, historyFor(h, hit.flno), false, CLS.histI);
        hbox.appendChild(link(T_HIST, { href: h.url }));
      }).catch(function () {
        hbox.innerHTML = '';
        hbox.appendChild(el('div', CLS.histI, '沿革查詢失敗'));
      });
    }

    footer(box, [
      link('在' + SITE.name + '開啟', { href: art.url }),
      copyLink('複製條文', function () {
        return head.textContent + '\n' +
               art.lines.map(function (l) { return l.text; }).join('\n');
      }),
      // 顯示錯誤資料是最難自己發現的問題，在條文旁給一個直接入口
      link('這條顯示錯了', { fn: function () {
        openReport({
          kind: 'wrong', name: art.law, flno: hit.flno || '', raw: hit.raw || '',
          title: art.title, url: art.url,
          shown: art.lines.map(function (l) { return l.text; }).join('\n').slice(0, 400)
        });
      } })
    ]);
  }

  function renderExplain(box, ex) {
    var head = el('div', CLS.head, ex.title + (ex.date ? '　' + ex.date : ''));
    box.appendChild(head);

    var body = el('div', CLS.body);
    if (ex.issue) {
      var iw = el('div', CLS.line);
      iw.appendChild(el('b', null, '爭點：'));
      iw.appendChild(el('span', null, ex.issue));
      body.appendChild(iw);
    }
    // 解釋文逐行呈現，保留原始斷行（原文是等寬排版）
    ex.text.split('\n').forEach(function (ln) {
      if (ln.trim()) body.appendChild(el('div', CLS.line, ln.trim()));
    });
    box.appendChild(body);

    footer(box, [
      link('在' + SITE.name + '開啟', { href: ex.url }),
      copyLink('複製解釋文', function () {
        return ex.title + '\n' + (ex.issue ? '爭點：' + ex.issue + '\n' : '') + ex.text;
      }),
      // 理由書通常上萬字，另開原站閱讀而非塞進面板
      ex.reason ? link('理由書（' + Math.round(ex.reason.length / 100) / 10 + ' 千字）',
                       { href: ex.url }) : null,
      link('這則顯示錯了', { fn: function () {
        openReport({ kind: 'wrong', name: ex.title, url: ex.url, shown: ex.text.slice(0, 300) });
      } })
    ]);
  }

  /* 條號標題（第 N 條）的沿革面板。
   * 這是使用者最自然會滑過去的位置：想知道「這條改過沒有」時，
   * 視線本來就在條號上，不必先找到某個引用。 */
  /* 沿革清單。條號面板與條文面板都要列修法紀錄，差別只在
   *   full=true  完整列出（條號面板，不必同時放條文）
   *   full=false 只顯示最新一筆，其餘摺疊（條文面板空間有限）
   * 抽成一個函式，避免兩處各自演化而不一致。 */
  /* 精準跳到某一版本需要立法院的內部識別碼，該識別碼只存在於
   * www.ly.gov.tw 的轉址頁。中央站 CSP 的 connect-src 'self' 禁止跨域取回
   * （實測 fetch 被擋），因此無法組出「直達該版本」的網址。
   * 折衷：連到版本清單頁，並在提示文字標明日期供對照。 */
  function lyUrlFor(h) { return h.lyUrl; }

  function lyLink(h, r) {
    return link('立法院查此版', {
      href: lyUrlFor(h), open: 'ly',
      title: r.when ? '另開立法院法律系統，請在版本清單中選「' + r.when + '」'
                    : '另開立法院法律系統的版本清單'
    });
  }

  function histList(box, h, rec, full, lineCls) {
    var named = [], wholes = [];
    for (var i = 0; i < rec.length; i++) (rec[i].whole ? wholes : named).push(rec[i]);

    function row(r) {
      var d = el('div', lineCls, '\u00b7 ' + (r.when || r.text.slice(0, 46)) +
        (r.whole ? T_WHOLE : ''));
      if (h.lyUrl) d.appendChild(lyLink(h, r));
      return d;
    }
    if (!rec.length) {
      box.appendChild(el('div', lineCls, '沿革中未見此條的修正紀錄，可能自公布後未修正。'));
      return;
    }
    if (!named.length) {
      box.appendChild(el('div', lineCls,
        '本條未被個別修正過，僅隨全文修正異動 ' + wholes.length + ' 次。'));
      if (full) wholes.forEach(function (r) { box.appendChild(row(r)); });
      return;
    }
    box.appendChild(el('div', lineCls, '本條個別修正 ' + named.length + ' 次' +
      (full && wholes.length ? '，另隨全文修正 ' + wholes.length + ' 次' : '')));

    var show = full ? rec : named;
    box.appendChild(row(show[0]));
    if (show.length > 1) {
      if (full) {
        for (var k = 1; k < show.length; k++) box.appendChild(row(show[k]));
      } else {
        // 條文面板：其餘摺疊，避免把條文擠出視野
        var more = el('div', CLS.hide);
        for (var j = 1; j < show.length; j++) more.appendChild(row(show[j]));
        var label = '展開其餘 ' + (show.length - 1) + ' 筆';
        var tg = link(label, { fn: function () {
          var open = !more.classList.contains(CLS.hide);
          more.classList[open ? 'add' : 'remove'](CLS.hide);
          tg.textContent = open ? label : '收合';
        } });
        box.appendChild(more);
        box.appendChild(tg);
      }
    }
  }

  function renderHistory(box, lawName, flno, h, rec) {
    box.appendChild(el('div', CLS.head,
      (lawName ? lawName + ' ' : '') + '第 ' + flno + ' 條　修正沿革'));
    var body = el('div', CLS.body);
    histList(body, h, rec, true, CLS.sub);
    box.appendChild(body);
    footer(box, [
      link(T_HIST, { href: h.url }),
      h.lyUrl ? link('立法院法律系統', { href: lyUrlFor(h), open: 'ly' }) : null
    ]);
  }

  // 立法院跨網域無法內嵌，改開獨立視窗；被攔截時退回一般開啟
  function openLyWindow(e) {
    e.preventDefault();
    var w = Math.min(1000, screen.availWidth - 80);
    var ht = Math.min(780, screen.availHeight - 80);
    var win = window.open(this.href, 'lawhover_ly',
      'width=' + w + ',height=' + ht +
      ',left=' + Math.round((screen.availWidth - w) / 2) +
      ',top=' + Math.round((screen.availHeight - ht) / 2) +
      ',scrollbars=yes,resizable=yes');
    if (!win) window.open(this.href, '_blank', 'noopener');
  }

  function renderMsg(box, msg, sub, report) {
    box.appendChild(el('div', CLS.err, msg));
    if (sub) {
      var n = el('div', CLS.note, sub);
      // 失敗當下直接給回報入口，此時脈絡最完整
      if (report) {
        var a = el('span', CLS.rptLink, '回報這個問題');
        a.addEventListener('click', function () { openReport(report); });
        n.appendChild(a);
      }
      box.appendChild(n);
    }
  }


  /* ---------- 問題回報 ----------
   * 兩階段設計：先分「沒顯示」或「顯示錯誤」，因為兩者的診斷方向完全不同。
   * 自動帶入網址、原文句子、標記結果與錯誤記錄，使用者不必截圖也不必開 console。
   */
  function pageDiag(extra) {
    var marks = document.querySelectorAll('[data-flno],[data-ex]');
    var sample = [], seen = {};
    for (var i = 0; i < marks.length && sample.length < 12; i++) {
      var m = marks[i], k = m.dataset.name + '|' + m.dataset.flno;
      if (seen[k]) continue;
      seen[k] = 1;
      if (m.dataset.ex) {
        sample.push('  ' + JSON.stringify(m.textContent) + ' -> ' + m.dataset.name + ' [司法院解釋]');
        continue;
      }
      sample.push('  ' + JSON.stringify(m.textContent) + ' -> ' + m.dataset.name +
                  ' 第' + m.dataset.flno + '條' +
                  (m.dataset.xiang ? ' 第' + m.dataset.xiang + '項' : '') +
                  (m.dataset.pcode ? ' [本頁法規]' : ''));
    }
    var L = [];
    L.push('網址: ' + location.href);
    var self0 = (typeof SELF !== 'undefined' && SELF) ? SELF : null;
    L.push('本頁法規: ' + (self0 ? self0.name + ' (' + self0.pcode + ')' : '(非法規全文頁)'));
    L.push('標記總數: ' + marks.length);
    L.push('瀏覽器: ' + navigator.userAgent);
    L.push('時間: ' + new Date().toISOString());
    if (extra && extra.raw) L.push('問題引用原文: ' + extra.raw);
    if (extra && extra.name) L.push('解析結果: ' + extra.name + ' 第' + (extra.flno || '?') + '條');
    if (extra && extra.title) L.push('顯示的條文標題: ' + extra.title);
    if (extra && extra.url) L.push('取文網址: ' + extra.url);
    if (extra && extra.err) L.push('失敗原因: ' + extra.err);
    if (extra && extra.shown) L.push('顯示的內容(節錄):\n' + extra.shown);
    if (sample.length) L.push('本頁標記樣本:\n' + sample.join('\n'));
    if (errLog.length) {
      L.push('錯誤記錄:');
      errLog.forEach(function (e) { L.push('  [' + e.t + '] ' + e.kind + ' - ' + e.detail); });
    }
    return L.join('\n');
  }

  var dlgEl = null;
  function openReport(ctx) {
    ctx = ctx || {};
    if (dlgEl) closeReport();
    var kind = ctx.kind || null;

    dlgEl = sty(document.createElement('div'), CLS.dlg);
    var inner = sty(document.createElement('div'), CLS.dlgIn);

    var h = el('div', CLS.dlgH, '回報問題');
    inner.appendChild(h);

    /* 第一階段：問題類型。兩種問題的嚴重性與診斷方向不同，先分流。 */
    var r1 = el('div', CLS.row);
    r1.appendChild(el('div', CLS.lbl, '1 · 這是哪一種問題？'));
    var optA = el('div', CLS.opt), optB = el('div', CLS.opt);
    function fillOpt(node, title, desc) {
      var wrapT = el('div');
      wrapT.appendChild(el('div', null, title));
      var d = el('div', CLS.note, desc);
      wrapT.appendChild(d);
      node.appendChild(wrapT);
    }
    fillOpt(optA, '沒有顯示資料', '該標記的沒被標記，或滑過去顯示「查不到條文」。');
    fillOpt(optB, '資料顯示錯誤', '有顯示條文，但內容不是這一條，或項次標錯。');
    function pick(k) {
      kind = k;
      optA.setAttribute('data-on', k === 'missing' ? '1' : '0');
      optB.setAttribute('data-on', k === 'wrong' ? '1' : '0');
      diag.value = pageDiag(ctx);
      send.disabled = false;
    }
    optA.addEventListener('click', function () { pick('missing'); });
    optB.addEventListener('click', function () { pick('wrong'); });
    r1.appendChild(optA); r1.appendChild(optB);
    inner.appendChild(r1);

    /* 第二階段：原文句子。這是最關鍵的資訊，解析錯誤幾乎都能由原文重現。 */
    var r2 = el('div', CLS.row);
    r2.appendChild(el('div', CLS.lbl, '2 · 貼上出問題的法條文句'));
    var ta = document.createElement('textarea');
    sty(ta, CLS.ta);
    ta.placeholder = '例如：本法依中華民國憲法第一百十八條及中華民國憲法增修條文第九條第一項制定之。';
    if (ctx.raw) ta.value = ctx.raw;
    r2.appendChild(ta);
    r2.appendChild(el('div', CLS.note, '直接從頁面上複製整句貼進來即可，這是最有用的線索。'));
    inner.appendChild(r2);

    /* 診斷資訊自動帶入，讓使用者看得到要送出什麼，不做黑箱 */
    var r3 = el('div', CLS.row);
    var lbl3 = el('div', CLS.lbl, '3 · 診斷資訊（自動帶入，可自行刪改）');
    r3.appendChild(lbl3);
    var diag = document.createElement('textarea');
    sty(diag, CLS.diag);
    diag.value = pageDiag(ctx);
    r3.appendChild(diag);
    r3.appendChild(el('div', CLS.note, '不含你正在瀏覽的公文內容，只有網址與標記結果。'));
    inner.appendChild(r3);

    var f = el('div', CLS.dgf);
    var copy = el('button', CLS.btn, '複製內容');
    var cancel = el('button', CLS.btn, '取消');
    var send = el('button', CLS.btn, '用 Email 回報');
    sty(send, CLS.btnP);
    send.disabled = !kind;
    function body() {
      return [
        '問題類型：' + (kind === 'wrong' ? '資料顯示錯誤' : kind === 'missing' ? '沒有顯示資料' : '(未選)'),
        '',
        '出問題的法條文句：',
        ta.value || '(未填)',
        '',
        '--- 診斷資訊 ---',
        diag.value,
        '',
        '--- 補充說明（可自行填寫）---',
        ''
      ].join('\n');
    }
    copy.addEventListener('click', function () {
      copyText(body()).then(function () {
        copy.textContent = '已複製 \u2713';
      }, function () {
        diag.value = body(); diag.select(); copy.textContent = '已選取，請手動複製';
      });
      setTimeout(function () { copy.textContent = '複製內容'; }, 2200);
    });
    send.addEventListener('click', function () {
      var subj = '[法條懸停] ' + (kind === 'wrong' ? '資料顯示錯誤' : '沒有顯示資料');
      var href = 'mailto:' + REPORT_TO + '?subject=' + encodeURIComponent(subj) +
                 '&body=' + encodeURIComponent(body());
      /* mailto 過長會被瀏覽器截斷，故改為「複製到剪貼簿 + 短 mailto」。
       * 但必須等複製結果出來：複製失敗卻送出「已複製到剪貼簿」的短信，
       * 會讓回報內容整個遺失（codex review 實測）。 */
      var full = body();
      if (href.length <= 1900) { window.open(href, '_blank'); send.textContent = '已開啟郵件'; return; }
      copyText(full).then(function () {
        window.open('mailto:' + REPORT_TO + '?subject=' + encodeURIComponent(subj) +
          '&body=' + encodeURIComponent('內容較長，已複製到剪貼簿，請直接貼上（Ctrl+V）。\n\n'), '_blank');
        send.textContent = '已開啟郵件';
      }, function () {
        // 複製不成就不要宣稱已複製，改為讓使用者自行選取
        diag.value = full; diag.select();
        send.textContent = '請手動複製上方內容後寄出';
      });
    });
    cancel.addEventListener('click', closeReport);
    f.appendChild(copy);
    var sp = el('span'); sp.setAttribute('data-sp', '1');
    css_flex(sp);
    f.appendChild(sp);
    f.appendChild(cancel); f.appendChild(send);
    inner.appendChild(f);

    dlgEl.appendChild(inner);
    dlgEl.addEventListener('click', function (e) { if (e.target === dlgEl) closeReport(); });
    document.body.appendChild(dlgEl);
    if (kind) pick(kind);
    setTimeout(function () { ta.focus(); }, 60);
  }
  // 這個間隔元素需要 flex:1，但不能用 inline style，改掛一次性規則
  function css_flex(node) {
    var c = PFX + 'sp';
    node.classList.add(c);
    if (sheet && !css_flex.done) {
      try { sheet.insertRule('.' + c + '{flex:1}', sheet.cssRules.length); css_flex.done = true; } catch (e) {}
    }
  }
  function closeReport() {
    if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl);
    dlgEl = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dlgEl) closeReport();
  });

  /* ---------- 標記 ---------- */
  var count = 0;

  // 當前頁面的法規（供裸條號使用）
  function selfLaw() {
    if (!SITE) return null;
    var r = SITE.selfLaw();
    if (!r) return null;
    // 沿用既有欄位名，避免全檔改寫
    return { pcode: r.id, name: r.name };
  }
  var SELF = selfLaw();

  // 收集一段文字中的所有引用（具名優先，其餘位置再找裸條號）
  function collect(text) {
    var hits = [], m;
    // 具名規則放棄的範圍：裸條號規則也不可接手，否則會綁成本頁法規
    var skipRanges = [];
    RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
      var rawName = m[1] || m[2];
      // 先切硬邊界（條號、連接詞、標點），再剝除殘留的公文前綴
      /* 引號已是明確邊界，不可再切。
       * 未加引號時用 cutLeft 切左界，但「及」「與」既可能是句子連接詞，
       * 也可能在法規名內部（如「…申報淨值及一定期間承攬總額認定辦法」）。
       * 無法從語法區分，故保留較短的切法：寧可查不到，也不要查錯。
       * 使用者可加引號讓程式正確辨識，安裝頁的說明有提到這一點。 */
      var name = m[1] ? rawName : trimName(cutLeft(rawName));
      var tiao = cn2num(m[3]);
      if (!tiao || name.length < 2) continue;
      // 自指詞要完整標記（「本辦法第1條」而非「辦法第1條」），故不剝除
      var drop = (m[1] || SELF_WORDS.indexOf(rawName) >= 0) ? 0 : (rawName.length - name.length);
      /* 「本法」「同法」等自指詞：指向當前頁面的法規，不必另行搜尋。
       * 必須比對「未經 trimName 的原文」：trimName 會把「本辦法」剝成「辦法」，
       * 此時自指判定必然落空，還會拿泛稱去搜尋別部法規（fable review 實測）。 */
      var endsWith = function (list) {
        for (var i2 = 0; i2 < list.length; i2++) {
          if (name === list[i2] || rawName === list[i2] ||
              rawName.slice(-list[i2].length) === list[i2]) return true;
        }
        return false;
      };
      // 取出實際命中的自指詞，不同的詞可能指向不同法規
      var hitWord = null;
      var pickWord = function (list) {
        for (var i3 = 0; i3 < list.length; i3++) {
          if (name === list[i3] || rawName === list[i3] ||
              rawName.slice(-list[i3].length) === list[i3]) return list[i3];
        }
        return null;
      };
      var selfWord = pickWord(SELF_WORDS);
      var anaWord = selfWord ? null : pickWord(ANAPHORA);
      var isSelf = !!selfWord;
      var isAna = !!anaWord;
      hitWord = selfWord || anaWord;
      if (isSelf && !SELF) continue;
      /* 剝除前綴後只剩泛稱字尾（如「辦法」「法」）不是有效的法規名，
       * 拿去搜尋會得到隨機的某部法規。查不到比查錯安全，直接放棄。 */
      /* 剝除前綴後只剩泛稱字尾（如「辦法」「法」）不是有效的法規名。
       * 但「憲法」既是字尾也是真實法規名，此時應標記為該法規而非放棄，
       * 更不可讓裸條號規則接手綁成本頁法規（會顯示不相干的條文）。 */
      if (!isSelf && !isAna && SUFFIX_ONLY.test(name)) {
        if (REAL_LAW_NAMES.indexOf(name) < 0) { skipRanges.push([m.index, m.index + m[0].length]); continue; }
      }
      // 自指詞要完整標記（「本辦法第1條」而非「辦法第1條」），故不剝除前綴
      /* 標記範圍：
       *   引號法規名、前指詞 → 完整保留
       *   自指詞 → 只保留自指詞本身（rawName 可能含前文，如「…應依照本法」）
       *   一般法規名 → 剝除前綴 */
      var drop;
      if (m[1]) drop = 0;
      else if (isSelf || isAna) {
        var kw = isSelf ? SELF_WORDS : ANAPHORA;
        var found = -1;
        for (var ki = 0; ki < kw.length; ki++) {
          var at = rawName.lastIndexOf(kw[ki]);
          if (at > found) found = at;
        }
        drop = found > 0 ? found : 0;
      } else drop = rawName.length - name.length;
      hits.push({
        start: m.index + drop, end: m.index + m[0].length,
        // 前指詞（同法/該法）指向前文最近的具名引用，於下方 sort 後統一解析
        name: isAna ? null : (isSelf ? selfTarget(selfWord).name : name),
        pcode: isAna ? null : (isSelf ? selfTarget(selfWord).pcode : null),
        word: hitWord,
        ana: isAna || false,
        flno: m[4] ? tiao + '-' + cn2num(m[4]) : String(tiao),
        xiang: m[5] ? cn2num(m[5]) : null, kuan: m[6] ? cn2num(m[6]) : null
      });
    }
    if (SELF) {
      RE_SELF.lastIndex = 0;
      while ((m = RE_SELF.exec(text)) !== null) {
        var s0 = m.index, e0 = m.index + m[0].length;
        var covered = hits.some(function (h) { return s0 < h.end && e0 > h.start; }) ||
          skipRanges.some(function (rg) { return s0 < rg[1] && e0 > rg[0]; });
        if (covered) continue;
        var t2 = cn2num(m[1]);
        if (!t2) continue;
        /* 裸條號不一定指向本頁法規。
         * 「人口販運防制法第三十二條、第三十三條」的後半段仍屬該法，
         * 若一律綁成本法會顯示完全錯誤的條文（codex review 實測）。
         * 往前找最近的具名引用：兩者間若只隔連接詞則視為延續，
         * 遇句號分號等句界則作用範圍結束。 */
        var prev = null;
        for (var pi = 0; pi < hits.length; pi++) {
          if (hits[pi].end <= s0 && (!prev || hits[pi].end > prev.end)) prev = hits[pi];
        }
        var cont = prev && !prev.ex &&
          /^[\s、，,及與或暨至]*$/.test(text.slice(prev.end, s0));
        hits.push({
          start: s0, end: e0,
          name: cont ? prev.name : SELF.name,
          pcode: cont ? prev.pcode : SELF.pcode,
          flno: m[2] ? t2 + '-' + cn2num(m[2]) : String(t2),
          xiang: m[3] ? cn2num(m[3]) : null, kuan: m[4] ? cn2num(m[4]) : null
        });
      }
    }
    // 司法院解釋：憲判字需先比對（含年度），避免被釋字規則誤切
    var mm;
    RE_CJ.lastIndex = 0;
    while ((mm = RE_CJ.exec(text)) !== null) {
      var yr = cn2num(mm[1]), cno = cn2num(mm[2]);
      if (!yr || !cno) continue;
      hits.push({ start: mm.index, end: mm.index + mm[0].length,
        ex: 'CJ', exNo: cno, exYear: yr, name: yr + ' 年憲判字第 ' + cno + ' 號', flno: '' });
    }
    RE_EX.lastIndex = 0;
    while ((mm = RE_EX.exec(text)) !== null) {
      var s2 = mm.index, e2 = mm.index + mm[0].length;
      var dup = hits.some(function (h) { return s2 < h.end && e2 > h.start; });
      if (dup) continue;
      var n2 = cn2num(mm[1]);
      if (!n2) continue;
      hits.push({ start: s2, end: e2, ex: 'C', exNo: n2,
        name: '釋字第 ' + n2 + ' 號', flno: '' });
    }

    hits.sort(function (a, b) { return a.start - b.start; });

    /* 前指詞（同法/該法）指向前文最近的具名引用。
     * 找不到前文可指時退回本頁法規，但不可直接綁定，否則會顯示別部法的條文。 */
    for (var ai = 0; ai < hits.length; ai++) {
      if (!hits[ai].ana) continue;
      var ref = null;
      for (var aj = ai - 1; aj >= 0; aj--) {
        if (!hits[aj].ana && !hits[aj].ex) { ref = hits[aj]; break; }
      }
      if (ref) { hits[ai].name = ref.name; hits[ai].pcode = ref.pcode; }
      else {
        // 同段落找不到先行詞時，看該詞是否有別名定義（如「該條例」）
        var am = aliasMap();
        if (hits[ai].word && am[hits[ai].word]) {
          hits[ai].name = am[hits[ai].word]; hits[ai].pcode = null;
        } else if (SELF) { hits[ai].name = SELF.name; hits[ai].pcode = SELF.pcode; }
        else { hits[ai].drop = true; }
      }
    }
    hits = hits.filter(function (h) { return !h.drop && h.name; });
    // 去除重疊
    var out = [];
    hits.forEach(function (h) {
      if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
    });
    return out;
  }

  function markTextNode(node) {
    var text = node.nodeValue;
    // 快速過濾：不含這些關鍵字的文字節點一律略過，省下正則成本
    if (text.indexOf('條') < 0 && text.indexOf('釋字') < 0 && text.indexOf('憲判字') < 0) return;
    var hits = collect(text);
    if (!hits.length) return;
    var frag = document.createDocumentFragment(), last = 0;
    hits.forEach(function (h) {
      if (h.start > last) frag.appendChild(document.createTextNode(text.slice(last, h.start)));
      var span = document.createElement('span');
      sty(span, CLS.mark);
      span.textContent = text.slice(h.start, h.end);
      span.dataset.name = h.name;
      span.dataset.flno = h.flno;
      if (h.ex) {
        span.dataset.ex = h.ex;
        span.dataset.exno = h.exNo;
        if (h.exYear) span.dataset.exyear = h.exYear;
      }
      if (h.pcode) span.dataset.pcode = h.pcode;
      if (h.xiang) span.dataset.xiang = h.xiang;
      if (h.kuan) span.dataset.kuan = h.kuan;
      frag.appendChild(span);
      count++;
      last = h.end;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  /* 標記條號標題（每條開頭的「第 N 條」）。
   * 這是使用者想知道「這條改過沒有」時，視線本來就在的位置。
   * 條號標題顯示沿革；條文內的引用照舊顯示條文，職責分開。 */
  function markArticleHeads() {
    if (!SELF) return 0;
    var heads = document.querySelectorAll(SITE.headSel || '.col-no');
    var n = 0;
    for (var i = 0; i < heads.length; i++) {
      var el0 = heads[i];
      if (el0.dataset.lhHead) continue;
      var txt = el0.textContent.replace(/\s+/g, '').trim();
      var m = /^第([0-9\-]+)條$/.exec(txt);
      var flno = null;
      if (m) {
        flno = m[1];
      } else {
        // 全文頁的條號是連結，可直接從 href 取得最精確的條號
        var a = el0.querySelector('a[href*="flno="]');
        if (a) {
          var fm = /flno=([0-9\-]+)/i.exec(a.getAttribute('href') || '');
          if (fm) flno = fm[1];
        }
      }
      if (!flno) continue;
      el0.dataset.lhHead = flno;
      sty(el0, CLS.headMark);
      el0.setAttribute('title', TOUCH ? '點一下查看修正沿革' : '滑鼠移入查看本條的修正沿革');
      n++;
    }
    if (n) paintHeads();
    return n;
  }

  /* 依沿革為條號標題上色：修正過的標黃，未修正的維持灰色虛線。
   * 只取一次沿革即可標完整頁，不必逐條查詢。 */
  function paintHeads() {
    if (!SELF) return;
    fetchHistory(SELF.pcode).then(function (h) {
      // 先建索引再迴圈，避免每條各掃一次沿革
      historyFor(h, '');
      var heads = document.querySelectorAll('[data-lh-head]');
      for (var i = 0; i < heads.length; i++) {
        var e0 = heads[i];
        var named = h.byArt[e0.dataset.lhHead];
        if (named) {
          sty(e0, CLS.headOn);
          e0.dataset.lhMod = named.length;
          e0.setAttribute('title', '本條修正 ' + named.length + ' 次，滑鼠移入查看沿革');
        } else {
          sty(e0, CLS.headOff);
          e0.setAttribute('title', h.wholes.length
            ? '本條僅隨全文修正異動，滑鼠移入查看沿革'
            : '沿革中未見此條的修正紀錄');
        }
      }
    }).catch(function (err) { logErr('沿革上色失敗', err.message); });
  }

  function scan(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        // 最短的有效引用是「民法第5條」共 5 字，門檻不可高於 5
        if (!n.nodeValue || n.nodeValue.length < 5) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'A') return NodeFilter.FILTER_REJECT;
        if (p.dataset && (p.dataset.flno || p.dataset.ex)) return NodeFilter.FILTER_REJECT;
        // 條號標題由 markArticleHeads 負責顯示沿革，不可再當成條文引用
        if (p.dataset && p.dataset.lhHead) return NodeFilter.FILTER_REJECT;
        if (SITE.headSel && p.closest && p.closest(SITE.headSel)) return NodeFilter.FILTER_REJECT;
        if (panel.contains(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(markTextNode);
  }

  /* ---------- 事件 ---------- */
  /* 懸停分派。三種目標各有取文與渲染方式，用同一套流程處理：
   *   1. 立刻顯示「查詢中」，讓使用者知道有反應
   *   2. 取資料
   *   3. 成功則渲染，失敗則說明原因並提供回報入口
   * 抽成 dispatch 後，新增型態只要多一個分支。 */
  /* 懸停分派。
   * 競態防護：快速掃過多個標記時，較早發出的請求可能較晚回來，
   * 覆蓋掉使用者當前指向的內容，導致在 A 條旁看到 B 條的內文
   * （codex review 實測：先顯示第 2 條，180ms 後被第 1 條覆蓋）。
   * 以遞增序號把關，只有最新一次懸停的結果能更新面板。 */
  var hoverSeq = 0;
  function dispatch(anchor, label, fetcher, render, report) {
    var seq = ++hoverSeq;
    showPanel(anchor, function (box) { renderMsg(box, '查詢中…', label); });
    fetcher()
      .then(function (data) {
        if (seq !== hoverSeq) return;      // 已有更新的懸停，捨棄這次結果
        showPanel(anchor, function (box) { render(box, data); });
      })
      .catch(function (err) {
        logErr(report.kind || '查詢失敗', label + '：' + err.message);
        if (seq !== hoverSeq) return;
        showPanel(anchor, function (box) {
          renderMsg(box, report.msg, err.message + '　（查不到比查錯安全）',
            { kind: 'missing', name: report.name, flno: report.flno,
              raw: report.raw, err: err.message });
        });
      });
  }

  // 往上找帶有指定 dataset 的元素（滑到內部的 <a> 或 <span> 時也要能命中）
  function closestData(node, key) {
    for (var i = 0; i < 3 && node; i++, node = node.parentElement) {
      if (node.dataset && node.dataset[key]) return node;
    }
    return null;
  }

  /* 觸控裝置沒有 hover，改以點擊觸發。
   * 手機瀏覽器會把 tap 合成 mouseover + click，若不攔截 click，
   * 原站的條號連結會直接跳頁，面板還沒看到就消失了。 */
  var TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  function handleHover(t) {

    // 條號標題 → 沿革
    var head = closestData(t, 'lhHead');
    if (head) {
      var fl = head.dataset.lhHead;
      dispatch(head, '第 ' + fl + ' 條',
        function () { return fetchHistory(SELF.pcode); },
        function (box, h) { renderHistory(box, SELF.name, fl, h, historyFor(h, fl)); },
        { msg: '查不到沿革', kind: '查不到沿革', name: SELF.name, flno: fl });
      return;
    }
    if (!t.dataset) return;

    // 司法院解釋 → 解釋文
    if (t.dataset.ex) {
      dispatch(t, t.dataset.name,
        function () { return fetchExplain(t.dataset.ex, t.dataset.exno, t.dataset.exyear); },
        renderExplain,
        { msg: '查不到這則解釋', kind: '查不到解釋',
          name: t.dataset.name, raw: t.textContent });
      return;
    }

    // 法條引用 → 條文
    if (!t.dataset.flno) return;
    var hit = {
      xiang: t.dataset.xiang ? +t.dataset.xiang : null,
      kuan: t.dataset.kuan ? +t.dataset.kuan : null,
      flno: t.dataset.flno, raw: t.textContent
    };
    dispatch(t, t.dataset.name + ' 第 ' + t.dataset.flno + ' 條',
      function () {
        return (t.dataset.pcode ? Promise.resolve(t.dataset.pcode) : findPcode(t.dataset.name))
          .then(function (pc) { return fetchArticle(pc, t.dataset.flno); });
      },
      function (box, art) { renderArticle(box, art, hit); },
      { msg: '查不到條文', kind: '查不到條文', name: t.dataset.name,
        flno: t.dataset.flno, raw: t.textContent });
    return true;
  }

  document.addEventListener('mouseover', function (e) { handleHover(e.target); }, true);

  if (TOUCH) {
    document.addEventListener('click', function (e) {
      var t = e.target;
      // 條號標題本身是連結，點了會跳頁；先攔下來顯示面板
      if (closestData(t, 'lhHead') || (t.dataset && (t.dataset.flno || t.dataset.ex))) {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(hideTimer);
        handleHover(t);
      }
    }, true);
    // 點面板以外的地方關閉，符合手機操作習慣
    document.addEventListener('touchstart', function (e) {
      if (panel.contains(e.target)) return;
      if (closestData(e.target, 'lhHead')) return;
      if (e.target.dataset && (e.target.dataset.flno || e.target.dataset.ex)) return;
      hide(panel);
    }, true);
  }

  document.addEventListener('mouseout', function (e) {
    if (TOUCH) return;   // 觸控裝置改由點擊外部關閉，移出即關會來不及看
    var t = e.target;
    if ((t.dataset && (t.dataset.flno || t.dataset.ex)) || closestData(t, 'lhHead')) scheduleHide();
  }, true);

  /* ---------- 啟動提示 ---------- */
  if (!SITE) {
    // 在不支援的網站上點書籤，必須講清楚而不是靜默無反應
    var warn = el('div', CLS.toast);
    var wb = el('div', CLS.toastIn);
    wb.appendChild(el('span', CLS.toastDot, '!'));
    var wm = el('span');
    wm.appendChild(el('span', null, '本工具僅在法規網站上運作'));
    wm.appendChild(el('span', CLS.toastSub,
      '\u00a0\u00b7\u00a0目前支援：全國法規資料庫、臺北市法規查詢系統'));
    wb.appendChild(wm);
    warn.appendChild(wb);
    document.body.appendChild(warn);
    setTimeout(function () { if (warn.parentNode) warn.remove(); }, 4200);
    return;
  }

  // 先標條號標題，掃描時才能正確排除，避免標題被當成引用
  var headCount = markArticleHeads();
  scan(document.body);
  /* 啟用提示：置頂置中，並讓標記閃兩下。
   * 使用者剛從書籤列點下來，視線在畫面上緣；提示若在右下角常被忽略，
   * 會誤以為書籤沒生效。找到 0 處時也要講清楚，不能靜默。 */
  var toast = el('div', CLS.toast);
  var box = el('div', CLS.toastIn);
  box.appendChild(el('span', CLS.toastDot, (count || headCount) ? '\u2713' : '!'));
  var msg = el('span');
  if (count) {
    msg.appendChild(el('span', null, '已啟用，標記 '));
    msg.appendChild(el('span', CLS.toastNum, String(count)));
    msg.appendChild(el('span', null, ' 處法條引用'));
    msg.appendChild(el('span', CLS.toastSub, '\u00a0\u00b7\u00a0' +
      (TOUCH ? '點紅色虛線看條文' : '滑過紅色虛線看條文') +
      (headCount ? '，黃底條號代表修正過' : '')));
  } else if (headCount) {
    msg.appendChild(el('span', null, '已啟用，標記 '));
    msg.appendChild(el('span', CLS.toastNum, String(headCount)));
    msg.appendChild(el('span', null, ' 個條號'));
    msg.appendChild(el('span', CLS.toastSub, '\u00a0\u00b7\u00a0黃底條號代表修正過'));
  } else {
    msg.appendChild(el('span', null, '已啟用，但這一頁沒有找到法條引用'));
    msg.appendChild(el('span', CLS.toastSub, '\u00a0\u00b7\u00a0換一頁再點一次'));
  }
  box.appendChild(msg);
  toast.appendChild(box);
  document.body.appendChild(toast);

  // 讓標記閃兩下，明確指出「被標起來的是這些字」
  if (count) {
    var flashed = document.querySelectorAll('[data-flno],[data-ex]');
    for (var fi = 0; fi < flashed.length && fi < 400; fi++) {
      flashed[fi].classList.add(PFX + 'fl');
    }
    setTimeout(function () {
      for (var j = 0; j < flashed.length && j < 400; j++) {
        flashed[j].classList.remove(PFX + 'fl');
      }
    }, 2400);
  }
  setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3600);

  /* 常駐回報入口：低調但找得到。
   * 顯示錯誤的資料是最難自己察覺的問題，必須讓使用者隨時能反映。 */
  var fab = el('button', CLS.fab);
  fab.appendChild(el('span', null, '\u2709'));
  fab.appendChild(el('span', null, '回報問題'));
  fab.setAttribute('title', '法條沒顯示或顯示錯了？點此回報');
  fab.addEventListener('click', function () { openReport({}); });
  document.body.appendChild(fab);

  window.__lawhover__ = {
    hist: fetchHistory, histFor: historyFor,
    toggle: function () { markArticleHeads(); scan(document.body); },
    count: function () { return count; }
  };
})();
