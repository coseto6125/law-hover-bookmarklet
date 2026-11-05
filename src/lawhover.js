/* 法條懸停 bookmarklet - 在法規網站上就地顯示被引用的條文
 * 同源 fetch，不需伺服器。各站 CSP 的 connect-src 'self' 允許。
 */
(function () {
  'use strict';
  if (window.__lawhover__) { window.__lawhover__.toggle(); return; }

  var HOST = location.origin;
  var LC = HOST + '/LawClass/';     // 中央站路徑前綴
  var ENC = encodeURIComponent;
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
   *   headSel     條號標題的選擇器（掃描時排除，並標出沿革）
   *   resultSel   搜尋結果頁中指向法規的連結選擇器
   *   idRe        從結果連結的 href 取出法規識別碼（第 1 組）
   *   historyUrl  沿革頁網址
   *   wholePage   articleUrl 回傳全文、需自行挑條時為 true（選填）
   */
  var SITES = [
    {
      id: 'moj',
      name: '全國法規資料庫',
      match: /(^|\.)law\.moj\.gov\.tw$/,
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
      headSel: '.col-no',
      // 臺北搜尋結果連到 /Law/LawSearch/LawInformation/FL039973
      resultSel: 'a[href*="LawInformation/"]',
      idRe: /LawInformation\/(FL\d+)/i,
      selfLaw: function () {
        // 網址形如 /Law/LawSearch/LawArticleContent/FL039973
        var m = /\/(FL\d+)/i.exec(location.pathname);
        if (!m) return null;
        // 實際頁面的法規名在「名　　稱」欄的連結（115 年實測），.col-article h3 是舊樣板
        var el = document.querySelector('.cont-title, .law-title, .col-input a.law-link, .col-article h3');
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
      /* 沿革要用 LawContentSource；LawContentHistoryList 是「歷史版本清單」，
       * 沒有「N. 中華民國…修正第 X 條」的沿革條目，會誤判為「未修正」
       * （codex review 實測臺東 FL023844）。 */
      historyUrl: function (id) { return glrsBase + '/LawContentSource.aspx?id=' + id; },
      wholePage: true
    });
  }

  /* 新北市自成一套系統（FLAWDAT 系列），不屬於 GLRS 共用系統。
   * 其名稱搜尋需 POST + VIEWSTATE，無法用 GET 組出，
   * 故只支援本頁條文與裸條號；外部法規引用會顯示「查不到」而非猜測
   *（查不到比查錯安全）。 */
  SITES.push({
    id: 'ntpc',
    name: '新北市電子法規查詢系統',
    match: /(^|\.)web\.law\.ntpc\.gov\.tw$/,
    headSel: 'td.col-th',
    selfLaw: function () {
      var m = /[?&]fcode=([A-Za-z0-9]+)/i.exec(location.search);
      if (!m) return null;
      var t = document.title.split(/[-|]/);
      var nm = '';
      // 條文頁的標題是「條文內容」，法規名要從頁面內文找
      var el = document.querySelector('#ctl00_cph_content_lblFname, .law-name, h2, h3');
      if (el) nm = el.textContent.trim();
      if (!nm || nm === '條文內容') nm = t[t.length - 1].trim() || '本法規';
      return { id: m[1], name: nm };
    },
    articleUrl: function (id) {
      return HOST + '/Scripts/FLAWDAT0202.aspx?fcode=' + id;
    },
    // 搜尋需 POST，無法支援；回傳 null 讓外部法規明確查不到
    searchUrl: function () { return null; },
    historyUrl: function (id) { return HOST + '/Scripts/FLAWDAT01.aspx?lncode=1' + id; },
    wholePage: true
  });

  var SITE = (function () {
    for (var i = 0; i < SITES.length; i++) {
      if (SITES[i].match.test(location.hostname)) return SITES[i];
    }
    return null;
  })();
  var CN = { 零:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10,
             壹:1, 貳:2, 參:3, 肆:4, 伍:5, 陸:6, 柒:7, 捌:8, 玖:9, 拾:10 };

  // 中文數字轉阿拉伯（支援 十/百/千，如 七十七、一百二十）
  function half(s) {
    return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }
  function cn2num(s) {
    s = half(s);
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

  /* 數字字元集只定義這一次：條號、沿革、解釋字號都由此組出，
   * 各自手寫時曾漏掉「零」，第一百零五條因此整條查不到。 */
  var NUMC = '0-9０-９一二三四五六七八九十百千零壹貳參肆伍陸柒捌玖拾佰仟';
  var NUM = '[' + NUMC + ']+';
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
  // 「本編」見於分編發布的法規（建築技術規則各編），指本頁
  var SELF_WORDS = ['本法', '本條例', '本規則', '本辦法', '本標準', '本細則',
                    '本準則', '本通則', '本編'];
  var ANAPHORA = ['同法', '同條例', '同規則', '同辦法', '該法', '該條例', '該規則', '該辦法'];

  /* 自指詞的實際指向。
   * 子法常定義「○○法（以下簡稱本法）」，此時「本法」指母法而非本頁。
   * 同一部法規可能定義多組別名（如所得稅法與臺灣地區與大陸地區人民關係條例），
   * 因此必須建立「自指詞 → 法規」對照，不能只記第一組
   * （codex review 實測：只記第一組會讓「本條例」也指向所得稅法）。 */
  var aliasCache;
  // 剝除「本細則依」「本規則依照」「特依」「依據」這類說明立法依據的公文用語
  function dropBasis(s) {
    return s.replace(/^本[\u4e00-\u9fa5]{1,3}?(?=(?:係)?依)/, '').replace(/^(?:係|特)?依(?:據|照)?/, '');
  }
  // 別名定義「○○法（以下簡稱本法）」：第 1 組是法規名，第 2 組是自指詞
  var ALIAS_DEF = '([\\u4e00-\\u9fa5]{2,45}?' + SUFFIX +
    ')\\s*[（(]\\s*(?:以下)?\\s*簡稱\\s*(本[\\u4e00-\\u9fa5]{1,3}|該[\\u4e00-\\u9fa5]{1,3})\\s*[）)]';
  // 文字結尾是別名定義，供條號判斷前面是否緊接「（以下簡稱本法）」
  var RE_ALIAS_TAIL = new RegExp(ALIAS_DEF + '\\s*$');
  // 文字結尾是任意名稱加別名括號（「蒙藏委員會（以下簡稱本會）」），供接回被括號隔開的字尾
  var RE_PAREN_TAIL = /([\u4e00-\u9fa5]{2,40})\s*[（(]\s*(?:以下)?\s*簡稱\s*[^（）()]{1,10}[）)]\s*$/;
  // 不能單獨成為法規名、要接在機關或法規名後面的字尾
  var RE_GENERIC_TAIL = /^(?:施行細則|施行法|組織(?:法|條例|通則|規程)|暫行組織規程|處務規程|辦事細則)$/;
  // 「其施行細則」「同法施行細則」「本法施行細則」：前半是前指詞或自指詞
  var RE_XIZE = /^(.*(?:其|本法|本條例|同法|同條例|該法|該條例))施行細則$/;

  /* 清理別名括號前的文字，取出法規名。括號是明確的右邊界；
   * 左邊界：先切句讀，再剝除公文前綴（「本細則依」這類）；
   * 句中殘留的「依」（「發電業依電業法」「所屬機關為依電腦處理個人資料保護法」）
   * 之後才是法規名。名稱本身含「依」的法規（官方只有十來部）全收在字典裡，
   * 字典名稱跨過該「依」時取字典名稱。 */
  function cleanLead(raw) {
    /* 「本X依」在 trimName 前後各剝一次。
     * 之前：前綴清單含單字「本」，先跑 trimName 只會剝掉「本」，
     *   留下「細則依化粧品衛生安全管理法」（L0030014 實測）。
     * 之後：本頁法規名前面黏著「有關」這類前綴時，要先靠 trimName 剝掉前綴，
     *   才能剝本頁法規名，露出後面的「本細則依」（codex review 實測）。 */
    var nm = String(raw).replace(/^[\s\S]*?[。；;，,：:）)]/, '');
    // 字典裡的完整名稱跨過這個「依」時不切（原住民族依生活慣俗採取森林產物規則）
    var cut = nm.replace(/^[\s\S]*依(?:據|照)?(?=[\u4e00-\u9fa5]{2})/, '');
    var known = matchKnown(nm);
    nm = known.length > cut.length ? known : cut;
    nm = trimName(dropBasis(nm));
    // 頁面標題與內文相連時，法規名前面可能黏著本頁法規名，需剝除
    if (SELF && SELF.name && nm.indexOf(SELF.name) === 0 && nm.length > SELF.name.length) {
      nm = nm.slice(SELF.name.length);
    }
    return dropBasis(nm);
  }

  /* 別名定義括號前的法規名；不是有效的外部法規名時回傳空字串。
   * 不可用 cutLeft，法規名內部常含「與」「及」
   *（「臺灣地區與大陸地區人民關係條例」會被切成「大陸地區人民關係條例」）。 */
  function aliasName(raw) {
    var nm = cleanLead(raw);
    if (!nm || nm.length < 2 || SUFFIX_ONLY.test(nm)) return '';
    return nm === (SELF && SELF.name) ? '' : nm;
  }

  function aliasMap() {
    if (aliasCache !== undefined) return aliasCache;
    aliasCache = {};
    var txt = (document.body ? document.body.textContent : '').slice(0, 8000);
    // 非貪婪：只取最靠近括號的法規名，避免把前文（含本頁法規名）吃進來
    var re = new RegExp(ALIAS_DEF, 'g');
    var m;
    while ((m = re.exec(txt)) !== null) {
      var nm = aliasName(m[1]);
      if (nm && !aliasCache[m[2]]) aliasCache[m[2]] = nm;   // 同一詞以第一個定義為準
    }
    return aliasCache;
  }

  /* 依實際命中的自指詞決定指向；該詞沒有專屬定義時才回退本頁法規。 */
  function selfTarget(word) {
    var a = aliasMap();
    if (word && a[word]) return { name: a[word], pcode: null };
    return { name: SELF.name, pcode: SELF.pcode };
  }
  /* 兩個引用之間只有連接詞與條項串，仍是同一部法的延續：
   * 「民事訴訟法第四百八十八條第一項、第三項、第四百九十條」的「、第三項、」。
   * 逗號只在列舉中（間隔已有頓號）或後接連接詞時算列舉：
   *   「本法第二十二條第四項、第七項，第二十三條第六項」「國籍法第二條第一款至第四款，及第八條」
   * 否則逗號後是下一個子句：「行政程序法第四十八條第五項但書，第五條所定申請文件」
   * 的第五條屬本頁（codex review 實測）。
   * 只有連接詞的間隔（含逗號）沿用原本的判定。 */
  var RE_LIST_GAP = new RegExp('^(?:[\\s、，,及與或暨至]|第\\s*' + NUM + '\\s*[項款目]|本文|但書|前段|後段)*$');
  function listGap(gap) {
    return RE_LIST_GAP.test(gap) && (gap.indexOf('、') >= 0 || !/[，,](?!\s*[及與或暨])/.test(gap));
  }
  // 末字是「及」「與」但整個詞是動詞（「參與第九條」「涉及第九條」），不是並列連接詞
  var RE_VERB_CONJ = /(?:涉|波|危|顧|論|提|觸|溯|普)及\s*$|(?:參|給|授|賦|贈|干)與\s*$/;
  var SELF_PREFIX = '(?:本法|本條例|本規則|本辦法|本標準|本細則|本準則|本通則|本編|同法|同條例|該法)?';
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
                '另依', '另按', '復依', '爰按', '茲按', '另', '復', '爰', '茲', '除',
                '本法依', '本條例依', '本規則依', '本辦法依', '本法係依', '本條例係依',
                '本法', '本條例', '本規則', '本辦法',
                '依據', '按照', '違反', '有關', '案內', '參照', '準用', '適用', '依照', '茲依',
                '不受', '不適用', '未依', '得依', '應依', '亦同', '所稱', '規定', '準此',
                '涉有', '涉嫌', '依', '按', '案', '及', '與', '或', '暨', '之', '為', '該', '本', '同',
                '前開', '前揭', '所定', '規定', '爰依', '查', '據', '以', '因', '就', '對',
                '參', '如', '至', '而', '並', '且', '惟', '但', '故', '則', '乃', '係'];
  // 這些是法規官方全名的一部分，剝除前綴時不可越過它們
  /* 「查核」「查禁」等複合詞開頭的是法規名本身，前綴清單的「查」（公文的「經查」）
   * 不可剝：「準用查核辦法」會變成「核辦法」（法規全文語料實測）。 */
  var KEEP = ['中華民國', '臺灣省', '台灣省', '直轄市', '縣（市）',
              '查核', '查禁', '查緝', '查驗', '查詢', '查封', '查扣', '查察', '查證', '查處', '查估', '查帳', '查勘'];
  /* 法規名的左邊界。
   * 原本只靠前綴黑名單修剪，遇到「第一百六十四條及民法」「行政機關依中央法規標準法」
   * 這類真實條文就會把前一段吃進來，導致完全查不到（codex review 實測三例）。
   * 改為先以硬邊界切開：條號結尾、連接詞、標點之後才是法規名的起點。 */
  /* 邊界只認明確的語法標記：
   *   完整的「第N條/項/款/目」（不可只認單一個「條」字，
   *   否則「中華民國憲法增修條文」會被切成「文」）
   *   標點、連接詞、動詞
   * 取最後一個邊界之後的部分作為法規名。 */
  // 「第五條之一」整個是邊界，否則「依第五條之一所定辦法」會切成「一所定辦法」
  var HARD_EDGE = new RegExp(
    '(?:第\\s*' + NUM + '\\s*[條項款目](?:\\s*之\\s*' + NUM + ')?|[、，,；;。．：:（）()「」『』《》〈〉\\s]|' +
    '及|或|與|暨|準用|適用|規定|所稱|依據|依照|按照|依|按)', 'g');
  /* 常見法規的完整名稱。
   * 字元邊界規則無法區分「及／與」是句子連接詞還是法規名的一部分
   *（「兒童及少年性剝削防制條例」會被切成「少年性剝削防制條例」），
   * 也無法窮舉所有動詞（「承租人違反民法」）。
   * 以字典做最長後綴匹配可同時解決兩者，字典外的名稱再用字元規則。 */
  /* 全國法規資料庫收錄的法規名稱，由 build/gen-lawnames.js 於建置時
   * 自官方開放資料產生，於建置時替換下面那個佔位字串。
   *
   * 為何要收錄完整清單而非幾十部常見法規：字典是以「最長後綴匹配」判定
   * 法規名的左邊界，字典裡若只有短名，短名就會把更長的真實法規名吃掉而
   * 顯示錯誤法條——手寫的 100 部字典實測有 264 例切錯，例如
   * 「依公教人員保險法」被切成「保險法」、「監獄行刑法」被切成「刑法」。
   * 收錄完整清單後，最長匹配自然選中正確的那一部。 */
  /* 「刑法」「憲法」是通稱，不在官方名單裡（官方名為中華民國刑法），
   * 但條文最常這樣引用；不放進字典，「曾犯刑法」就切不出左邊界。 */
  var KNOWN = '@@LAWNAMES@@'.split('|').concat(REAL_LAW_NAMES);
  /* 前接國名是外國法規；「我國」「本國」「中華民國」是我國（「大韓民國」不是）。
   * 不以「國」結尾的國名要逐一列出（「新加坡公司法」「歐盟個人資料保護法」）；
   * 「意大利」不列，會誤中「注意大利率」這類詞。 */
  var RE_FOREIGN = new RegExp('(?:國|日本|大陸|香港|澳門|新加坡|歐盟|歐洲(?:聯盟)?|越南|菲律賓|印尼|印度(?:尼西亞)?|' +
    '馬來西亞|澳洲|澳大利亞|紐西蘭|加拿大|德意志|義大利|西班牙|葡萄牙|荷蘭|比利時|瑞士|瑞典|挪威|丹麥|芬蘭|' +
    '奧地利|俄羅斯|以色列|土耳其|巴西|墨西哥|阿根廷|智利|南非|蒙古|緬甸|柬埔寨|汶萊)$');
  var RE_DOMESTIC = /(?:我國|(?:^|[^日])本國|中華民國)$/;
  var IS_KNOWN = {};
  for (var ki0 = 0; ki0 < KNOWN.length; ki0++) IS_KNOWN[KNOWN[ki0]] = true;

  /* 已知法規名的最長後綴，不論前面接什麼。 */
  function longestKnown(raw) {
    var best = '';
    for (var i = 0; i < KNOWN.length; i++) {
      var k = KNOWN[i];
      if (k.length > best.length && raw.length >= k.length &&
          raw.slice(-k.length) === k) best = k;
    }
    return best;
  }
  /* 先以已知法規名做最長後綴匹配；命中即為明確的左邊界。
   * 前面接國名時是外國法規（「日本刑法」「德國憲法」「日本民事訴訟法」），
   * 不可當成我國同名法規；字典裡每一部都適用，不只通稱（codex review 實測）。 */
  function matchKnown(raw) {
    var best = longestKnown(raw);
    var lead = raw.slice(0, raw.length - best.length);
    return RE_FOREIGN.test(lead) && !RE_DOMESTIC.test(lead) ? '' : best;
  }

  var RE_ENDS_LAW = new RegExp(SUFFIX + '$');
  function cutLeft(raw) {
    var known = matchKnown(raw);
    if (known) return known;
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
      /* 已是完整的已知法規名就停手：前綴清單含「就」「本」等單字，
       * 否則「就業保險法」會被剝成「業保險法」（施行細則語料實測 33 處）。 */
      if (IS_KNOWN[name]) break;
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
   * 其餘 4xx（除 400/408/429）為明確拒絕，不重試。
   */
  // 取回並解析為 DOM
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
    /* 本頁若就是該法規，直接用本頁代碼，免一次搜尋。
     * 用各站自己的 selfLaw：只認網址的 pcode= 時，新北市（fcode=）的具名本頁引用
     * 會落到不支援搜尋而查不到（review 實測）。
     * 名稱要與本頁標題相符，不可只是包含：施行細則頁的標題含有母法名稱，
     * 用「包含」會把母法的引用抓成本頁條文（sonnet review 實測
     * 勞工保險條例施行細則頁上的「勞工保險條例第三條」顯示細則第三條）。 */
    if (SELF && scoreCandidate(SELF.name, name) > 0) {
      pcodeCache[name] = SELF.pcode;
      return Promise.resolve(SELF.pcode);
    }
    var url = SITE.searchUrl(name);
    if (!url) return Promise.reject(new Error('本站不支援跨法規查詢，請於該法規頁面使用'));
    return fetchDoc(url).then(function (doc) {
      var rows = doc.querySelectorAll(SITE.resultSel);
      var best = null, bestScore = 0;
      for (var i = 0; i < rows.length; i++) {
        var href = rows[i].getAttribute('href') || '';
        // 英譯版是另一套內容，條號對不上，必須排除
        if (/\/ENG\//i.test(href)) continue;
        var m = SITE.idRe.exec(href);
        if (!m) continue;
        var sc = scoreCandidate(rows[i].textContent.trim(), name);
        if (sc > bestScore) { bestScore = sc; best = m[1]; if (sc === 100) break; }
      }
      if (best) { pcodeCache[name] = best; return best; }
      throw new Error('找不到法規「' + name + '」');
    });
  }

  var histCache = {};
  /* 沿革條目裡只有「修正／增訂／刪除…第 N 條」才是修法；同一筆條目常附帶其他文字，
   * 其中的條號不是這次修正的條文（11804 部法規的沿革實測 3145 筆被算錯）：
   *   行政院公告「第 77-3 條第 6 項所列屬『財政部』之權責事項…改由…管轄」
   *   施行令「令發布第 51-5 條定自…施行」、「依第 55 條規定：施行日期，由行政院定之」
   *   「但修正前…第 19～22 條之刪除，自公布日施行」、勘誤與更正
   * 因此只從修法動詞起算：動詞（修正、增訂、刪除、廢止、遞改為、改為…，可接公布／發布／通過／下達，
   * 含「修發布」「修正公」等原站錯字）之後緊接「第」或數字（中間只容「名稱及」「並遞改為」），
   * 一直到分號、句號、冒號、下一個「中華民國○年」（附帶的另一份公文）、公告、「依」或「除」為止。
   * 「原第 31 條遞改為第 32 條」只算新條號 32；舊編號「原第 31 條」對不到現在的條文，列為不確定。
   * 沒有修法動詞的「公布第 101 條條文」（舊沿革寫法）也算，但子句裡提到施行或停用的是施行令。 */
  var spc = function (w) { return w.split('').join('\\s?'); };
  var RE_AMD = new RegExp('(?:(?:' + ['修正', '增訂', '刪除', '廢止', '增列', '制定', '訂定', '修定', '遞改為', '遞移為', '改為'].map(spc).join('|') +
    '|修(?=\\s?發))(?:\\s?(?:[公發](?:\\s?布)?|通\\s?過|下\\s?達))?|[公發]\\s?布)' +
    '(?=\\s?(?:' + spc('名稱') + '\\s?[及、]?)?(?:並\\s?)?(?:' + spc('遞改為') + ')?\\s?[第\\d])' +
    '(?:(?!' + spc('中華民國') + '|' + spc('公告') + '|依|[^刪\\s]除)[^；;。：:])*', 'g');
  // 條號或點號清單：「第 40、77-3、74～75-1 條」「第 3、6、7 點」
  var RE_SEG = new RegExp('(?:^|[^全文])第([' + NUMC + '\\s\\-－～~、，,及]+?)([條點])(?:\\s*之\\s*(' + NUM + '))?(?!\\s?解\\s?釋)', 'g');   // 「廢止第 13 條解釋函」廢的是函
  var RE_BIAN = new RegExp('([^公布；，、]{1,4}編)全文(' + NUM + ')條', 'g');   // 「親屬編全文 171 條」
  /* 取得法規沿革，並挑出提到指定條號的修法紀錄。
   * 原站沒有「歷史條文」功能（LawOldVer 等端點皆回 400），
   * 但沿革頁載明每次修法動到哪幾條，足以回答「這條何時改過」。
   * 讀舊函釋時，這是判斷條文是否已異動的關鍵線索。 */
  function fetchHistory(pcode) {
    if (histCache[pcode]) return Promise.resolve(histCache[pcode]);
    return once('hist|' + pcode, function () { return fetchHistory_(pcode); });
  }
  function fetchHistory_(pcode) {
    var url = SITE.historyUrl(pcode);
    return fetchDoc(url).then(function (doc) {
      /* 沿革條目的呈現方式各站差異極大（元素列、純文字段落、表格），
       * 用選擇器逐一適配很脆弱。改為對整份文字做切分。
       * 地方共用系統的沿革只在這個容器內，限縮範圍可避開表頭的「發文字號：中華民國…」。 */
      var root = doc.querySelector('#ctl00_cp_content_divLawContentSource') || doc.body;
      /* <br> 的 textContent 是空字串，地方站以 <br> 分隔條目，不補換行會黏成一筆；
       * 頁尾要先拿掉，否則最後一筆會吃進頁尾文字。 */
      [].forEach.call(root.querySelectorAll('br, footer'), function (x) {
        x.parentNode.replaceChild(doc.createTextNode(x.nodeName === 'BR' ? '\n' : ''), x);
      });
      // 全形數字先轉半形，條目起點與日期的判斷才不會因「１１５年」整筆漏掉
      var whole = half(root.textContent.replace(/[\u00a0\u3000]/g, ' '));
      /* 條目多為「N. 中華民國○年…」；高雄、南投等站沒有編號，只能靠行首的「中華民國○年」。
       * 無編號的切法只在找不到編號時才用：條目內文的「並自中華民國○年施行」可能被折到行首。 */
      var YR = '中華民國(?=\\s*[0-9〇一二三四五六七八九十百零]{1,6}\\s*年)';
      var starts = [], cut = [new RegExp('(?:^|\\s)\\d+\\.\\s*' + YR, 'g'), new RegExp('(?:^|\\n)[ \\t]*' + YR, 'g')];
      for (var q = 0; q < 2 && !starts.length; q++) {
        var mm2;
        while ((mm2 = cut[q].exec(whole)) !== null) starts.push(mm2.index + mm2[0].search(/\S/));
      }
      var list = [], seen = {};
      for (var i = 0; i < starts.length; i++) {
        // 全文解析，不截斷：長的條號清單截斷後會失去結尾的「條」而整筆抽不到條號
        var t = whole.slice(starts[i], starts[i + 1]).replace(/\s+/g, ' ').trim();
        if (seen[t]) continue;
        seen[t] = 1;
        var c = t.replace(/\s+/g, '');
        // 「令修正公布第 40、77-3、74～75-1 條條文」→ 個別條號與範圍；點號加 p 前綴，與條號分開
        var arts = [], ranges = [], ua = [], ur = [], m2;
        var amt = [], ma, noAll = !/全文/.test(c);
        RE_AMD.lastIndex = 0;
        while ((ma = RE_AMD.exec(t)) !== null) {
          var x = ma[0];
          /* 施行令看整個子句（到分號、句號，或另一份公文開頭的「中華民國」）：比對本身在「中華民國」就停，
           * 「令發布第 21～23 及 26 條條文定自中華民國九十二年…施行」的「施行」在比對之外 */
          if (/^[公發]/.test(x) && /施\s?行|停\s?用/.test(t.slice(ma.index).split(/[；;。]/)[0]
            .replace(/([^自於\s])\s?中\s?華\s?民\s?國[\s\S]*/, '$1'))) continue;
          /* 「修正發布 12 條」只有一個數字時，分不出是第 12 條還是共 12 條（D0070083 全部就是 10 條、
           * 修正發布 10 條）：兩種讀法涵蓋第 1～12 條，整段列為不確定 */
          var one = /^修\s?正\s?[公發]\s?布\s?(\d+(?:-\d+)?)\s?([條點])/.exec(x);
          if (one) { addToks(['1～' + one[1]], ua, ur, one[2] === '點' ? 'p' : ''); x = x.slice(one[0].length); }
          /* 「增訂 23 條條文」省略了「第」：補上再切。只限增刪、改號與修正公布之後，且整筆不提全文：
           * 「制定公布 14 條」「全文修正 10 條」的數字是條數，不是條號。
           * 「原 76、77 條改為 79、80 條」的「改為」可能在比對中間，同樣補上 */
          if (noAll) x = x.replace(/(^(?:增\s?[訂列]|刪\s?除|廢\s?止|修\s?正\s?[公發]\s?布)[^第\d]*|改\s?為\s?)(?=\d)/g, '$1第');
          // 「第 4 條至第 21 條」「第 5 條之 1 至第 7 條」「第 3 點至第 5 點」是範圍
          amt.push(x.replace(/[條點]\s?(?:之\s?(\d+)\s?)?(?:條\s?文\s?)?至\s?第/g, function (_, k) { return (k ? '-' + k : '') + '～'; }));
        }
        amt = amt.join('；');
        RE_SEG.lastIndex = 0;
        while ((m2 = RE_SEG.exec(amt)) !== null) {
          var sp = splitArts(m2[1]), u = m2[2] === '點' ? 'p' : '';
          if (m2[3] && sp.end && cn2num(m2[3])) sp.arts[sp.arts.length - 1] += '-' + cn2num(m2[3]);   // 第 5 條之 1
          /* 列為不確定、不算修正的兩種：
           *   「第 3、8 條附表」「第 62 條條文之附式六」只改了附件，不能說本文改過
           *   「原第 22 條」是改號前的編號，對不到現在的哪一條 */
          var un = m2[0].charAt(0) === '原' ||
            /^\s?(?:條\s?文\s?)?(?:之\s?)?(?:附\s?[表件圖錄式]|(?:暫\s?行\s?)?編\s?制\s?表)/.test(amt.slice(RE_SEG.lastIndex));
          addToks(sp.arts, un ? ua : arts, un ? ur : ranges, u);
          addToks(sp.unsure, ua, ur, u);
        }
        // 中央用中文數字（一百十一年五月十一日），地方多用阿拉伯數字（115年1月23日）
        var dm = /中華民國\s*([0-9〇一二三四五六七八九十百零]{1,6}\s*年\s*[0-9一二三四五六七八九十]{1,3}\s*月\s*[0-9一二三四五六七八九十]{1,4}\s*日)/.exec(t)
              || /中華民國([^總令國]{2,24}?)(?:總統|行政院|國民政府|令|國民大會)/.exec(t);
        /* 不列個別條號的紀錄視為「動到所有條文」，但要分清兩種事件：
         * 修正公布全文是修法；制定／訂定是條文誕生，把它說成全文修正會讓讀者以為改過。 */
        var amend = /全文/.test(c) && /修正/.test(c);
        var all = !arts.length && !ua.length && (amend || (!/修正/.test(c) && /制定|訂定|全文/.test(c)));
        var bz = [], bm;   // 分編制定（民法）：標出是哪幾編，並記下各編條數
        RE_BIAN.lastIndex = 0;
        while ((bm = RE_BIAN.exec(c)) !== null) bz.push([bm[1], cn2num(bm[2])]);
        list.push({ text: t, arts: arts, ranges: ranges, unsure: ua.length ? { arts: ua, ranges: ur } : null, when: dm ? dm[1].trim() : '', i: list.length,
          whole: all, kind: all ? (amend ? 'whole' : 'enact') : '', bz: bz, no: +(/^(\d+)\./.exec(t) || [])[1],
          tag: !all ? '' : amend ? T_WHOLE : '（' + (/制定/.test(c) ? '制定' : '訂定') +
            bz.map(function (b) { return b[0]; }).join('、') + '）' });
      }
      /* 立法院只能提供連結（跨域限制見 LY_REDIRECT 的說明）。
       * 沿革頁本身就有「立法歷程」連結，可取出法律編號 CODE。 */
      /* 立法院入口有兩種格式（實測 18 部法規歸納）：
       *   多數：ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=01158
       *   分編立法者（如民法）：LawRedirectLY.aspx?pcode=B0000001
       *     民法分為總則、債、物權等 5 編，各有自己的 CODE，
       *     故導向中央站的選擇頁，由使用者挑要看哪一編。 */
      var lyCode = null, lyUrl = null;
      var lyA = doc.querySelector('a[href*="LawRedirect.ashx"]');
      if (lyA) {
        var cm = /CODE=(\d+)/.exec(lyA.getAttribute('href') || '');
        if (cm) { lyCode = cm[1]; lyUrl = LY_REDIRECT + cm[1]; }
      }
      if (!lyUrl && doc.querySelector('a[href*="LawRedirectLY.aspx"]')) {
        lyUrl = HOST + '/LawClass/LawRedirectLY.aspx?pcode=' + pcode;
      }
      bianSpans(list);
      histCache[pcode] = { url: url, list: list, lyCode: lyCode, lyUrl: lyUrl };
      return histCache[pcode];
    });
  }

  /* 分編制定的法規（民法分五編、四次制定），每次制定只產生該編的條文，
   * 不可套用到全部條文（否則第 846 條會標成「制定總則編」）。
   * 各編範圍由沿革自己的條數，依條目編號由舊到新累加：總則 152 條是 1～152，債編 604 條接著是 153～756。
   * 下列任一不成立就維持適用全部條文，不猜：
   *   有兩筆以上制定、每一筆都寫出「X編全文 N 條」、條目都有編號（才排得出先後）、
   *   沒有全文修正（全文修正可能重排條號）、沿革提到的條號都在累加的總條數內。
   * 11804 部法規的沿革中只有民法符合。 */
  function bianSpans(list) {
    var en = list.filter(function (r) { return r.kind === 'enact'; }), from = 1, max = 0;
    if (en.length < 2 || list.some(function (r) { return r.kind === 'whole'; }) ||
        !en.every(function (r) { return r.bz.length && r.no; })) return;
    list.forEach(function (r) {
      r.arts.forEach(function (k) { if (!/^p/.test(k)) max = Math.max(max, artPair(k)[0]); });
      r.ranges.forEach(function (g) { if (!g[1][2]) max = Math.max(max, g[1][0]); });
    });
    en.sort(function (a, b) { return a.no - b.no; }).forEach(function (r) {
      r.span = r.bz.map(function (b) { from += b[1]; return [[from - b[1], 0], [from - 1, 99]]; });
    });
    if (from - 1 < max) en.forEach(function (r) { r.span = null; });
  }

  /* 挑出動到指定條號的修法紀錄。
   * 「全文修正」「制定公布」不會列出個別條號，但確實動到每一條，
   * 必須納入，否則像憲法這種只有一次制定公布的法規會顯示「未修正」。
   *
   * 效能：條號上色要對整頁每一條查一次（民法 1439 條），
   * 線性掃描會是 O(條數 × 沿革筆數)。改為首次呼叫時建索引，之後 O(1)；
   * 只有含範圍（74～75-1）的紀錄需要逐筆比對，這類紀錄很少。 */
  function artKey(x) {
    var m = /^([^-]+)(?:-(.+))?$/.exec(x), a = m && cn2num(m[1]);
    if (!a) return null;
    var b = m[2] && cn2num(m[2]);
    return b ? a + '-' + b : String(a);
  }
  /* 條號清單切成個別條號或範圍（74～75-1）。
   * 原站以固定寬度折行，換行可能落在數字中間（「117↵6」「334↵-1」），
   * 也可能吃掉了頓號（「99-1↵101」「993↵994」），兩者在 HTML 裡同樣只是換行加縮排。
   * 判讀依據是清單遞增排列（20 部法規 341 筆清單無一例外）、合理位數
   * （條號最大 1222、之X 最大 47）與數字不以 0 開頭。
   * 一組內 k 個斷行各自可接可拆，窮舉全部 2^k 種讀法（k 超過 6 直接列為不確定）；
   * 恰好一種成立才採用，否則（「10、11↵12」可讀成 11、12 或 1112，
   * 「1↵0↵55」可讀成 1055 或 10、55）整組列為不確定，不計入任何條號，交由面板另行說明。 */
  function splitArts(s) {
    var gs = s.replace(/－/g, '-').replace(/~/g, '～').split(/[、，,及]/);
    var res = { arts: [], unsure: [], end: true }, prev = [0, 0];
    function ends(x) {
      var e = x.split('～').map(artKey);
      if (!x || /(^|[-～])0/.test(x) || e.length > 2 || !e.every(Boolean)) return null;
      e = e.map(artPair);
      return cmpArt(e[0], e[e.length - 1]) <= 0 &&
        e.every(function (p) { return p[0] < 1e4 && p[1] < 100; }) ? e : null;
    }
    function up(a, list) {
      return list.every(function (e) { var ok = e && cmpArt(a, e[0]) < 0; a = e && e[e.length - 1]; return ok; });
    }
    for (var i = 0; i < gs.length; i++) {
      var fr = gs[i].trim().split(/\s+/), k = fr.length - 1;
      if (!fr[0]) continue;
      var nx = k && i + 1 < gs.length && ends(gs[i + 1].replace(/\s+/g, ''));
      // 第 b 個位元為 1 表示第 b 個斷行要拆開
      var good = [];
      for (var mask = 0; k <= 6 && mask < (1 << k); mask++) {
        var toks = [fr[0]];
        for (var b = 0; b < k; b++) {
          if (mask >> b & 1) toks.push(fr[b + 1]); else toks[toks.length - 1] += fr[b + 1];
        }
        var es = toks.map(ends);
        if (up(prev, nx ? es.concat([nx]) : es)) good.push({ toks: toks, es: es });
      }
      if (good.length !== 1) {
        // 不確定：記下所有讀法（都不成立時記下全部片段與整串），供面板說明
        var alt = good.length ? [] : fr.concat(fr.join(''));
        good.forEach(function (g) { alt = alt.concat(g.toks); });
        res.unsure = res.unsure.concat(alt);
        res.end = false;
        continue;
      }
      res.arts = res.arts.concat(good[0].toks);
      res.end = true;
      var le = good[0].es[good[0].es.length - 1];
      prev = le[le.length - 1];
    }
    return res;
  }
  // u：點號為 'p'、條號為 ''，兩者各自比對，「第 3 點」不會算成第 3 條
  function addToks(toks, arts, ranges, u) {
    toks.forEach(function (x) {
      var e = x.split('～').map(function (y) { var k = artKey(y); return k && u + k; });
      if (e.length === 2 && e[0] && e[1]) ranges.push([artPair(e[0]), artPair(e[1])]);
      e.forEach(function (k) { if (k && arts.indexOf(k) < 0) arts.push(k); });
    });
  }
  function inRanges(rs, x) {
    return rs.some(function (g) { return (g[0][2] || '') === x[2] && cmpArt(g[0], x) <= 0 && cmpArt(x, g[1]) <= 0; });
  }
  function artPair(k) {
    var u = /^p/.test(k) ? 'p' : '', p = String(k).slice(u.length).split('-');
    return [+p[0] || 0, +p[1] || 0, u];
  }
  // 依（條, 之X）先後比較：75 < 75-1 < 75-2 < 76
  function cmpArt(a, b) { return a[0] - b[0] || a[1] - b[1]; }
  function histNamed(hist, flno) {
    if (!hist.byArt) {
      var idx = {}, all = [], rg = [];
      for (var i = 0; i < hist.list.length; i++) {
        var r = hist.list[i];
        if (r.whole) { all.push(r); continue; }
        for (var j = 0; j < r.arts.length; j++) {
          (idx[r.arts[j]] || (idx[r.arts[j]] = [])).push(r);
        }
        if (r.ranges.length) rg.push(r);
      }
      hist.byArt = idx;
      hist.wholes = all;
      hist.ranged = rg;
    }
    var named = hist.byArt[String(flno)] || [], x = artPair(flno);
    var extra = hist.ranged.filter(function (r) { return named.indexOf(r) < 0 && inRanges(r.ranges, x); });
    // 維持沿革原順序（新到舊）
    return extra.length ? named.concat(extra).sort(function (a, b) { return a.i - b.i; }) : named;
  }
  /* 回傳確定動到此條的紀錄（個別＋全文）；條號排版不明確、可能涉及此條的紀錄
   * 另放在 .unsure，只供面板說明，不計入修正次數。 */
  function historyFor(hist, flno) {
    var named = histNamed(hist, flno), k = String(flno), x = artPair(flno);
    var out = named.concat(hist.wholes.filter(function (r) { return !r.span || inRanges(r.span, x); }));
    out.u = /^p/.test(k) ? '點' : '條';
    out.unsure = hist.list.filter(function (r) {
      var u = r.unsure;
      return u && named.indexOf(r) < 0 && (u.arts.indexOf(k) >= 0 || inRanges(u.ranges, x));
    });
    return out;
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
      // 以清單頁為單位合併請求：不同號的憲判字同時查詢時共用同一頁
      return once('cjp|' + page, function () { return fetchText(url); }).then(function (html) {
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
    // 回應前再次滑過不重複請求（與條文共用 once 的理由相同）
    return once('ex|' + key, function () { return fetchExplain_(kind, no, year, key); });
  }
  function fetchExplain_(kind, no, year, key) {
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
        // 憲判字頁的欄名是「判決字號」，不是「裁判字號」
        var m = /^(發文單位|解釋字號|解釋日期|解釋爭點|判決日期|判決字號|裁判字號)：\s*([\s\S]*)$/.exec(t);
        if (m && !kv[m[1]]) kv[m[1]] = m[2].trim();
      }
      var pres = doc.querySelectorAll('.text-pre');
      if (!pres.length) throw new Error('查無此號解釋');
      var main = pres[0].textContent.replace(/\n\s+/g, '\n').trim();
      var got = kv['解釋字號'] || kv['判決字號'] || kv['裁判字號'] || '';
      /* 驗證取回的確實是這一號，查不到比查錯安全。
       * 號碼要整數相等：子字串比對會讓第 77 號通過第 7 號的檢查；憲判字另須年度相同。
       * 頁面沒有字號欄時改看 <title>，兩者皆無則不予採信。 */
      var chk = (got || (doc.querySelector('title') || {}).textContent || '').replace(/\s/g, '');
      var nm = new RegExp('第(' + NUM + ')號').exec(chk), ym = new RegExp('(' + NUM + ')年').exec(chk);
      if (!nm || cn2num(nm[1]) !== +no || (kind === 'CJ' && (!ym || cn2num(ym[1]) !== +year))) {
        throw new Error('字號驗證失敗');
      }
      var title = got || (kind === 'CJ' ? year + ' 年憲判字第 ' + no + ' 號' : '釋字第 ' + no + ' 號');
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
  // 之X 條有兩種寫法：「第 77 條之 2」與「第 77-2 條」，兩者都要認得
  var FL_SRC = '第\\s*(' + NUM + ')(?:\\s*[-\\u2010-\\u2015\\uff0d]\\s*([0-9０-９]+))?\\s*條(?:\\s*之\\s*(' + NUM + '))?';
  var FL_RE = new RegExp(FL_SRC);
  var HEAD_RE = new RegExp('^' + FL_SRC + '$');      // 整段文字就是一個條號標題
  function normFlno(t) {
    var m = FL_RE.exec(String(t).replace(/\u3000/g, ' '));
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
    var rows = doc.querySelectorAll('#ctl00_cp_content_tableLawArticleBasic tr, .row, tr');
    for (var i = 0; i < rows.length; i++) {
      var no = rows[i].querySelector('td.th[scope="row"], .col-no, td.col-th');
      if (!no) continue;
      if (normFlno(no.textContent) !== want) continue;
      var data = rows[i].querySelector('td:nth-child(2) .ClearCss, .col-data, td.col-td pre, td.col-td, td:nth-child(2)');
      if (!data) continue;
      return { title: no.textContent.trim(), lines: splitLines(data) };
    }

    /* blob 模式：整團文字用條號切。
     * 先找出可靠的分界，再查目標條號，兩件事分開：
     *   候選分界只取「行首」的條號；條文內的引用（「應依第2條規定」）不在行首。
     *   其後接空白或換行者是確定的標題（實測高雄 11 個標題全是「第二條&nbsp;」）。
     *   緊接文字者（「第2條乙。」）可能是標題，也可能是折到行首或以粗體起頭的引用
     *   （「第一百零五條所定之…」），只有條號唯一、且夾在順序相符的前後標題之間才採信。
     * 目標條號有兩個候選、或條文範圍內夾著未採信的候選，都代表分界不明確：
     * 寧可查不到，也不顯示可能混入他條的內容。 */
    var blob = doc.querySelector('#ctl00_cp_content_divLawContent08, .law-content, .ClearCss');
    if (blob) {
      var txt = blockLines(blob).map(function (l) { return l.t; }).join('\n').replace(/\r/g, ' ');
      // 比對只到條號本身為止：其後的換行不可吃掉，下一行的標題要靠它判斷行首
      var re = new RegExp('(^|\\n)(\\s*?)(' + FL_SRC + ')', 'g'), m, cs = [], cnt = {};
      while ((m = re.exec(txt)) !== null) {
        var at = m.index + m[1].length + m[2].length, fl = normFlno(m[3]), af = txt.charAt(re.lastIndex);
        cs.push({ i: at, t: m[3], end: re.lastIndex, no: fl, sure: !af || /\s/.test(af), p: artPair(fl) });
        cnt[fl] = (cnt[fl] || 0) + 1;
      }
      /* 同號候選有兩個以上時，無論其後是否接空白，全部都不當分界：
       * 不知道哪一個才是標題，前一條的結尾與該條本身都不確定，一律拒答。 */
      /* 順序規則：條號（含之X）沿頁面必須嚴格遞增。在確定且不重號的候選中求最長遞增鏈，
       * 只有「每一條最長鏈都包含」的候選才算標題，其餘視為未採信的候選（本條範圍內出現即拒答）。
       * 例：表格儲存格裡的「第一百零五條」夾在第一條與第二條之間，{一、一百零五} 與 {一、二}
       * 一樣長，兩者都不確定；第一條的結尾因此不明，寧可拒答也不顯示被截斷的本文。
       * 判定法：鏈上每個位置恰取一個「L 值」（以該候選結尾的最長鏈長）；候選在某條最長鏈上
       * 且同一 L 值只有它一個，才必然出現在每一條最長鏈中。 */
      var sc = cs.filter(function (x) { x.ok = false; return x.sure && cnt[x.no] === 1; });
      var L = [], R = [], top = 0, lv = {}, a1, b1;
      for (a1 = 0; a1 < sc.length; a1++) {
        L[a1] = 1;
        for (b1 = 0; b1 < a1; b1++) if (cmpArt(sc[b1].p, sc[a1].p) < 0 && L[b1] >= L[a1]) L[a1] = L[b1] + 1;
        if (L[a1] > top) top = L[a1];
      }
      for (a1 = sc.length - 1; a1 >= 0; a1--) {
        R[a1] = 1;
        for (b1 = a1 + 1; b1 < sc.length; b1++) if (cmpArt(sc[a1].p, sc[b1].p) < 0 && R[b1] >= R[a1]) R[a1] = R[b1] + 1;
      }
      sc.forEach(function (x, q) { if (L[q] + R[q] - 1 === top) lv[L[q]] = (lv[L[q]] || 0) + 1; });
      sc.forEach(function (x, q) { x.ok = L[q] + R[q] - 1 === top && lv[L[q]] === 1; });
      for (var k = 0, prev = null; k < cs.length; k++) {
        var c = cs[k];
        if (!c.ok && !c.sure) {
          var nx = null;
          for (var q = k + 1; q < cs.length && !nx; q++) if (cs[q].ok) nx = cs[q];
          c.ok = cnt[c.no] === 1 && !!nx && cmpArt(c.p, nx.p) < 0 &&
            (prev ? cmpArt(prev.p, c.p) < 0 : !txt.slice(0, c.i).trim());
        }
        if (c.ok) prev = c;
      }
      var hits = cs.filter(function (x) { return x.no === want; });
      if (hits.length) {
        var h0 = hits[0], stop = txt.length, bad = hits.length > 1 || !h0.ok;
        for (var r = cs.indexOf(h0) + 1; r < cs.length; r++) {
          if (cs[r].ok) { stop = cs[r].i; break; }
          bad = true;      // 本條範圍內夾著未採信的候選
        }
        if (bad) throw new Error('第 ' + want + ' 條在全文中的分段不明確，為免顯示錯誤條文而不顯示');
        var lines = txt.slice(h0.end, stop).split('\n').map(function (x) { return x.trim(); })
          .filter(Boolean)
          .map(function (x) { return { text: x, top: !/^[一二三四五六七八九十]、/.test(x) }; });
        if (lines.length) return { title: h0.t.trim(), lines: lines };
      }
    }
    return null;
  }

  /* 把節點內文切成行。textContent 不含換行，自行補上，行首判斷才成立。
   * 區塊元素列舉不完（<section>、<article>、<td>…），因此反過來：
   * 只有已知的行內元素不算分界，其餘元素（含 <br>）進入與離開時都斷行。
   * 「<p>第1條 甲。</p>第2條 乙。」的第 2 條因此位在行首。
   * 每行記下第一個非空白字元所在的文字節點與位移，供點號標題就地標記。 */
  var INLINE = /^(A|ABBR|B|BDI|BDO|CITE|CODE|DFN|EM|FONT|I|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR)$/;
  function blockLines(root) {
    var ls = [{ t: '' }];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          var ps = c.nodeValue.split('\n'), at = 0;
          for (var p = 0; p < ps.length; p++) {
            if (p) ls.push({ t: '' });
            var L = ls[ls.length - 1], s0 = ps[p].search(/\S/);
            if (!L.node && s0 >= 0 && !/\S/.test(L.t)) { L.node = c; L.off = at + s0; }
            L.t += ps[p];
            at += ps[p].length + 1;
          }
          continue;
        }
        if (c.nodeType !== 1) continue;      // 註解等非元素節點不是分界
        var blk = !INLINE.test(c.nodeName);
        if (blk) ls.push({ t: '' });
        walk(c);
        if (blk) ls.push({ t: '' });
      }
    })(root);
    return ls;
  }

  /* 行政規則（要點、作業規定）不分條，而以「一、二、三、」分點，引用寫作「第三點」。
   * 本頁是否分點，看本頁自己的內文（不看名稱：辦法也有分點的，要點也有分條的）：
   *   內文第一行就是「一、」（只容章名在前），之後每個「N、」行首恰好依序 1、2、3…，至少兩點；
   *   遇到附表、附件就停（附表的備註也用「一、」編號）。
   * 任一不成立就不認點：以條分項的法規第一行是「第 1 條」，款的「一、」在條文之內；
   * 壹、貳分章後各章重新從「一、」編號的計畫，「第一點」指哪一項有歧義（南投縣實測）。 */
  var PT_ROOT = ['#ctl00_cp_content_tableLawArticleBasic', '#ctl00_cp_content_divLawContent08', '.law-reg-content', '.law-content'];
  var RE_PT_HEAD = /^([一二三四五六七八九十百]+)、/;
  var RE_CHAP = new RegExp('^(?:[壹貳參肆伍陸柒捌玖拾]+、|第\\s*' + NUM + '\\s*[章節編])');
  var RE_ENUM = /^(?:[（(][一二三四五六七八九十0-9０-９]+[）)]|[0-9０-９]+\s*[.、．])/;
  function points(doc) {
    var root = null, pts = [], cur = null, stop = null, i, m;
    for (i = 0; i < PT_ROOT.length && !root; i++) root = doc.querySelector(PT_ROOT[i]);
    var ls = root ? blockLines(root) : [];
    for (i = 0; i < ls.length; i++) {
      var x = ls[i].t.replace(/\s+/g, ' ').trim(), ln = cur && cur.lines[cur.lines.length - 1];
      if (!x) continue;
      // 附件標題：後接編號或符號（「附件一申請表」「附表：」「附件【申請表】」），不含「附件應由申請人簽名」這類正文
      if (/^附[表件錄圖式](?:[一二三四五六七八九十]|[^\u4e00-\u9fa5]|$)/.test(x)) { stop = ls[i]; break; }
      if (RE_CHAP.test(x)) { cur = null; continue; }
      if (/^[一二三四五六七八九十百]+之[一二三四五六七八九十]+、/.test(x)) return null;   // 「三之一、」：不支援，整頁不認點
      if ((m = RE_PT_HEAD.exec(x))) {
        if (cn2num(m[1]) !== pts.length + 1) return null;
        pts.push(cur = { node: ls[i].node, off: ls[i].off, head: m[0], lines: [] });
        ln = null;
      } else if (!cur) return null;
      // 原站以固定寬度折行，折行處不是分段：接回前一行，除非前一行已成句或本行是款目
      if (ln && !RE_ENUM.test(x) && !/[。：:]$/.test(ln.text)) ln.text += x;
      else cur.lines.push({ text: x, top: !RE_ENUM.test(x) });
    }
    pts.root = root;
    /* 附件起點：之後的「第三點」是附件自己的編號或引用，不是本文。
     * 附件可能與本文同在一個文字節點（以換行分隔），先在起點切開，再插入一個空元素當記號：
     * 文字節點在第一次標記時會被換掉，重按書籤時就比對不到；空元素不含文字，不會被換掉 */
    if (stop) {
      var sn = stop.off ? stop.node.splitText(stop.off) : stop.node;
      pts.stop = sn.parentNode.insertBefore(doc.createElement('span'), sn);
    }
    return pts.length > 1 ? pts : null;
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
    /* 取全文的站台以法規為快取單位，避免同一部法規重複下載。
     *
     * 去重的 key 必須是「法規」而不是「條號」：外層 once() 用的是
     * art|pcode|flno，同一部法規的兩個條號同時滑過時是兩個不同的 key，
     * 在第一份全文下載完成、寫入 artCache 之前，兩者都會看到快取為空而
     * 各下載一次完全相同的全文（codex review 第 8 項實測 2 次）。
     * 因此把下載本身再包一層 once('page|pcode')，讓並發的請求共用同一個
     * Promise，完成後各自從同一份 document 挑自己的條號。 */
    var pageKey = SITE.wholePage ? 'page|' + pcode : null;
    var get = !pageKey
      ? fetchDoc(url)
      : artCache[pageKey]
        ? Promise.resolve(artCache[pageKey])
        : once(pageKey, function () {
            return fetchDoc(url).then(function (doc) {
              artCache[pageKey] = doc;
              return doc;
            });
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
    headMark: PFX + 'hm', headOn: PFX + 'ho', headOff: PFX + 'hf', sp: PFX + 'sp'
  };

  var RULES = [
    '.' + CLS.mark + '{border-bottom:1.5px dotted #c0392b;cursor:help;background:rgba(192,57,43,.06)}',
    /* 用 fixed 而非 absolute：absolute 需換算 scrollY，頁面一捲動座標就過時，
     * 導致面板跑出畫面上緣（實測小視窗會發生）。fixed 直接對應可視範圍。 */
    /* box-sizing:border-box：max-height 限制的必須是含 padding 與 border 的總高，
     * 否則面板實際高度會超出計算值而跑出畫面（codex review 實測超出 22px）。 */
    '.' + CLS.panel + '{position:fixed;top:0;left:0;z-index:2147483647;max-width:520px;' +
      'box-sizing:border-box;' +
      'max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;' +
      '-webkit-overflow-scrolling:touch;background:#fff;border:1px solid #c8ccd4;border-radius:8px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;text-align:left;color:#1a1a1a;' +
      'font:14px/1.75 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}',
    '.' + CLS.hide + '{display:none !important}',
    '.' + CLS.sp + '{flex:1}',
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

  /* 不支援的網站：只顯示提示，不建面板、不掛事件。
   * 必須在建立面板與事件之前返回，並設定 __lawhover__：否則每點一次書籤
   * 就多一張樣式表、一個面板與一組 document 事件（review 實測點三次累積三份）。 */
  if (!SITE) {
    var warn = null;
    var unsupported = function () {
      // 在不支援的網站上點書籤，必須講清楚而不是靜默無反應；重複點只留一個提示
      if (warn && warn.parentNode) warn.remove();
      warn = el('div', CLS.toast);
      var wb = el('div', CLS.toastIn);
      wb.appendChild(el('span', CLS.toastDot, '!'));
      var wm = el('span');
      wm.appendChild(el('span', null, '本工具僅在法規網站上運作'));
      /* 支援範圍要如實列出。原本只寫「全國法規資料庫、臺北市」，
       * 會讓其他 21 縣市的使用者誤以為自己的縣市不支援。 */
      wm.appendChild(el('span', CLS.toastSub,
        ' · 目前支援：全國法規資料庫，以及全台 22 縣市的地方法規系統'));
      wb.appendChild(wm);
      warn.appendChild(wb);
      document.body.appendChild(warn);
      var w0 = warn;
      setTimeout(function () { if (w0.parentNode) w0.remove(); }, 4200);
    };
    unsupported();
    window.__lawhover__ = { toggle: unsupported, count: function () { return 0; } };
    return;
  }

  /* ---------- 面板 ---------- */
  var panel = sty(document.createElement('div'), CLS.panel, CLS.hide);
  document.body.appendChild(panel);

  var hideTimer = null;
  panel.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
  panel.addEventListener('mouseleave', scheduleHide);
  function scheduleHide() { hideTimer = setTimeout(closePanel, 250); }
  /* 關閉面板也要作廢還在路上的查詢（見 dispatch 的 hoverSeq）：
   * 否則慢回來的條文或 404 會把已關的面板重新打開，且不會再自動關閉（review 實測）。 */
  var hoverSeq = 0;
  function closePanel() { hoverSeq++; clearTimeout(hideTimer); hide(panel); }

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
    // 高度上限不設下限，視窗再小也不能超出；至少留 40px 讓使用者看得到內容
    setPanelPos(top, left, Math.max(40, vh - top - EDGE));
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

  /* 複製按鈕：「複製→改文字→還原」。 */
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
      // 點的內文行是原站的折行，數不出第幾項，不標
      if (hit.xiang && ln.top && topIdx === hit.xiang && !art.pt) sty(d, CLS.hit);
      body.appendChild(d);
    });
    box.appendChild(body);

    /* 修法紀錄：條號標題與條文引用兩邊都要有。
     * 讀到某條引用時同樣需要知道「這條後來改過沒有」，
     * 拿今天的條文對照當年的函釋是會誤讀的。 */
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

  /* 為什麼不做「直達該版本」的連結。
   *
   * 立法院版本網址是 /lglawc/lawsingle?^{lyCode}{民國年月日}00^0…，
   * 前段內部識別碼可以留空，看似只要把沿革日期填進去就能直達。
   * 但立法院用「修正日」索引版本，全國法規資料庫的沿革只記載「公布日」，
   * 兩者無法互相推導——建築法 14 筆沿革的修正日與公布日「全部不同」
   * （例：修正 92/05/06、公布 92/06/05；修正 64/12/26、公布 65/01/08，
   * 連年份都跨年）。
   *
   * 更危險的是立法院對不存在的日期不會報錯，而是回一個標著該日期、
   * 內容卻是空的版本頁（實測捏造的 99/12/31 與公布日同樣得到 109 字元的
   * 空殼，真實版本則有 4046 字元）。用公布日組出的連結會 100% 落在空殼上，
   * 使用者看到標著「92年6月5日」的空頁面，只會以為那天的條文不存在。
   *
   * 查不到比查錯安全：連到版本清單頁，讓使用者自己點正確的那一版。
   * 若日後能取得修正日（例如立法院開放資料），才有條件做直達。 */
  function lyLink(h, r) {
    return link('立法院查此版', {
      href: h.lyUrl, open: 'ly',
      /* 清單頁每一版都是「修正日（連結）／公布日」上下兩行並列，
       * 所以使用者拿沿革的公布日就找得到，不必自己換算。 */
      title: r.when ? '另開立法院版本清單，找標示「' + r.when + '公布」的那一列'
                    : '另開立法院法律系統的版本清單'
    });
  }

  /* 沿革清單。條號面板與條文面板都要列修法紀錄，差別只在
   *   full=true  完整列出（條號面板，不必同時放條文）
   *   full=false 只顯示最新一筆，其餘摺疊（條文面板空間有限）
   * 抽成一個函式，避免兩處各自演化而不一致。 */
  function histList(box, h, rec, full, lineCls) {
    var named = [], amend = 0;
    for (var i = 0; i < rec.length; i++) {
      if (!rec[i].whole) named.push(rec[i]);
      else if (rec[i].kind === 'whole') amend++;
    }

    function row(r) {
      var d = el('div', lineCls, '\u00b7 ' + (r.when || r.text.slice(0, 46)) + r.tag);
      if (h.lyUrl) d.appendChild(lyLink(h, r));
      return d;
    }
    var un = rec.unsure || [], u = rec.u || '條';
    function note() {
      if (un.length) box.appendChild(el('div', lineCls, '另有 ' + un.length + ' 筆修法紀錄（' +
        un.map(function (r) { return r.when || r.text.slice(0, 20); }).join('、') +
        '）無法確認是否修正本' + u + '（原站寫法有歧義，或只改附表、附件），未計入。'));
    }
    if (!rec.length) {
      box.appendChild(el('div', lineCls, un.length ? '沒有可確認修正本' + u + '的紀錄。' : '沿革中未見此' + u + '的修正紀錄，可能自公布後未修正。'));
      note();
      return;
    }
    if (!named.length) {
      // 有不確定紀錄時不能斷言「未被個別修正過」
      box.appendChild(el('div', lineCls, un.length ? '沒有可確認修正本' + u + '的個別紀錄' + (amend ? '，全文修正 ' + amend + ' 次。' : '。')
        : amend ? '本' + u + '未被個別修正過，僅隨全文修正異動 ' + amend + ' 次。'
        : '本' + u + '未被個別修正過，也未經全文修正，沿革只有制定紀錄。'));
      note();
      if (full) rec.forEach(function (r) { box.appendChild(row(r)); });
      return;
    }
    box.appendChild(el('div', lineCls, '本' + u + '個別修正 ' + named.length + ' 次' +
      (full && amend ? '，另隨全文修正 ' + amend + ' 次' : '')));
    note();

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

  /* 條號標題（第 N 條）的沿革面板。
   * 這是使用者最自然會滑過去的位置：想知道「這條改過沒有」時，
   * 視線本來就在條號上，不必先找到某個引用。 */
  function renderHistory(box, lawName, flno, h, rec) {
    box.appendChild(el('div', CLS.head,
      (lawName ? lawName + ' ' : '') + noLabel(flno) + '　修正沿革'));
    var body = el('div', CLS.body);
    histList(body, h, rec, true, CLS.sub);
    box.appendChild(body);
    footer(box, [
      link(T_HIST, { href: h.url }),
      h.lyUrl ? link('立法院法律系統', { href: h.lyUrl, open: 'ly' }) : null
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
    if (win) { try { win.opener = null; } catch (e) {} }
    else window.open(this.href, '_blank', 'noopener');
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
    L.push('本頁法規: ' + (SELF ? SELF.name + ' (' + SELF.pcode + ')' : '(非法規全文頁)'));
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

  var KIND = { wrong: '資料顯示錯誤', missing: '沒有顯示資料' };
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
    fillOpt(optA, KIND.missing, '該標記的沒被標記，或滑過去顯示「查不到條文」。');
    fillOpt(optB, KIND.wrong, '有顯示條文，但內容不是這一條，或項次標錯。');
    function pick(k) {
      kind = k;
      optA.setAttribute('data-on', k === 'missing' ? '1' : '0');
      optB.setAttribute('data-on', k === 'wrong' ? '1' : '0');
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
    // 只在開啟時帶入一次；換問題類型時重產會把使用者刪掉的網址等資訊加回去
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
    /* 複製失敗時把整份內容放進另一個唯讀框讓使用者手動選取。不可借用診斷框：
     * 那樣使用者之後的刪改會被蓋掉，或再按一次時整份內容被包進去一層。 */
    var manual = null;
    function selectAll(full) {
      if (!manual) {
        manual = document.createElement('textarea');
        sty(manual, CLS.diag);
        manual.readOnly = true;
        inner.insertBefore(manual, f);
      }
      manual.value = full; manual.select();
      manual.setSelectionRange(0, full.length);   // iOS 需要這一步
    }
    function body() {
      return [
        '問題類型：' + (KIND[kind] || '(未選)'),
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
        selectAll(body()); copy.textContent = '已選取，請手動複製';
      });
      setTimeout(function () { copy.textContent = '複製內容'; }, 2200);
    });
    send.addEventListener('click', function () {
      var subj = '[法條懸停] ' + (KIND[kind] || '(未選)');
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
        selectAll(full);
        send.textContent = '請手動複製上方內容後寄出';
      });
    });
    cancel.addEventListener('click', closeReport);
    f.appendChild(copy);
    f.appendChild(el('span', CLS.sp));
    f.appendChild(cancel); f.appendChild(send);
    inner.appendChild(f);

    dlgEl.appendChild(inner);
    dlgEl.addEventListener('click', function (e) { if (e.target === dlgEl) closeReport(); });
    document.body.appendChild(dlgEl);
    if (kind) pick(kind);
    setTimeout(function () { ta.focus(); }, 60);
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
    var r = SITE.selfLaw();
    if (!r) return null;
    // 沿用既有欄位名，避免全檔改寫
    return { pcode: r.id, name: r.name };
  }
  var SELF = selfLaw();
  var PTS = SELF && points(document);   // 本頁的分點（不分點時為 null）

  /* 「第N點」只在本頁分點時才標，且一律指本頁的點：
   *   前面是本頁法規名（含引號）或「本要點」「本規定」這類自指詞 → 本頁
   *   前面緊接動詞或連接詞（依、符合、違反、準用、及…）或標點 → 本頁
   *   其餘（「…作業要點第三點」「…原則第五點」「…要點」第二點」）是其他規則的點，不標；
   *   與它以「及」「、」並列的點號也屬同一部規則（「…要點第二點及第四點」），同樣不標。
   * 他規則的點不做跨規則查詢：中央的行政規則不在全國法規資料庫，簡稱（「以下簡稱補助要點」）
   * 也常無從對到全名，查錯的風險高於不標。點號超出本頁點數的也不標。 */
  var RE_PT_REF = new RegExp('第\\s*(' + NUM + ')\\s*點' + TAIL, 'g');
  var RE_PT_SELF = /本(?:要點|規定|須知|原則|計畫|基準|規範|注意事項|辦法|規則|標準)$/;
  var RE_PT_OK = /(?:^|[^\u4e00-\u9fa5」』）)】A-Za-z0-9０-９]|[依及與或暨至除有於受合反理用符附現減照按如經並且以就對述])$/;
  function net(s, a, b) { return s.split(a).length - s.split(b).length; }
  /* 點號判斷用的脈絡，scan 時依文件順序走過本文一次建好（逐節點回頭讀前文是 O(n²)）：
   *   pre：同一行的前 80 個非空白字。規則名可能在前一個元素（「<a>中央補助要點</a>第三點」）；
   *        區塊元素與 <br> 是換行，清空重來，段首的「第三點」不受上一段結尾影響
   *   q、q2：此節點之前未閉合的「、『 數。引號可跨行、跨元素、跨點
   * 附件起點之後的節點不收，標記時視為不在本文。 */
  function ptPrep() {
    var w = document.createTreeWalker(PTS.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n, pre = '', q = 0, q2 = 0, map = new Map();
    while ((n = w.nextNode()) && n !== PTS.stop) {
      if (n.nodeType === 1) { if (!INLINE.test(n.nodeName)) pre = ''; continue; }
      var v = n.nodeValue;
      map.set(n, { pre: pre, q: q, q2: q2 });
      pre = (pre + v.replace(/\s+/g, '')).slice(-80);
      q = Math.max(0, q + net(v, '「', '」'));
      q2 = Math.max(0, q2 + net(v, '『', '』'));
    }
    return map;
  }
  // 從 end 往前數 n 個非空白字元，回傳其起點
  function back(text, end, n) {
    while (n > 0 && end > 0) if (/\S/.test(text.charAt(--end))) n--;
    return end;
  }
  function pointHits(text, hits, ctx) {
    var m, skipTo = -1;
    RE_PT_REF.lastIndex = 0;
    while ((m = RE_PT_REF.exec(text)) !== null) {
      var s1 = m.index, e1 = s1 + m[0].length, n1 = cn2num(m[1]);
      // 原站折行可能落在詞中間（「本辦↵法第一點」），判斷前先去掉空白，再依非空白字數倒回原文位置
      var lead = text.slice(0, s1), pre = (ctx.pre + lead).replace(/\s+/g, ''), bare = pre.replace(/」$/, ''), at = s1, w;
      if (skipTo >= 0 && listGap(text.slice(skipTo, s1))) { skipTo = e1; continue; }
      skipTo = -1;
      // 引號內是引述的文字（「中央補助要點規定：『符合第三點者…』」），點號屬於被引的規則，不標
      if (ctx.q + net(lead, '「', '」') > 0 || ctx.q2 + net(lead, '『', '』') > 0) continue;
      if (SELF.name && bare.slice(-SELF.name.length) === SELF.name) {
        at = back(text, s1, pre.length - bare.length + SELF.name.length);
        if (text.charAt(at - 1) === '「') at--;
      } else if ((w = RE_PT_SELF.exec(pre))) at = back(text, s1, pre.length - w.index);
      else if (!RE_PT_OK.test(pre)) { skipTo = e1; continue; }
      if (!n1 || n1 > PTS.length || /^\s*之/.test(text.slice(e1)) ||
          hits.some(function (h) { return at < h.end && e1 > h.start; })) continue;
      hits.push({ start: at, end: e1, name: SELF.name, pcode: SELF.pcode, pt: true,
        flno: 'p' + n1, xiang: m[2] ? cn2num(m[2]) : null, kuan: m[3] ? cn2num(m[3]) : null });
    }
  }

  // 無字尾沿用 pc；接上「施行細則」後是另一部法規，剛好是本頁時才帶本頁代碼
  function pcodeFor(name, tail, pc) {
    return !tail ? pc : (SELF && name === SELF.name ? SELF.pcode : null);
  }

  /* 收集一段文字中的所有引用（具名優先，其餘位置再找裸條號）。
   * pt：文字在本頁分點的內文裡時是 ptPrep() 建的脈絡，才找「第N點」
   * （頁面上的沿革欄等不是規則本文）；否則為 false。 */
  function collect(text, pt) {
    var hits = [], m;
    // 具名規則放棄的範圍：裸條號規則也不可接手，否則會綁成本頁法規
    var skipRanges = [];
    RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
      var rawName = m[1] || m[2];
      var tiao = cn2num(m[3]);
      if (!tiao) continue;
      /* 別名括號夾在法規名中間：「公務人員退休資遣撫卹法（以下簡稱退撫法）施行細則第十七條」
       *「蒙藏委員會（以下簡稱本會）組織法第二十七條」。括號隔開後，這裡只剩字尾，
       * 要接回括號前的名稱（法規全文語料實測 284 處只剩「施行細則」）。 */
      var lead = !m[1] && RE_GENERIC_TAIL.test(rawName) &&
        RE_PAREN_TAIL.exec(text.slice(Math.max(0, m.index - 80), m.index));
      var leadName = lead && cleanLead(lead[1]);
      /* 「其施行細則」「同法施行細則」「本法施行細則」：前半是前指詞或自指詞，
       * 指向的法規再接上「施行細則」。 */
      var xize = !m[1] && !leadName && RE_XIZE.exec(rawName);
      var base = xize ? xize[1] : rawName;
      /* 引號已是明確邊界，不可再切。
       * 未加引號時用 cutLeft 切左界，再剝除殘留的公文前綴。 */
      var name = leadName ? leadName + rawName : (m[1] ? rawName : trimName(cutLeft(rawName)));
      if (name.length < 2) continue;
      /* 「本法」「同法」等自指詞與前指詞要比對「未經 trimName 的原文」：
       * trimName 會把「本辦法」剝成「辦法」，此時自指判定必然落空，
       * 還會拿泛稱去搜尋別部法規（fable review 實測）。 */
      /* 「原住民族基本法」「教育基本法」結尾含「本法」，但它是完整的法規名，不是自指詞：
       * 字典最長匹配的法規名比該詞長時，不做後綴比對（法規全文語料實測）。 */
      /* 用不擋國名的最長匹配：「日本教育基本法」被 matchKnown 擋下後若長度變 0，
       * 結尾的「本法」會被當成自指詞而綁本頁。 */
      var knownLen = longestKnown(base).length;
      var pickWord = function (list) {
        for (var i3 = 0; i3 < list.length; i3++) {
          if (knownLen > list[i3].length) continue;
          if (base === list[i3] || (!xize && name === list[i3]) ||
              base.slice(-list[i3].length) === list[i3]) return list[i3];
        }
        return null;
      };
      var selfWord = leadName ? null : pickWord(SELF_WORDS);
      var anaWord = leadName || selfWord ? null : pickWord(xize ? ANAPHORA.concat('其') : ANAPHORA);
      /* 「能源管理法及其施行細則」：「其」指緊接在前的法規名，那部法可能沒有條號，
       * 不在已收集的引用裡。直接取「其」前面的法規名；
       * 取不到時也不可退回本頁（codex review 實測會綁成本頁的施行細則）。 */
      var lawPre = null;
      if (anaWord === '其') {
        var pre = base.slice(0, base.lastIndexOf('其')).replace(/[及與或暨、]\s*$/, '');
        var before = text.slice(Math.max(0, m.index - 80), m.index);
        // 「「勞工保險條例」及其施行細則」：引號名稱在比對範圍外
        var preQuote = !pre && /「([^」]{2,60})」\s*$/.exec(before);
        var preLead = !pre && !preQuote && RE_PAREN_TAIL.exec(before);
        lawPre = pre ? trimName(cutLeft(pre)) :
          (preQuote ? preQuote[1] : (preLead ? cleanLead(preLead[1]) : ''));
        // 「本法及其施行細則」「同法及其施行細則」：交給自指詞、前指詞的規則
        if (SELF_WORDS.indexOf(lawPre) >= 0) { selfWord = lawPre; anaWord = null; lawPre = null; }
        else if (ANAPHORA.indexOf(lawPre) >= 0) { anaWord = lawPre; lawPre = null; }
        else if (!RE_ENDS_LAW.test(lawPre) || SUFFIX_ONLY.test(lawPre)) lawPre = null;
        if (lawPre) { anaWord = null; name = lawPre + '施行細則'; }
      }
      var isSelf = !!selfWord;
      var isAna = !!anaWord;
      if (isSelf && !SELF) continue;
      /* 剝除前綴後只剩泛稱字尾（如「辦法」「法」）不是有效的法規名，
       * 拿去搜尋會得到隨機的某部法規。查不到比查錯安全，直接放棄。
       * 但「憲法」既是字尾也是真實法規名，此時應標記為該法規而非放棄，
       * 更不可讓裸條號規則接手綁成本頁法規（會顯示不相干的條文）。 */
      if (!isSelf && !isAna && SUFFIX_ONLY.test(name)) {
        /* 只放棄泛稱本身到條號尾，不含它前面被比對吃進來的文字：
         * 「違反第五條或依第六條所定辦法第三條」整段都在比對內，前面的裸條號仍要標記。
         * 被吃進來的條號必是裸條號：前面若有法規名字尾，非貪婪比對會先在那裡停下。 */
        if (REAL_LAW_NAMES.indexOf(name) < 0) {
          skipRanges.push([m.index + rawName.length - name.length, m.index + m[0].length]);
          continue;
        }
      }
      /* 標記範圍：
       *   引號法規名、別名接字尾 → 完整保留
       *   自指詞、前指詞 → 從該詞開始（rawName 可能含前文，如「…應依照本法」）
       *   一般法規名 → 剝除前綴 */
      var drop;
      if (m[1] || leadName) drop = 0;
      else if (lawPre) drop = Math.max(0, rawName.lastIndexOf(lawPre));
      else if (isSelf || isAna) drop = Math.max(0, base.lastIndexOf(selfWord || anaWord));
      else drop = rawName.length - name.length;
      var tail = xize ? '施行細則' : '';
      var tgt = isSelf ? selfTarget(selfWord) : null;
      var tgtName = tgt ? tgt.name + tail : name;
      // 母法名稱：「同法施行細則」接在「本法施行細則」後面時，要用母法名稱接字尾
      var parent = tgt ? tgt.name : (lawPre || (leadName && rawName === '施行細則' ? leadName : name));
      hits.push({
        start: m.index + drop, end: m.index + m[0].length,
        // 前指詞（同法/該法）指向前文最近的具名引用，於下方 sort 後統一解析
        name: isAna ? null : tgtName,
        // 接上「施行細則」後是另一部法規；剛好是本頁時仍帶本頁代碼
        pcode: isAna || !tgt ? null : pcodeFor(tgtName, tail, tgt.pcode),
        word: selfWord || anaWord, tail: tail, parent: parent, noSelf: anaWord === '其',
        ana: isAna,
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
         * 往前找最近的引用，符合下方兩種情形之一才視為延續。 */
        var prev = null;
        for (var pi = 0; pi < hits.length; pi++) {
          if (hits[pi].end <= s0 && (!prev || hits[pi].end > prev.end)) prev = hits[pi];
        }
        /* 同一子句內以連接詞並列時也是延續：
         * 「本法第四條第一項化粧品產品登錄…建立及第十七條第一項回收作業」
         * 的第十七條仍屬本法（L0030014 實測）。子句一斷（逗號以上）就不延續，
         * 因為施行細則也常以裸條號指自己的條文。 */
        /* 但子句內較早的引用與前一個引用不是同一部法時，並列對象有歧義，不延續：
         * 「第十四條第一項…有關應加計本條例第十二條…規定金額部分及第十五條」
         * 的第十五條是細則自己的（所得基本稅額條例施行細則第 23 條實測）。
         * 前指詞此刻還沒有法規名，一律視為不同。
         * 間隔含括號也不延續：括號內的引用不延伸到括號外。
         * 「參與」「涉及」等動詞的末字不算連接詞（codex review 實測）。 */
        var gap = prev ? text.slice(prev.end, s0) : '';
        var clauseStart = text.slice(0, s0).search(/[^，,。；;：:]*$/);
        var cont = prev && !prev.ex &&
          (/^[\s、，,及與或暨至]*$/.test(gap) || listGap(gap) ||
           (/[及與或暨]\s*$/.test(gap) && !RE_VERB_CONJ.test(gap) &&
            !/[，,。；;：:（）()]/.test(gap) &&
            !hits.some(function (h) {
              return h.start >= clauseStart && h.end <= prev.start && (h.ana || h.name !== prev.name);
            })));
        /* 延續的對象是前指詞（「同法第十七條…及第十八條」）時，它此刻還沒有法規名，
         * 必須一起標成前指詞，交給下方的前指解析；否則名稱為空，整個連結被丟掉。 */
        var ana = !!(cont && prev.ana);
        /* 條號緊接在別名定義之後：「化粧品衛生安全管理法（以下簡稱本法）第三十一條」，
         * 括號隔開了法規名，具名規則接不上，條號屬於被定義的那部法（L0030014 第 1 條）。
         * 取括號前緊鄰的法規名，不查全頁對照表：同一頁可能先後定義不同的「本法」。 */
        var def = cont ? null : RE_ALIAS_TAIL.exec(text.slice(Math.max(0, s0 - 80), s0));
        var defName = def && aliasName(def[1]);
        hits.push({
          start: s0, end: e0,
          name: cont ? prev.name : (defName || SELF.name),
          pcode: cont ? prev.pcode : (defName ? null : SELF.pcode),
          ana: ana, contAna: ana, word: ana ? prev.word : null, tail: ana ? prev.tail : '',
          parent: cont ? prev.parent : (defName || SELF.name),
          flno: m[2] ? t2 + '-' + cn2num(m[2]) : String(t2),
          xiang: m[3] ? cn2num(m[3]) : null, kuan: m[4] ? cn2num(m[4]) : null
        });
      }
    }
    if (pt) pointHits(text, hits, pt);
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

    /* 「同法施行細則」這類前指詞帶字尾，指向的是另一部法規；
     * 接上字尾後剛好是本頁時仍帶本頁代碼。 */
    var bindTo = function (h, nm, pc) {
      h.parent = nm;
      h.name = nm + (h.tail || '');
      h.pcode = pcodeFor(h.name, h.tail, pc);
    };
    /* 前指詞（同法/該法）指向前文最近的具名引用。
     * 找不到前文可指時退回本頁法規，但不可直接綁定，否則會顯示別部法的條文。 */
    for (var ai = 0; ai < hits.length; ai++) {
      if (!hits[ai].ana) continue;
      var ref = null;
      for (var aj = ai - 1; aj >= 0; aj--) {
        if (!hits[aj].ana && !hits[aj].ex && !hits[aj].pt) { ref = hits[aj]; break; }
      }
      // 帶字尾時接在母法名稱後（避免「施行細則施行細則」）；不帶字尾時指向該引用本身
      if (ref) { bindTo(hits[ai], hits[ai].tail ? (ref.parent || ref.name) : ref.name, ref.pcode); continue; }
      // 同段落找不到先行詞時，看該詞是否有別名定義（如「該條例」）
      /* 延續前指詞的裸條號不退回本頁：前指詞本身退回本頁已是猜測，
       * 再讓並列條號跟著猜，錯綁會加倍（sonnet review 於母法語料實測 26 處）。 */
      var am = aliasMap();
      if (hits[ai].word && am[hits[ai].word]) bindTo(hits[ai], am[hits[ai].word], null);
      else if (SELF && !hits[ai].contAna && !hits[ai].noSelf) bindTo(hits[ai], SELF.name, SELF.pcode);
      else hits[ai].drop = true;
    }
    hits = hits.filter(function (h) { return !h.drop && h.name; });
    // 去除重疊
    var out = [];
    hits.forEach(function (h) {
      if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
    });
    return out;
  }

  var ptMap = null;
  function markTextNode(node) {
    var text = node.nodeValue;
    // 快速過濾：不含這些關鍵字的文字節點一律略過，省下正則成本
    var pt = ptMap && text.indexOf('點') >= 0 && ptMap.get(node), hits = [];
    // 5 字以下的節點只可能是點號（「<span>本要點</span>第二點」）；條號規則要看前文，不在這裡判斷
    if (text.length < 5) { if (pt) pointHits(text, hits, pt); }
    else if (text.indexOf('條') >= 0 || text.indexOf('釋字') >= 0 || text.indexOf('憲判字') >= 0 || pt) hits = collect(text, pt);
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
  // 「第 3 條」或「第 3 點」：點號以 p 前綴與條號區分
  function noLabel(fl) { return '第 ' + String(fl).replace(/^p/, '') + (/^p/.test(fl) ? ' 點' : ' 條'); }
  var ptHeads = false;
  function markArticleHeads() {
    if (!SELF) return 0;
    var heads = document.querySelectorAll(SITE.headSel);
    var n = 0;
    /* 分點的規則沒有條號元素，點號是內文行首的「三、」：就地包成標題。
     * 只做一次，重按書籤時文字節點已被拆開，位置不再成立。 */
    if (PTS && !ptHeads) {
      ptHeads = true;
      PTS.forEach(function (p, i) {
        var tn = p.node;
        if (!tn || tn.nodeValue.substr(p.off, p.head.length) !== p.head) return;
        var hd = tn.splitText(p.off);
        hd.splitText(p.head.length);
        var sp = el('span', CLS.headMark, p.head);
        sp.dataset.lhHead = 'p' + (i + 1);
        sp.setAttribute('title', NO_HOVER ? '點一下查看修正沿革' : '滑鼠移入查看本點的修正沿革');
        hd.parentNode.replaceChild(sp, hd);
        n++;
      });
    }
    for (var i = 0; i < heads.length; i++) {
      var el0 = heads[i];
      if (el0.dataset.lhHead) continue;
      var txt = el0.textContent.replace(/\s+/g, '');
      // 地方站標題用中文數字（第一百零五條），只認阿拉伯數字會整頁漏標
      var flno = HEAD_RE.test(txt) ? normFlno(txt) : null;
      if (!flno) {
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
      el0.setAttribute('title', NO_HOVER ? '點一下查看修正沿革' : '滑鼠移入查看本條的修正沿革');
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
      historyFor(h, '');
      var amend = h.wholes.some(function (r) { return r.kind === 'whole'; });
      var heads = document.querySelectorAll('[data-lh-head]');
      for (var i = 0; i < heads.length; i++) {
        var e0 = heads[i], fl = e0.dataset.lhHead, u = /^p/.test(fl) ? '點' : '條';
        var named = histNamed(h, fl);
        if (named.length) {
          sty(e0, CLS.headOn);
          e0.dataset.lhMod = named.length;
          e0.setAttribute('title', '本' + u + '修正 ' + named.length + ' 次，滑鼠移入查看沿革');
        } else {
          // 只改附表或條號有歧義的紀錄不算修正，但也不能說「未曾修正」
          var hf = historyFor(h, fl), nu = hf.unsure.length, tt;
          if (nu) tt = '有 ' + nu + ' 筆修法紀錄無法確認是否修正本' + u + '，滑鼠移入查看沿革';
          else if (amend) tt = '本' + u + '僅隨全文修正異動，滑鼠移入查看沿革';
          else if (hf.length) tt = '本' + u + '自制定後未曾修正，滑鼠移入查看沿革';
          else tt = '沿革中未見此' + u + '的修正紀錄';
          sty(e0, CLS.headOff);
          e0.setAttribute('title', tt);
        }
      }
    }).catch(function (err) { logErr('沿革上色失敗', err.message); });
  }

  function scan(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        /* 最短的有效引用是「民法第5條」共 5 字，門檻不可高於 5；
         * 分點的頁面還有「<span>本要點</span>第二點」這類 3 字的點號節點 */
        if (!n.nodeValue || n.nodeValue.length < (PTS ? 3 : 5)) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'A') return NodeFilter.FILTER_REJECT;
        if (p.dataset && (p.dataset.flno || p.dataset.ex)) return NodeFilter.FILTER_REJECT;
        // 條號標題由 markArticleHeads 負責顯示沿革，不可再當成條文引用
        if (p.dataset && p.dataset.lhHead) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest(SITE.headSel)) return NodeFilter.FILTER_REJECT;
        if (panel.contains(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    ptMap = PTS && ptPrep();
    nodes.forEach(markTextNode);
    ptMap = null;   // 不留住已被換掉的文字節點
  }

  /* ---------- 事件 ---------- */
  /* 懸停分派。三種目標各有取文與渲染方式，用同一套流程處理：
   *   1. 立刻顯示「查詢中」，讓使用者知道有反應
   *   2. 取資料
   *   3. 成功則渲染，失敗則說明原因並提供回報入口
   * 抽成 dispatch 後，新增型態只要多一個分支。
   * 競態防護：快速掃過多個標記時，較早發出的請求可能較晚回來，
   * 覆蓋掉使用者當前指向的內容，導致在 A 條旁看到 B 條的內文
   * （codex review 實測：先顯示第 2 條，180ms 後被第 1 條覆蓋）。
   * 以遞增序號把關，只有最新一次懸停的結果能更新面板。 */
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

  /* 觸控沒有 hover，改以點擊觸發。
   * 手機瀏覽器會把 tap 合成 mouseover + click，若不攔截 click，
   * 原站的條號連結會直接跳頁，面板還沒看到就消失了。
   * 觸控或滑鼠要逐次判斷，不可整頁定案：觸控螢幕筆電用滑鼠操作時 'ontouchstart' in window 也為真，
   * 整頁當成觸控會讓滑鼠移開不關面板、點條號連結被攔下（review 實測）。
   * 以最近一次 pointer 事件的 pointerType 為準；還沒有 pointer 事件時看主要輸入能否懸停。 */
  var NO_HOVER = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  var lastPointer = '';
  function touchy() { return lastPointer ? lastPointer !== 'mouse' : NO_HOVER; }
  function onMark(t) { return closestData(t, 'lhHead') || (t.dataset && (t.dataset.flno || t.dataset.ex)); }

  function handleHover(t) {

    // 條號標題 → 沿革
    var head = closestData(t, 'lhHead');
    if (head) {
      var fl = head.dataset.lhHead;
      dispatch(head, noLabel(fl),
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
    var pn = /^p(\d+)$/.exec(t.dataset.flno);
    dispatch(t, t.dataset.name + ' ' + noLabel(t.dataset.flno),
      function () {
        // 點只指本頁（見 pointHits），直接取本頁該點，不必再抓
        if (pn) {
          fetchHistory(SELF.pcode).catch(function () {});
          return Promise.resolve({ title: noLabel(t.dataset.flno), law: SELF.name, lines: PTS[pn[1] - 1].lines,
            url: location.href, pcode: SELF.pcode, pt: true });
        }
        return (t.dataset.pcode ? Promise.resolve(t.dataset.pcode) : findPcode(t.dataset.name))
          .then(function (pc) {
            // 沿革與條文並行請求；renderArticle 稍後再呼叫會共用同一個進行中的請求
            fetchHistory(pc).catch(function () {});
            return fetchArticle(pc, t.dataset.flno);
          });
      },
      function (box, art) { renderArticle(box, art, hit); },
      { msg: '查不到條文', kind: '查不到條文', name: t.dataset.name,
        flno: t.dataset.flno, raw: t.textContent });
    return true;
  }

  document.addEventListener('mouseover', function (e) { handleHover(e.target); }, true);

  function setPointer(e) { if (e.pointerType) lastPointer = e.pointerType; }
  document.addEventListener('pointerover', setPointer, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    // 條號標題本身是連結，觸控點了會跳頁；先攔下來顯示面板。滑鼠點擊照常跳頁
    if (!touchy() || !onMark(t)) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(hideTimer);
    handleHover(t);
  }, true);
  // 點面板以外的地方關閉：觸控沒有移出事件；滑鼠點外部也立即關閉
  document.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart', function (e) {
    setPointer(e);
    if (!panel.contains(e.target) && !onMark(e.target)) closePanel();
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (touchy()) return;   // 觸控改由點擊外部關閉；合成的 mouseout 即關會來不及看
    if (onMark(e.target)) scheduleHide();
  }, true);

  /* ---------- 啟動提示 ---------- */
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
      (NO_HOVER ? '點紅色虛線看條文' : '滑過紅色虛線看條文') +
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
