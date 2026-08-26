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
  // 法規名稱可能的結尾字。「編」用於「建築技術規則建築設計施工編」這類分編法規。
  var SUFFIX = '(?:自治條例|自治規則|條例|規則|辦法|標準|細則|準則|通則|規程|規範|要點|基準|編|法)';
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

  // 常見黏在法規名前的公文用字，需剝除（「案建築法」→「建築法」）
  var PREFIX = ['前項', '前二項', '前三項', '前條', '前款', '本項', '各該', '上開',
                '另依', '另按', '復依', '爰按', '茲按', '另', '復', '爰', '茲',
                '依據', '按照', '違反', '有關', '案內', '參照', '準用', '適用', '依照', '茲依',
                '不受', '不適用', '未依', '得依', '應依', '亦同', '所稱', '規定', '準此',
                '依', '按', '案', '及', '與', '或', '暨', '之', '為', '該', '本', '同',
                '前開', '前揭', '所定', '規定', '爰依', '查', '據', '以', '因', '就', '對',
                '參', '如', '至', '而', '並', '且', '惟', '但', '故', '則', '乃', '係'];
  function trimName(name) {
    var changed = true;
    while (changed && name.length > 2) {
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
      var res = { title: title, law: lawName.trim(), lines: lines, url: url };
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
    hide: PFX + 'hide'
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
    '.' + CLS.toast + '{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#1f2937;' +
      'color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);' +
      'font:13px system-ui,"Microsoft JhengHei",sans-serif}'
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
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) el.classList.add(arguments[i]);
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
    box.appendChild(foot);
  }

  function renderMsg(box, msg, sub) {
    box.appendChild(el('div', CLS.err, msg));
    if (sub) box.appendChild(el('div', CLS.note, sub));
  }

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
    if (text.indexOf('條') < 0) return;
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

  function scan(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || n.nodeValue.length < 6) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'A') return NodeFilter.FILTER_REJECT;
        if (p.dataset && p.dataset.flno) return NodeFilter.FILTER_REJECT;
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
    if (!t.dataset || !t.dataset.flno) return;
    var hit = { xiang: t.dataset.xiang ? +t.dataset.xiang : null, kuan: t.dataset.kuan ? +t.dataset.kuan : null };
    showPanel(t, function (box) { renderMsg(box, '查詢中…', t.dataset.name + ' 第 ' + t.dataset.flno + ' 條'); });
    (t.dataset.pcode ? Promise.resolve(t.dataset.pcode) : findPcode(t.dataset.name))
      .then(function (pc) { return fetchArticle(pc, t.dataset.flno); })
      .then(function (art) { showPanel(t, function (box) { renderArticle(box, art, hit); }); })
      .catch(function (err) {
        showPanel(t, function (box) {
          renderMsg(box, '查不到條文', err.message + '　（查不到比查錯安全）');
        });
      });
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (e.target.dataset && e.target.dataset.flno) scheduleHide();
  }, true);

  /* ---------- 啟動提示 ---------- */
  scan(document.body);
  var toast = el('div', CLS.toast, '法條懸停已啟用 · 標記 ' + count + ' 處引用');
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 2600);

  window.__lawhover__ = {
    toggle: function () { scan(document.body); },
    count: function () { return count; }
  };
})();
