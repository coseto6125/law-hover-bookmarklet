/* 讀取書籤原始碼並注入法規名字典。
 * 建置與測試共用這一份，避免兩邊各自實作注入而測到的不是真正出貨的東西
 *（測試若直接讀 src/lawhover.js，字典會停在 '@@LAWNAMES@@' 佔位字串）。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadSource() {
  const code = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');
  const names = JSON.parse(fs.readFileSync(path.join(root, 'src/lawnames.json'), 'utf8'));
  if (!code.includes('@@LAWNAMES@@')) throw new Error('找不到 @@LAWNAMES@@ 佔位字串');
  return { code: code.replace('@@LAWNAMES@@', names.join('|')), names };
}

module.exports = { loadSource, root };
