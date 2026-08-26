/* 法條懸停 bookmarklet - 在全國法規資料庫頁面上就地顯示被引用的條文
 * 同源 fetch，不需伺服器。CSP connect-src 'self' 允許。
 */
(function () {
  'use strict';
  if (window.__lawhover__) { window.__lawhover__.toggle(); return; }

  var HOST = location.origin;
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
    '(?:「([^」]{2,30}?' + SUFFIX + ')」|([\\u4e00-\\u9fa5]{2,20}?' + SUFFIX + '))' +
    '\\s*第\\s*(' + NUM + ')\\s*條' +
    '(?:\\s*之\\s*(' + NUM + '))?' + TAIL,
    'g');
  // 裸條號：本法／同法／前法規名皆省略，指向當前頁面的法規
  // （法規內文最常見的形式，如「依第九十九條規定」「本法第五條」）
  var SELF_WORDS = ['本法', '本條例', '本規則', '本辦法', '本標準', '本細則',
                    '本準則', '本通則', '同法', '同條例', '該法', '該條例'];
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

  var REPORT_TO = 'enor@e-life-ai.com';
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
    // 本頁若就是該法規，直接用網址上的 pcode，免一次搜尋
    var self = /pcode=([A-Z0-9]+)/i.exec(location.search);
    var h1 = document.querySelector('#hlLawName, .table-list .h3, h2');
    if (self && h1 && h1.textContent.trim().indexOf(name) >= 0) {
      pcodeCache[name] = self[1];
      return Promise.resolve(self[1]);
    }
    var url = HOST + '/Law/LawSearchResult.aspx?ty=ONEBAR&kw=' + encodeURIComponent(name) + '&sNo=0';
    return fetchText(url).then(function (html) {
      var doc = parseHTML(html);
      var rows = doc.querySelectorAll('a[href*="pcode="]');
      var best = null, bestScore = 0;
      for (var i = 0; i < rows.length; i++) {
        var href = rows[i].getAttribute('href') || '';
        // 英譯版是另一套內容，條號對不上，必須排除
        if (/\/ENG\//i.test(href)) continue;
        var m = /pcode=([A-Z0-9]+)/i.exec(href);
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
    var url = HOST + '/LawClass/LawHistory.aspx?pcode=' + pcode;
    return fetchText(url).then(function (html) {
      var doc = parseHTML(html);
      var rows = doc.querySelectorAll('.law-history .row .col-data, .law-history .col-data');
      var list = [];
      for (var i = 0; i < rows.length; i++) {
        var t = rows[i].textContent.replace(/\s+/g, ' ').trim();
        if (!/^\d+\.\s*中華民國/.test(t)) continue;
        // 「令修正公布第 40、77-3、77-4、87 條條文」→ 取出條號清單
        var arts = [];
        var seg = /第\s*([0-9\-、，,\s]+?)\s*條/g, m2;
        while ((m2 = seg.exec(t)) !== null) {
          m2[1].split(/[、，,\s]+/).forEach(function (x) {
            x = x.trim();
            if (x && arts.indexOf(x) < 0) arts.push(x);
          });
        }
        var dm = /中華民國([^總令國]{2,24}?)(?:總統|行政院|國民政府|令|國民大會)/.exec(t);
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
      var lyA = doc.querySelector('a[href*="LawRedirect.ashx"]');
      if (lyA) {
        var cm = /CODE=(\d+)/.exec(lyA.getAttribute('href') || '');
        if (cm) { lyCode = cm[1]; lyUrl = LY_REDIRECT + cm[1]; }
      }
      if (!lyUrl && doc.querySelector('a[href*="LawRedirectLY.aspx"]')) {
        lyUrl = HOST + '/LawClass/LawRedirectLY.aspx?pcode=' + pcode;
      }
      histCache[pcode] = { url: url, list: list, lyCode: lyCode, lyUrl: lyUrl };
      return histCache[pcode];
    });
  }

  // 挑出動到指定條號的修法紀錄
  /* 挑出動到指定條號的修法紀錄。
   * 「全文修正」「制定公布」不會列出個別條號，但確實動到每一條，
   * 必須納入，否則像憲法這種只有一次制定公布的法規會顯示「未修正」。 */
  function historyFor(hist, flno) {
    var out = [];
    var want = String(flno);
    for (var i = 0; i < hist.list.length; i++) {
      var r = hist.list[i];
      if (r.arts.indexOf(want) >= 0) out.push(r);
      else if (r.whole) out.push(r);
    }
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
      : Promise.resolve(HOST + '/LawClass/ExContent.aspx?ty=C&CC=D&CNO=' + no);
    var url;
    return pre.then(function (u) { url = u; return fetchText(u); }).then(function (html) {
      var doc = parseHTML(html);
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

  function fetchArticle(pcode, flno) {
    var key = pcode + '|' + flno;
    if (artCache[key]) return Promise.resolve(artCache[key]);
    var url = HOST + '/LawClass/LawSingle.aspx?pcode=' + pcode + '&flno=' + encodeURIComponent(flno);
    return fetchText(url).then(function (html) {
      var doc = parseHTML(html);
      var box = doc.querySelector('.law-reg-content');
      if (!box) throw new Error('無法解析條文');
      var lawName = (doc.querySelector('#hlLawName') || {}).textContent || '';
      var noEl = box.querySelector('.col-no, .h3');
      var title = noEl ? noEl.textContent.trim() : ('第 ' + flno + ' 條');
      var lines = [];
      box.querySelectorAll('.law-article > div').forEach(function (d) {
        var tx = d.textContent.trim();
        if (tx) lines.push({ text: tx, top: /show-number|line-0000/.test(d.className) && !/line-000[1-9]/.test(d.className) });
      });
      if (!lines.length) {
        var tx = box.textContent.replace(/\s+/g, ' ').trim();
        if (tx) lines.push({ text: tx, top: true });
      }
      // 驗證：確定抓回來的是這一條，查不到比查錯安全
      var got = title.replace(/\s/g, '');
      var want = '第' + String(flno).replace('-', '-') + '條';
      if (got.indexOf(String(flno).split('-')[0]) < 0) throw new Error('條號驗證失敗');
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
    toastIn: PFX + 'ti', toastDot: PFX + 'td', toastNum: PFX + 'tn',
    toastSub: PFX + 'ts', hide: PFX + 'hide',
    fab: PFX + 'fab', dlg: PFX + 'dlg', dlgIn: PFX + 'dgi', dlgH: PFX + 'dgh',
    row: PFX + 'row', opt: PFX + 'opt', ta: PFX + 'ta', btn: PFX + 'btn',
    btnP: PFX + 'btnp', dgf: PFX + 'dgf', lbl: PFX + 'lbl', diag: PFX + 'dg2',
    rptLink: PFX + 'rl', hist: PFX + 'hs', histI: PFX + 'hi',
    headMark: PFX + 'hm'
  };

  var RULES = [
    '.' + CLS.mark + '{border-bottom:1.5px dotted #c0392b;cursor:help;background:rgba(192,57,43,.06)}',
    '.' + CLS.panel + '{position:absolute;top:0;left:0;z-index:2147483647;max-width:520px;' +
      'max-height:60vh;overflow:auto;background:#fff;border:1px solid #c8ccd4;border-radius:8px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;text-align:left;color:#1a1a1a;' +
      'font:14px/1.75 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}',
    '.' + CLS.hide + '{display:none !important}',
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
    /* 條號標題：低調的可互動提示，不干擾原本版面 */
    '.' + CLS.headMark + '{cursor:help;border-bottom:1.5px dotted #1b5e57;' +
      'background:rgba(27,94,87,.07);border-radius:3px}',
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
  function setPanelPos(top, left) {
    if (posRule && posRule.style) {
      try {
        posRule.style.setProperty('top', top + 'px');
        posRule.style.setProperty('left', left + 'px');
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

  function showPanel(el, buildFn) {
    clearTimeout(hideTimer);
    panel.innerHTML = '';
    buildFn(panel);
    show(panel);
    var r = el.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6;
    var left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - panel.offsetWidth - 16);
    if (top + panel.offsetHeight > window.scrollY + window.innerHeight && r.top > panel.offsetHeight + 12) {
      top = r.top + window.scrollY - panel.offsetHeight - 6;
    }
    setPanelPos(top, Math.max(8, left));
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
    if (art.pcode && hit.flno) {
      var hbox = el('div', CLS.hist);
      hbox.appendChild(el('div', CLS.histI, '查詢修法紀錄…'));
      box.appendChild(hbox);
      fetchHistory(art.pcode).then(function (h) {
        var rec = historyFor(h, hit.flno);
        hbox.innerHTML = '';
        if (!rec.length) {
          hbox.appendChild(el('div', CLS.histI, '沿革中未見此條的修正紀錄（可能自公布後未修正）'));
        } else {
          hbox.appendChild(el('b', null, '本條修正 ' + rec.length + ' 次：'));
          rec.slice(0, 4).forEach(function (r) {
            var line = el('div', CLS.histI, '· ' + (r.when || r.text.slice(0, 40)) +
              (r.whole ? '（全文修正）' : ''));
            if (h.lyUrl) {
              var la = el('a', CLS.link, '當時條文');
              la.href = h.lyUrl;
              la.target = 'lawhover_ly'; la.rel = 'noopener';
              la.setAttribute('title', '在立法院法律系統查看當年條文與修法理由（另開視窗）');
              la.addEventListener('click', openLyWindow);
              line.appendChild(la);
            }
            hbox.appendChild(line);
          });
          if (rec.length > 4) hbox.appendChild(el('div', CLS.histI, '…另有 ' + (rec.length - 4) + ' 次'));
        }
        var hl = el('a', CLS.link, '查看完整沿革');
        hl.href = h.url; hl.target = '_blank'; hl.rel = 'noopener';
        hbox.appendChild(hl);
      }).catch(function () {
        hbox.innerHTML = '';
        hbox.appendChild(el('div', CLS.histI, '沿革查詢失敗'));
      });
    }

    var foot = el('div', CLS.foot);
    var a = el('a', CLS.link, '在全國法規資料庫開啟');
    a.href = art.url; a.target = '_blank'; a.rel = 'noopener';
    foot.appendChild(a);
    var cp = el('a', CLS.link, '複製條文');
    cp.addEventListener('click', function (e) {
      e.preventDefault();
      var txt = head.textContent + '\n' + art.lines.map(function (l) { return l.text; }).join('\n');
      try {
        navigator.clipboard.writeText(txt);
        cp.textContent = '已複製';
        setTimeout(function () { cp.textContent = '複製條文'; }, 1500);
      } catch (err) { cp.textContent = '複製失敗'; }
    });
    foot.appendChild(cp);
    // 顯示錯誤資料是最難自己發現的問題，在條文旁給一個直接入口
    var wrong = el('a', CLS.link, '這條顯示錯了');
    wrong.addEventListener('click', function (e) {
      e.preventDefault();
      openReport({
        kind: 'wrong', name: art.law, flno: hit.flno || '', raw: hit.raw || '',
        title: art.title, url: art.url,
        shown: art.lines.map(function (l) { return l.text; }).join('\n').slice(0, 400)
      });
    });
    foot.appendChild(wrong);
    box.appendChild(foot);
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

    var foot = el('div', CLS.foot);
    var a = el('a', CLS.link, '在全國法規資料庫開啟');
    a.href = ex.url; a.target = '_blank'; a.rel = 'noopener';
    foot.appendChild(a);
    var cp = el('a', CLS.link, '複製解釋文');
    cp.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        navigator.clipboard.writeText(ex.title + '\n' + (ex.issue ? '爭點：' + ex.issue + '\n' : '') + ex.text);
        cp.textContent = '已複製';
        setTimeout(function () { cp.textContent = '複製解釋文'; }, 1500);
      } catch (err) { cp.textContent = '複製失敗'; }
    });
    foot.appendChild(cp);
    // 理由書通常很長，另開原站閱讀而非塞進面板
    if (ex.reason) {
      var rl = el('a', CLS.link, '理由書（' + Math.round(ex.reason.length / 100) / 10 + ' 千字）');
      rl.href = ex.url; rl.target = '_blank'; rl.rel = 'noopener';
      foot.appendChild(rl);
    }
    var wrong = el('a', CLS.link, '這則顯示錯了');
    wrong.addEventListener('click', function (e) {
      e.preventDefault();
      openReport({ kind: 'wrong', name: ex.title, url: ex.url,
        shown: ex.text.slice(0, 300) });
    });
    foot.appendChild(wrong);
    box.appendChild(foot);
  }

  /* 條號標題（第 N 條）的沿革面板。
   * 這是使用者最自然會滑過去的位置：想知道「這條改過沒有」時，
   * 視線本來就在條號上，不必先找到某個引用。 */
  function renderHistory(box, lawName, flno, h, rec) {
    box.appendChild(el('div', CLS.head, (lawName ? lawName + ' ' : '') + '第 ' + flno + ' 條　修正沿革'));
    var body = el('div', CLS.body);
    if (!rec.length) {
      body.appendChild(el('div', CLS.line, '沿革中未見此條的修正紀錄，可能自公布後未修正。'));
    } else {
      body.appendChild(el('div', CLS.line, '本條共修正 ' + rec.length + ' 次：'));
      rec.forEach(function (r) {
        var line = el('div', CLS.sub, '· ' + (r.when || r.text.slice(0, 46)) +
          (r.whole ? '（全文修正）' : ''));
        if (h.lyUrl) {
          var la = el('a', CLS.link, '當時條文');
          la.href = h.lyUrl;
          la.target = 'lawhover_ly'; la.rel = 'noopener';
          la.setAttribute('title', '在立法院法律系統查看當年條文與修法理由（另開視窗）');
          la.addEventListener('click', openLyWindow);
          line.appendChild(la);
        }
        body.appendChild(line);
      });
    }
    box.appendChild(body);

    var foot = el('div', CLS.foot);
    var a = el('a', CLS.link, '查看完整沿革');
    a.href = h.url; a.target = '_blank'; a.rel = 'noopener';
    foot.appendChild(a);
    if (h.lyUrl) {
      var l2 = el('a', CLS.link, '立法院法律系統');
      l2.href = h.lyUrl;
      l2.target = 'lawhover_ly'; l2.rel = 'noopener';
      l2.addEventListener('click', openLyWindow);
      foot.appendChild(l2);
    }
    box.appendChild(foot);
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
        a.addEventListener('click', function (e) { e.preventDefault(); openReport(report); });
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
      var txt = body();
      try {
        navigator.clipboard.writeText(txt);
        copy.textContent = '已複製 ✓';
      } catch (e) {
        diag.value = txt; diag.select(); copy.textContent = '請手動複製';
      }
      setTimeout(function () { copy.textContent = '複製內容'; }, 1800);
    });
    send.addEventListener('click', function () {
      var subj = '[法條懸停] ' + (kind === 'wrong' ? '資料顯示錯誤' : '沒有顯示資料');
      var href = 'mailto:' + REPORT_TO + '?subject=' + encodeURIComponent(subj) +
                 '&body=' + encodeURIComponent(body());
      // mailto 過長會被瀏覽器截斷，先確保內容已在剪貼簿
      try { navigator.clipboard.writeText(body()); } catch (e) {}
      if (href.length > 1900) {
        href = 'mailto:' + REPORT_TO + '?subject=' + encodeURIComponent(subj) +
               '&body=' + encodeURIComponent('內容較長，已複製到剪貼簿，請直接貼上（Ctrl+V）。\n\n');
      }
      window.open(href, '_blank');
      send.textContent = '已開啟郵件';
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
    var m = /pcode=([A-Z0-9]+)/i.exec(location.search);
    if (!m) return null;
    var el = document.querySelector('#hlLawName, #pnLawFla .h2, .table-list .h3');
    return { pcode: m[1], name: el ? el.textContent.trim() : '本法' };
  }
  var SELF = selfLaw();

  // 收集一段文字中的所有引用（具名優先，其餘位置再找裸條號）
  function collect(text) {
    var hits = [], m;
    RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
      var rawName = m[1] || m[2];
      var name = m[1] ? rawName : trimName(rawName);
      var tiao = cn2num(m[3]);
      if (!tiao || name.length < 2) continue;
      var drop = m[1] ? 0 : (rawName.length - name.length);
      // 「本法」「同法」等自指詞：指向當前頁面的法規，不必另行搜尋
      var isSelf = SELF_WORDS.indexOf(name) >= 0;
      if (isSelf && !SELF) continue;
      hits.push({
        start: m.index + drop, end: m.index + m[0].length,
        name: isSelf ? SELF.name : name, pcode: isSelf ? SELF.pcode : null,
        flno: m[4] ? tiao + '-' + cn2num(m[4]) : String(tiao),
        xiang: m[5] ? cn2num(m[5]) : null, kuan: m[6] ? cn2num(m[6]) : null
      });
    }
    if (SELF) {
      RE_SELF.lastIndex = 0;
      while ((m = RE_SELF.exec(text)) !== null) {
        var s0 = m.index, e0 = m.index + m[0].length;
        var covered = hits.some(function (h) { return s0 < h.end && e0 > h.start; });
        if (covered) continue;
        var t2 = cn2num(m[1]);
        if (!t2) continue;
        hits.push({
          start: s0, end: e0,
          name: SELF.name, pcode: SELF.pcode,
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
    var heads = document.querySelectorAll('.col-no');
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
      el0.setAttribute('title', '滑鼠移入查看本條的修正沿革');
      n++;
    }
    return n;
  }

  function scan(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || n.nodeValue.length < 6) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'A') return NodeFilter.FILTER_REJECT;
        if (p.dataset && (p.dataset.flno || p.dataset.ex)) return NodeFilter.FILTER_REJECT;
        if (panel.contains(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(markTextNode);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    // 條號標題：顯示沿革（可能滑到內部的 <a>，需往上找）
    var head = t;
    for (var d = 0; d < 3 && head; d++) {
      if (head.dataset && head.dataset.lhHead) break;
      head = head.parentElement;
    }
    if (head && head.dataset && head.dataset.lhHead) {
      var fl = head.dataset.lhHead;
      showPanel(head, function (box) { renderMsg(box, '查詢沿革…', '第 ' + fl + ' 條'); });
      fetchHistory(SELF.pcode)
        .then(function (h) {
          showPanel(head, function (box) {
            renderHistory(box, SELF.name, fl, h, historyFor(h, fl));
          });
        })
        .catch(function (err) {
          logErr('查不到沿革', '第' + fl + '條：' + err.message);
          showPanel(head, function (box) {
            renderMsg(box, '查不到沿革', err.message, {
              kind: 'missing', name: SELF.name, flno: fl, err: err.message
            });
          });
        });
      return;
    }
    if (!t.dataset || (!t.dataset.flno && !t.dataset.ex)) return;
    var hit = {
      xiang: t.dataset.xiang ? +t.dataset.xiang : null,
      kuan: t.dataset.kuan ? +t.dataset.kuan : null,
      flno: t.dataset.flno, raw: t.textContent
    };
    // 司法院解釋走另一條取文路徑
    if (t.dataset.ex) {
      showPanel(t, function (box) { renderMsg(box, '查詢中…', t.dataset.name); });
      fetchExplain(t.dataset.ex, t.dataset.exno, t.dataset.exyear)
        .then(function (ex) { showPanel(t, function (box) { renderExplain(box, ex); }); })
        .catch(function (err) {
          logErr('查不到解釋', t.dataset.name + '：' + err.message);
          showPanel(t, function (box) {
            renderMsg(box, '查不到這則解釋', err.message + '　（查不到比查錯安全）', {
              kind: 'missing', name: t.dataset.name, raw: t.textContent, err: err.message
            });
          });
        });
      return;
    }
    showPanel(t, function (box) { renderMsg(box, '查詢中…', t.dataset.name + ' 第 ' + t.dataset.flno + ' 條'); });
    (t.dataset.pcode ? Promise.resolve(t.dataset.pcode) : findPcode(t.dataset.name))
      .then(function (pc) { return fetchArticle(pc, t.dataset.flno); })
      .then(function (art) { showPanel(t, function (box) { renderArticle(box, art, hit); }); })
      .catch(function (err) {
        logErr('查不到條文', t.dataset.name + ' 第' + t.dataset.flno + '條：' + err.message);
        showPanel(t, function (box) {
          renderMsg(box, '查不到條文', err.message + '　（查不到比查錯安全）', {
            kind: 'missing', name: t.dataset.name, flno: t.dataset.flno,
            raw: t.textContent, err: err.message
          });
        });
      });
  }, true);

  document.addEventListener('mouseout', function (e) {
    var tt = e.target;
    if (tt.dataset && (tt.dataset.flno || tt.dataset.ex || tt.dataset.lhHead)) { scheduleHide(); return; }
    if (tt.parentElement && tt.parentElement.dataset && tt.parentElement.dataset.lhHead) scheduleHide();
  }, true);

  /* ---------- 啟動提示 ---------- */
  scan(document.body);
  var headCount = markArticleHeads();
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
    msg.appendChild(el('span', CLS.toastSub, '\u00a0\u00b7\u00a0滑過紅色虛線看條文' +
      (headCount ? '，滑過條號看沿革' : '')));
  } else if (headCount) {
    msg.appendChild(el('span', null, '已啟用，標記 '));
    msg.appendChild(el('span', CLS.toastNum, String(headCount)));
    msg.appendChild(el('span', null, ' 個條號'));
    msg.appendChild(el('span', CLS.toastSub, '\u00a0\u00b7\u00a0滑過條號看修正沿革'));
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
    toggle: function () { scan(document.body); markArticleHeads(); },
    count: function () { return count; }
  };
})();
