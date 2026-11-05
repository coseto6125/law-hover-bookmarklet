/* jsdom 離線頁面助手：把書籤（出貨的同一份原始碼）注入假頁面，回傳標記元素。
 *
 * 和 wait.js 分開，因為這裡需要 jsdom 與建置程式；wait.js 只做等待、回報與抓取，
 * 讓只跑 playwright 的測試不必載入 jsdom。
 */
const { JSDOM } = require('jsdom');
const { loadSource } = require('../build/source');

const code = loadSource().code;
const noNet = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });

/* 以不通的 fetch 架一個頁面並注入書籤，回傳 [data-flno] 標記。 */
function pageMarks(html, url) {
  const d = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  d.window.fetch = noNet;
  d.window.eval(code);
  return [...d.window.document.querySelectorAll('[data-flno]')];
}

/* 法規頁：標題為 law、pcode 為 pc，內文 html 接在標題之後。 */
const lawMarks = (law, pc, html) => pageMarks(
  '<body><h2 id="hlLawName">' + law + '</h2>' + html + '</body>',
  'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + pc);

module.exports = { pageMarks, lawMarks };
