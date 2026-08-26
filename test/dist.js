/* 驗證建置產物：dist/install.html 與 dist/lawhover.bookmarklet.txt
 * 使用者實際拿到的就是這兩個檔案，必須直接對它們驗證，而非只驗原始碼。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const D = f => fs.readFileSync(path.join(root, 'dist', f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '\n      → ' + extra : '')); }
};

const raw = D('lawhover.bookmarklet.txt');
const html = D('install.html');
const unescape = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');

console.log('\n\x1b[1mbookmarklet 產物\x1b[0m');
ok('以 javascript: 開頭', raw.startsWith('javascript:'));
ok('為單行（書籤網址不可含換行）', !/[\r\n]/.test(raw));
ok('不含裸單引號（避免破壞 href 屬性）', !raw.includes("'"));
ok('長度在瀏覽器書籤上限內', raw.length < 65000, raw.length + ' 字元');
let decoded;
try { decoded = decodeURIComponent(raw.slice('javascript:'.length)); ok('可正確 URL 解碼', true); }
catch (e) { ok('可正確 URL 解碼', false, e.message); }
try { new (require('vm').Script)(decoded); ok('解碼後為合法 JavaScript', true); }
catch (e) { ok('解碼後為合法 JavaScript', false, e.message); }
ok('未殘留區塊註解（壓縮生效）', !decoded.includes('/*'));

console.log('\n\x1b[1m安裝頁佔位符替換\x1b[0m');
ok('已無 __BOOKMARKLET__ 殘留', !html.includes('__BOOKMARKLET__'));

const dom = new JSDOM(html);
const doc = dom.window.document;
const drag = doc.querySelector('a.drag');
const ta = doc.querySelector('textarea');

ok('拖曳按鈕存在', !!drag);
ok('手動安裝 textarea 存在', !!ta);
// 由 DOM 取值可一併驗證 HTML 跳脫是否正確：跳脫錯誤會導致屬性被截斷
ok('拖曳按鈕 href 經瀏覽器解析後等於產物', drag && drag.getAttribute('href') === raw,
   drag ? '長度 ' + drag.getAttribute('href').length + ' vs ' + raw.length : '');
ok('textarea 內容經瀏覽器解析後等於產物', ta && ta.value === raw,
   ta ? JSON.stringify(ta.value.slice(0, 40)) : '');
ok('兩個安裝路徑內容一致', drag && ta && drag.getAttribute('href') === ta.value);

console.log('\n\x1b[1m安裝頁把關鍵事實講清楚\x1b[0m');
const text = doc.body.textContent;
ok('說明如何叫出書籤列', /Ctrl.*Shift.*B/s.test(text));
ok('明講每換一頁要重點一次', text.includes('每換一頁要重點一次'));
ok('說明貼上時 javascript: 會被移除', text.includes('javascript:') && text.includes('手動補上'));
ok('隱私：聲明零對外連線', text.includes('連線從未離開該網域'));
ok('隱私：聲明無開發者伺服器', text.includes('沒有屬於開發者的伺服器'));
ok('標示資料來源與免責', text.includes('全國法規資料庫') && text.includes('以官方網站為準'));
ok('提示公司鎖書籤列的情況', text.includes('公司鎖住書籤列'));

console.log('\n\x1b[1m產物實際可執行（以打包版跑真實頁面）\x1b[0m');
const page = fs.readFileSync(path.join(root, 'test/fixtures/lawall.html'), 'utf8');
const d2 = new JSDOM(page, {
  url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
  runScripts: 'outside-only', pretendToBeVisual: true,
});
let netCalls = 0;
d2.window.fetch = () => { netCalls++; return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }); };
d2.window.eval(decoded);
const marks = [...d2.window.document.querySelectorAll('[data-flno]')];
ok('打包版在真實建築法全文頁標記大量引用', marks.length >= 70, '標記 ' + marks.length + ' 處');
ok('裸條號自動綁定當前頁 pcode', marks.filter(m => m.dataset.pcode === 'D0070109').length >= 70,
   '自指 ' + marks.filter(m => m.dataset.pcode).length + ' 處');
ok('載入時不發出任何請求（僅 hover 才取文）', netCalls === 0, '請求數 ' + netCalls);
ok('未破壞原頁條文連結', d2.window.document.querySelectorAll('a[href*="LawSingle"]').length > 0);

console.log('\n' + (fail === 0
  ? `\x1b[32m建置產物驗證全部通過：${pass} 項\x1b[0m`
  : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
process.exit(fail === 0 ? 0 : 1);
