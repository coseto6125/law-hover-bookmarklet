/* 從全國法規資料庫的官方開放資料產生法規名字典。
 *
 * 為什麼需要完整清單而不是手寫幾十部常見法規：
 * 字典是用「最長後綴匹配」決定法規名的左邊界，若字典裡只有短名，
 * 短名會把更長的真實法規名吃掉而顯示錯誤法條。實測手寫的 100 部字典
 * 對官方 1346 部清單有 264 例切錯，例如：
 *   「依公教人員保險法」→ 字典只有「保險法」→ 取成「保險法」（錯法規）
 *   「監獄行刑法」→ 被「刑法」吃掉
 * 收錄完整清單後，最長匹配自然會選中正確的那一部。
 *
 * 用法：node build/gen-lawnames.js
 * 產出：src/lawnames.json（由 build.js 內嵌進書籤）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = 'https://law.moj.gov.tw/api/Ch/Law/JSON';
const OUT = path.join(__dirname, '..', 'src', 'lawnames.json');

async function main() {
  const buf = Buffer.from(await fetch(SRC, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  }).then(r => r.arrayBuffer()));

  // 端點回的是 zip，內含 ChLaw.json（UTF-8 with BOM）
  const json = unzipFirstJson(buf);
  const laws = json.Laws || json;

  const names = [...new Set(laws
    .map(l => (l.LawName || '').trim())
    // 括號中的制定日與新舊版註記不會出現在條文引用裡，去掉
    .map(n => n.replace(/（[^）]*(制定|\d{2,3}\.\d{2}\.\d{2})[^）]*）/g, '').trim())
    .filter(n => n.length >= 2))].sort();

  fs.writeFileSync(OUT, JSON.stringify(names));
  console.log('法規名字典：' + names.length + ' 部 → ' + path.relative(process.cwd(), OUT));
}

/* 極簡 zip 解析：官方 zip 只有幾個檔案，找出第一個 .json 用 raw deflate 解開，
 * 免得為了一次建置引入 zip 相依套件。 */
function unzipFirstJson(buf) {
  let pos = 0;
  while (pos < buf.length - 4) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) { pos++; continue; }
    const method = buf.readUInt16LE(pos + 8);
    const compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.slice(pos + 30, pos + 30 + nameLen).toString('utf8');
    const start = pos + 30 + nameLen + extraLen;
    if (/\.json$/i.test(name) && compSize > 0) {
      const raw = buf.slice(start, start + compSize);
      const out = method === 8 ? zlib.inflateRawSync(raw) : raw;
      return JSON.parse(out.toString('utf8').replace(/^\uFEFF/, ''));
    }
    pos = start + compSize;
  }
  throw new Error('zip 內找不到 JSON');
}

main().catch(e => { console.error('產生法規名字典失敗：' + e.message); process.exit(1); });
