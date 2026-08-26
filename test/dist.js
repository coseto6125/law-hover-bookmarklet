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
const zlib = require('zlib');
const unescape = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');

console.log('\n\x1b[1mbookmarklet 產物\x1b[0m');
ok('以 javascript: 開頭', raw.startsWith('javascript:'));
ok('為單行（書籤網址不可含換行）', !/[\r\n]/.test(raw));
ok('不含裸單引號（避免破壞 href 屬性）', !raw.includes("'"));
// 超過上限瀏覽器會靜默截斷，書籤整個失效且難以察覺
ok('長度在瀏覽器書籤上限內', raw.length < 64000, raw.length + ' 字元');
ok('保有新增功能的餘裕（<90% 額度）', raw.length < 57600,
   raw.length + ' 字元，已用 ' + Math.round(raw.length / 640) + '%');
let loader, decoded;
try { loader = decodeURIComponent(raw.slice('javascript:'.length)); ok('可正確 URL 解碼', true); }
catch (e) { ok('可正確 URL 解碼', false, e.message); }
try { new (require('vm').Script)(loader); ok('載入器為合法 JavaScript', true); }
catch (e) { ok('載入器為合法 JavaScript', false, e.message); }

// 內容以 gzip + base64 內嵌，需解出來才能驗證
// base64url：'+'→'-'、'/'→'_'，避開網址轉義
const b64u = (loader.match(/atob\("([A-Za-z0-9\-_=]+)"/) || [])[1];
const b64 = b64u && b64u.replace(/-/g, '+').replace(/_/g, '/');
ok('內嵌 gzip base64url 內容', !!b64, b64 ? b64.length + ' 字元' : '未找到');
ok('使用 base64url（網址中免轉義）',
   !!b64u && !/[+/]/.test(b64u) && !raw.includes('%2B'), '仍有 %2B 轉義');
if (b64) {
  try {
    decoded = zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
    ok('gzip 內容可解壓', decoded.length > 10000, decoded.length + ' 字元');
    new (require('vm').Script)(decoded);
    ok('解壓後為合法 JavaScript', true);
  } catch (e) { ok('gzip 內容可解壓', false, e.message); decoded = ''; }
  ok('未殘留區塊註解（壓縮生效）', !decoded.includes('/*'));
  ok('確實經過壓縮（無多餘縮排）', !/\n\s{4,}/.test(decoded));
  // 壓縮率不如預期代表壓縮沒生效，會悄悄逼近長度上限
  // 與「未壓縮時的 URL 編碼長度」相比才是實際省下的量
  const plainLen = encodeURIComponent(decoded).replace(/'/g, '%27').length;
  ok('gzip 顯著縮短網址（<40%）', raw.length < plainLen * 0.4,
     raw.length + ' vs 未壓縮 ' + plainLen + ' = ' + Math.round(raw.length / plainLen * 100) + '%');
}
ok('用 blob script 而非 eval 執行', /createObjectURL/.test(loader) && !/\beval\(/.test(loader));
ok('舊瀏覽器有明確提示', /DecompressionStream/.test(loader) && /瀏覽器版本過舊/.test(loader));
ok('用完釋放 blob 網址（避免記憶體洩漏）', /revokeObjectURL/.test(loader));

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
ok("提示公司鎖書籤列的情況", text.includes("書籤列鎖住") || text.includes("公司把書籤列鎖住"));
ok('標明概念源自引線且非衍生作品', text.includes('引線') && text.includes('不是引線的移植或衍生'));
ok('指出能裝擴充功能者應直接用引線', text.includes('請直接用引線'));
ok('提供原始碼連結', html.includes('github.com/coseto6125/law-hover-bookmarklet'));
ok('提供回報 email', html.includes('enor@e-life-ai.com'));
ok('說明兩階段回報類型',
   text.includes('沒有顯示資料') && text.includes('資料顯示錯誤'));
ok('說明不需截圖', text.includes('不必截圖'));
ok('說明回報不含公文內容', text.includes('不含你正在瀏覽的公文'));
ok('宣告 favicon（供瀏覽器分頁與書籤頁使用）',
   /<link[^>]+rel="icon"[^>]+icon\.svg/.test(html) && html.includes('favicon.ico'));
// 先前誤稱書籤會帶圖示，實測 Chrome 以頁面 URL 對應 favicon，
// javascript: 書籤沒有 URL 故永遠無圖示，說明必須誠實
ok('未誤稱書籤會帶圖示', !text.includes('會帶著這個圖示一起過去'));
ok('說明書籤無圖示是瀏覽器設計', text.includes('這是瀏覽器的設計'));
ok('疑難排解改為折疊式', (html.match(/<details class="qa"/g) || []).length >= 6,
   '折疊項數 ' + (html.match(/<details class="qa"/g) || []).length);

console.log('\n\x1b[1m安裝頁自身的 CSP（不可擋掉自己）\x1b[0m');
{
  const hdr = fs.readFileSync(path.join(root, 'docs/_headers'), 'utf8');
  const csp = (hdr.match(/Content-Security-Policy: (.+)/) || [])[1] || '';
  ok('_headers 有設定 CSP', !!csp, hdr.slice(0, 80));
  // 安裝頁的互動是 inline script，CSP 必須放行，否則頁面功能全失效
  ok('放行 inline script（否則範例與引導動畫失效）',
     /script-src[^;]*'unsafe-inline'/.test(csp), csp);
  ok('放行 inline style', /style-src[^;]*'unsafe-inline'/.test(csp));
  ok('放行 Google Fonts', /fonts\.googleapis\.com/.test(csp) && /fonts\.gstatic\.com/.test(csp));
  ok('允許自身圖示', /img-src[^;]*'self'/.test(csp));
  ok('禁止外部連線（安裝頁不需要）', /connect-src 'none'/.test(csp), csp);
  ok('禁止被嵌入 iframe', /frame-ancestors 'none'/.test(csp));
}

console.log('\n\x1b[1m安裝頁素材齊備\x1b[0m');
{
  for (const f of ['icon.svg', 'icon-16.png', 'icon-32.png', 'icon-180.png',
                   'icon-192.png', 'icon-512.png', 'favicon.ico', 'manifest.webmanifest']) {
    ok('docs/' + f + ' 存在', fs.existsSync(path.join(root, 'docs', f)));
  }
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'docs/manifest.webmanifest'), 'utf8'));
  ok('manifest 名稱與主題色正確', mf.short_name === '法條懸停' && mf.theme_color === '#9c2b2b',
     JSON.stringify({ n: mf.short_name, c: mf.theme_color }));
}

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
// 條號上色需要沿革，故啟動時會取一次沿革（僅此一次，不逐條查詢）
ok('載入時最多只取一次沿革', netCalls <= 1, '請求數 ' + netCalls);
ok('未破壞原頁條文連結', d2.window.document.querySelectorAll('a[href*="LawSingle"]').length > 0);

console.log('\n' + (fail === 0
  ? `\x1b[32m建置產物驗證全部通過：${pass} 項\x1b[0m`
  : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
process.exit(fail === 0 ? 0 : 1);
