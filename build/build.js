#!/usr/bin/env node
/* 把 src/lawhover.js 壓成單行 javascript: URL，並產生安裝頁 install.html */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let code = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');

/* 壓縮。書籤網址有長度上限（Chrome 約 64KB），必須確實壓到夠小，
 * 否則新增功能時會無聲地被截斷。優先用 terser，失敗則退回保守做法。 */
let minified = false;
try {
  const { minify_sync } = require('terser');
  const r = minify_sync(code, {
    compress: { passes: 3, unsafe: true, drop_console: true },
    mangle: { toplevel: false },
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

const url = 'javascript:' + encodeURIComponent(code).replace(/'/g, '%27');
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
            (minified ? '（terser 壓縮）' : '（保守壓縮）') +
            '　餘裕 ' + (LIMIT - url.length) + ' 字元');
if (url.length > LIMIT) {
  console.error('錯誤：超過書籤長度上限 ' + LIMIT + '，瀏覽器會截斷導致完全失效');
  process.exit(1);
}
if (url.length > LIMIT * 0.9) console.warn('警告：已用掉 90% 額度，新增功能前需先精簡');
console.log('已產生 dist/ 與 docs/（GitHub Pages）');
