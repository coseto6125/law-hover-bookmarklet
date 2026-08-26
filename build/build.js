#!/usr/bin/env node
/* 把 src/lawhover.js 壓成單行 javascript: URL，並產生安裝頁 install.html */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let code = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');

// 保守壓縮：移除註解與行首縮排，保留字串內容
code = code
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .split('\n')
  .map(l => l.replace(/\s+\/\/[^'"`]*$/, '').trim())
  .filter(Boolean)
  .join('\n');

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

console.log('bookmarklet 長度：' + url.length + ' 字元');
if (url.length > 65000) console.warn('警告：超過部分瀏覽器書籤長度上限');
console.log('已產生 dist/ 與 docs/（GitHub Pages）');
