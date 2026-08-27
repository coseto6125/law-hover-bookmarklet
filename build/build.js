#!/usr/bin/env node
/* 把 src/lawhover.js 壓成單行 javascript: URL，並產生安裝頁 install.html */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.join(__dirname, '..');

const { loadSource } = require('./source');
const loaded = loadSource();
let code = loaded.code;
console.log('內嵌法規名字典：' + loaded.names.length + ' 部');

/* 壓縮。書籤網址有長度上限（Chrome 約 64KB），必須確實壓到夠小，
 * 否則新增功能時會無聲地被截斷。優先用 terser，失敗則退回保守做法。 */
let minified = false;
try {
  const { minify_sync } = require('terser');
  const r = minify_sync(code, {
    compress: {
      passes: 4, unsafe: true, unsafe_arrows: true, unsafe_methods: true,
      drop_console: true, booleans_as_integers: true, hoist_funs: true,
      pure_getters: true, toplevel: true,
    },
    // toplevel mangle 可再省一成，IIFE 內無外部引用故安全
    mangle: { toplevel: true, properties: false },
    format: { comments: false, ascii_only: false },
  });
  if (r && r.code) { code = r.code; minified = true; }
} catch (e) {
  console.warn('terser 不可用，改用保守壓縮：' + e.message);
}
if (!minified) {
  code = code
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .split('\n')
    .map(l => l.replace(/\s+\/\/[^'"`]*$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/* 書籤網址的編碼方式。
 *
 * encodeURIComponent 對中文每字要 9 個字元（%E5%BB%BA），本專案中文佔約
 * 兩成，導致體積膨脹 1.8 倍。改為 gzip + base64，載入時由瀏覽器原生的
 * DecompressionStream 解壓，再以 blob script 執行。
 *
 * 為何 blob script 能通過 CSP：目標站台的 script-src 含 'strict-dynamic'，
 * 由已信任的腳本動態插入的 script 會被一併信任（實測確認 blob、eval、
 * new Function、import(blob) 在 law.moj.gov.tw 上皆可用，零 CSP 違規）。
 * 用 blob script 而非 eval，是因為它最不依賴 unsafe-eval。
 *
 * 實測：54907 → 18092 字元（省 67%），解壓加執行 22ms。
 * 若瀏覽器不支援 DecompressionStream，載入器會退回未壓縮版本。 */
const plain = encodeURIComponent(code).replace(/'/g, '%27');
/* base64 的 '+' 在網址中要轉義成 %2B（3 倍長度），實測有 273 個。
 * 改用 base64url（'+'→'-'、'/'→'_'），完全避開轉義，解碼時再換回來。 */
const gz = zlib.gzipSync(Buffer.from(code, 'utf8'), { level: 9 })
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
/* 降級：不內嵌未壓縮版本（那會讓網址反而變長），改為明確告知。
 * DecompressionStream 自 Chrome 80 / Firefox 113 / Safari 16.4 起支援，
 * 2020 年後的瀏覽器都有；真的太舊時給出可行動的訊息而非靜默失敗。 */
const loader =
  'javascript:(function(){' +
  'if(!window.DecompressionStream){alert("你的瀏覽器版本過舊，請更新瀏覽器後再試。");return}' +
  // 用字元碼組出 '+' 與 '/'，避免字面量本身又被網址轉義
  'var P=String.fromCharCode(43),S=String.fromCharCode(47);' +
  'var b=atob("' + gz + '".split("-").join(P).split("_").join(S)),n=b.length,u=new Uint8Array(n);' +
  // 倒數迴圈：避開 '+' 被轉義成 %2B（i++ 與 i+=1 皆會）
  'for(var i=n;i--;)u[i]=b.charCodeAt(i);' +
  'new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text()' +
  /* 執行方式：用 inline script（textContent）而非 blob script。
   * 各站 CSP 不同，實測：
   *   law.moj.gov.tw  script-src 有 'strict-dynamic' → blob 與 inline 皆可
   *   laws.gov.taipei script-src 'self' 'unsafe-inline' → blob 被擋，inline 可用
   * inline script 由 javascript: 書籤（已豁免 CSP）建立，兩者皆通過。 */
  '.then(function(t){var s=document.createElement("script");' +
  's.textContent=t;document.head.appendChild(s);s.remove()})})()';
// javascript: 網址中需轉義的字元
const url = loader.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F')
                  .replace(/&/g, '%26').replace(/'/g, '%27').replace(/ /g, '%20')
                  .replace(/\+/g, '%2B');
fs.writeFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), url);

const tpl = fs.readFileSync(path.join(root, 'src/install.tpl.html'), 'utf8');
// 注意：兩處佔位符（拖曳按鈕的 href、手動安裝用的 textarea）都要替換，
// 用 split/join 而非 replace，後者只會換掉第一個。
const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const out = tpl.split('__BOOKMARKLET__').join(escaped);
if (out.indexOf('__BOOKMARKLET__') >= 0) throw new Error('佔位符未完全替換');
fs.writeFileSync(path.join(root, 'dist/install.html'), out);

// 同步輸出到 docs/ 供 GitHub Pages 直接提供安裝頁
const docs = path.join(root, 'docs');
if (!fs.existsSync(docs)) fs.mkdirSync(docs);
fs.writeFileSync(path.join(docs, 'index.html'), out);
fs.writeFileSync(path.join(docs, 'lawhover.bookmarklet.txt'), url);
// 停用 Jekyll 處理，安裝頁是靜態 HTML，不需要也不應被處理
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
// 靜態素材（favicon、manifest）複製到輸出目錄。
// favicon 是必要的：拖曳書籤時，瀏覽器以來源頁面的 favicon 作為書籤圖示。
const assets = path.join(root, 'src/assets');
for (const f of fs.readdirSync(assets)) {
  fs.copyFileSync(path.join(assets, f), path.join(docs, f));
  fs.copyFileSync(path.join(assets, f), path.join(root, 'dist', f));
}

// Cloudflare Pages 標頭設定（GitHub Pages 會忽略此檔）
fs.writeFileSync(path.join(docs, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  // 安裝頁的互動（範例懸停、引導動畫）是 inline script，必須放行，
  // 否則頁面會被自己的 CSP 擋掉。仍禁止載入任何外部程式碼。
  "  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; manifest-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  '',
  '/*.png',
  '  Cache-Control: public, max-age=604800',
  '',
  '/*.svg',
  '  Cache-Control: public, max-age=604800',
  '',
  '/*.ico',
  '  Cache-Control: public, max-age=604800',
  ''
].join('\n'));

const LIMIT = 64000;   // Chrome 書籤網址實測上限約 64KB
console.log('bookmarklet 長度：' + url.length + ' 字元' +
            (minified ? '（terser + gzip）' : '（保守壓縮 + gzip）') +
            '　餘裕 ' + (LIMIT - url.length) + ' 字元' +
            '　未壓縮為 ' + plain.length + ' 字元');
if (url.length > LIMIT) {
  console.error('錯誤：超過書籤長度上限 ' + LIMIT + '，瀏覽器會截斷導致完全失效');
  process.exit(1);
}
if (url.length > LIMIT * 0.9) console.warn('警告：已用掉 90% 額度，新增功能前需先精簡');
console.log('已產生 dist/ 與 docs/（GitHub Pages）');
