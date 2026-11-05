/* 讀取書籤原始碼並注入法規名字典。
 * 建置與測試共用這一份，避免兩邊各自實作注入而測到的不是真正出貨的東西
 *（測試若直接讀 src/lawhover.js，字典會停在 '@@LAWNAMES@@' 佔位字串）。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/* namesOverride：測試用，換掉 lawnames.json 的名單 */
function loadSource(namesOverride) {
  const code = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');
  const names = namesOverride || JSON.parse(fs.readFileSync(path.join(root, 'src/lawnames.json'), 'utf8'));
  /* 連引號一起換成 JSON 字串字面量：名稱裡的引號、反斜線、U+2028 不會破壞字面量。
   * 用函式替換，字串替換會把名稱裡的 $& 與 $` 展開。 */
  const placeholder = "'@@LAWNAMES@@'";
  if (!code.includes(placeholder)) throw new Error('找不到 ' + placeholder + ' 佔位字串（需以單引號包住）');
  return { code: code.replace(placeholder, () => JSON.stringify(names.join('|'))), names };
}

module.exports = { loadSource, root };
