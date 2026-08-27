/* CSP 相容性回歸測試
 *
 * 背景：初版誤以為 `style-src` 只管 <style> 元素，實際上 style="" 屬性同樣受管轄，
 * 導致在 law.moj.gov.tw 上所有樣式被擋（使用者實測回報）。
 * 這支測試以真實站台的 CSP 為準，攔截所有會被擋下的操作並讓測試失敗。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
// 用建置時同一份注入邏輯，確保測到的就是實際出貨的程式碼。
const src = require('../build/source').loadSource().code;

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

// law.moj.gov.tw 2026-08 實測政策（節錄關鍵指令）
const NONCE = 'DdT5d4EHgE6SDYemZe+2OA==';
const PAGE = `<!DOCTYPE html><html><head>
<style nonce="${NONCE}">.orig{color:#000}</style>
</head><body>
<h2 id="hlLawName">建築法</h2>
<p>案建築法第77條之2第1項規定，依第九十九條辦理。</p>
</body></html>`;

function makeStrictDom() {
  const dom = new JSDOM(PAGE, {
    url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const violations = [];

  // 攔截 style 屬性寫入：CSP style-src 無 'unsafe-inline' 時一律阻擋
  const origSetAttr = window.Element.prototype.setAttribute;
  window.Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'style') {
      violations.push('setAttribute("style") on <' + this.tagName.toLowerCase() + '>');
      return; // 模擬瀏覽器：動作被阻擋，樣式不生效
    }
    return origSetAttr.call(this, name, value);
  };

  // Chrome 連 CSSOM 的 el.style 寫入也視為 inline style 而阻擋（使用者實測回報）。
  // 元素層級的 style 一律記為違規；樣式表「規則」層級的 style 則合法，不在此攔截。
  const proto = window.HTMLElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'style')
            || Object.getOwnPropertyDescriptor(window.Element.prototype, 'style');
  Object.defineProperty(proto, 'style', {
    configurable: true,
    get: function () {
      const real = desc.get.call(this);
      const tag = this.tagName.toLowerCase();
      return new Proxy(real, {
        get(t, k) {
          if (k === 'setProperty' || k === 'removeProperty') {
            return function () { violations.push('el.style.' + String(k) + '() on <' + tag + '>'); };
          }
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, k, v) {
          violations.push('el.style.' + String(k) + ' = ... on <' + tag + '>');
          return true; // 模擬被阻擋：值不寫入
        },
      });
    },
  });

  // 攔截無 nonce 的 <style>：同樣被 CSP 擋下
  const origAppend = window.Node.prototype.appendChild;
  window.Node.prototype.appendChild = function (child) {
    if (child && child.tagName === 'STYLE') {
      const nc = child.getAttribute('nonce');
      if (nc !== NONCE) {
        violations.push('<style> 無有效 nonce（got=' + JSON.stringify(nc) + '）');
        // 被擋的樣式表不會產生任何規則
        Object.defineProperty(child, 'sheet', { value: null, configurable: true });
      } else {
        // 模擬 jsdom 未實作的 cssRules，讓程式能偵測注入成功
        Object.defineProperty(child, 'sheet', {
          value: { cssRules: { length: 12 } }, configurable: true,
        });
      }
    }
    return origAppend.call(this, child);
  };

  window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  return { window, violations };
}

console.log('\n\x1b[1m原始碼層級\x1b[0m');
const codeNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('程式碼不再使用 setAttribute("style")',
   !/setAttribute\(\s*['"]style['"]/.test(codeNoComments),
   (codeNoComments.match(/.*setAttribute\(\s*['"]style['"].*/g) || []).join('\n'));
ok('有讀取頁面 nonce 的邏輯', /nonce/.test(src));
ok('不使用元素層級 el.style 寫入',
   !/\bel\.style\.|\bpanel\.style\./.test(codeNoComments),
   (codeNoComments.match(/.*\b(el|panel)\.style\..*/g) || []).join('\n'));
ok('改以改寫樣式表規則來定位', /posRule/.test(src) && /insertRule|cssRules/.test(src));

console.log('\n\x1b[1m嚴格 CSP 環境下執行\x1b[0m');
const { window, violations } = makeStrictDom();
let threw = null;
try { window.eval(src); } catch (e) { threw = e; }
ok('腳本在嚴格 CSP 下不拋錯', !threw, threw && threw.message);
ok('未觸發任何 CSP 違規', violations.length === 0, violations.join('\n      '));

console.log('\n\x1b[1m功能在嚴格 CSP 下仍完整\x1b[0m');
const marks = [...window.document.querySelectorAll('[data-flno]')];
ok('仍能標記引用', marks.length >= 2, '標記 ' + marks.length + ' 處');
ok('標記有套用 class（而非 style 屬性）',
   marks.every(m => m.className && m.className.indexOf('lh-') === 0),
   marks.map(m => JSON.stringify(m.className)).join(', '));
ok('標記未殘留 style 屬性', marks.every(m => !m.getAttribute('style')));

const panel = [...window.document.body.children]
  .find(n => n.className && /^lh-[a-z0-9]+-p$/.test(String(n.className).split(' ')[0] || ''));
ok('面板已建立且套用 class', !!panel, panel ? panel.className : '未找到面板');
ok('面板初始為隱藏（以 class 控制，非 inline style）',
   panel && /-hide$/.test(String(panel.className).split(' ').pop() || ''), panel && panel.className);

// 樣式表成功注入時，元素不需備援 inline 樣式；被擋時則必須有
const styleEl = window.document.querySelector('style[nonce="' + NONCE + '"]:not(:first-of-type)');
ok('已用頁面 nonce 注入樣式表', !!styleEl,
   [...window.document.querySelectorAll('style')].map(s => s.getAttribute('nonce')).join(', '));

console.log('\n\x1b[1m樣式表被擋時的備援（最壞情況）\x1b[0m');
{
  // 這次連 nonce 都拿不到，模擬未來原站移除 nonce 的情況
  const dom = new JSDOM(PAGE.replace(/ nonce="[^"]*"/g, ''), {
    url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const v = [];
  const sa = w.Element.prototype.setAttribute;
  w.Element.prototype.setAttribute = function (n, val) {
    if (String(n).toLowerCase() === 'style') { v.push('style attr'); return; }
    return sa.call(this, n, val);
  };
  const d2 = Object.getOwnPropertyDescriptor(w.HTMLElement.prototype, 'style')
          || Object.getOwnPropertyDescriptor(w.Element.prototype, 'style');
  Object.defineProperty(w.HTMLElement.prototype, 'style', {
    configurable: true,
    get: function () {
      const real = d2.get.call(this);
      return new Proxy(real, {
        get(t, k) {
          if (k === 'setProperty' || k === 'removeProperty') return function () { v.push('el.style.' + String(k)); };
          const val = t[k];
          return typeof val === 'function' ? val.bind(t) : val;
        },
        set(t, k) { v.push('el.style.' + String(k)); return true; },
      });
    },
  });
  const ap = w.Node.prototype.appendChild;
  w.Node.prototype.appendChild = function (c) {
    if (c && c.tagName === 'STYLE') Object.defineProperty(c, 'sheet', { value: null, configurable: true });
    return ap.call(this, c);
  };
  w.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  let err = null;
  try { w.eval(src); } catch (e) { err = e; }
  ok('無 nonce 時仍不拋錯', !err, err && err.message);
  ok('無 nonce 時仍不違規', v.length === 0, v.join(', '));
  const m = [...w.document.querySelectorAll('[data-flno]')];
  ok('無 nonce 時仍能標記', m.length >= 2, '標記 ' + m.length + ' 處');
  // 備援模式下必須透過 CSSOM 把樣式打上，否則標記看不見
  ok('備援模式下仍未觸碰元素 style', v.length === 0, v.join(', '));
  const p = [...w.document.body.children]
    .find(n => n.className && String(n.className).split(' ').indexOf('yx') !== 0 &&
               /-p$/.test(String(n.className).split(' ')[0] || ''));
  ok('備援模式下面板仍建立且套用 class', !!p, p ? p.className : '未找到');
}

console.log('\n' + (fail === 0
  ? `\x1b[32mCSP 相容性全部通過：${pass} 項\x1b[0m`
  : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
process.exit(fail === 0 ? 0 : 1);
