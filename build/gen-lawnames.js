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

const LAW = 'https://law.moj.gov.tw/api/Ch/Law/JSON';
const ORDER = 'https://law.moj.gov.tw/api/Ch/Order/JSON';
const OUT = path.join(__dirname, '..', 'src', 'lawnames.json');
const SRC = path.join(__dirname, '..', 'src', 'lawhover.js');

async function fetchLaws(url) {
  const buf = Buffer.from(await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  }).then(r => r.arrayBuffer()));
  // 端點回的是 zip，內含 ChLaw.json / ChOrder.json（UTF-8 with BOM）
  const json = unzipFirstJson(buf);
  return (json.Laws || json).map(l => ({
    // 括號中的制定日與新舊版註記不會出現在條文引用裡，去掉
    name: (l.LawName || '').trim().replace(/（[^）]*(制定|\d{2,3}\.\d{2}\.\d{2})[^）]*）/g, '').trim(),
    text: (l.LawArticles || []).map(a => a.ArticleContent || '').join('').replace(/\s+/g, '')
  })).filter(l => l.name.length >= 2);
}

/* 書籤剝除公文前綴時用的清單（src/lawhover.js 的 PREFIX），直接從原始碼讀，
 * 不另外維護一份。 */
function prefixList() {
  const m = /var PREFIX = \[([\s\S]*?)\];/.exec(fs.readFileSync(SRC, 'utf8'));
  if (!m) throw new Error('src/lawhover.js 找不到 PREFIX');
  return m[1].match(/'[^']+'/g).map(q => q.slice(1, -1));
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  const laws = await fetchLaws(LAW);
  const orders = await fetchLaws(ORDER);
  /* 命令（辦法、規則等）約一萬部，全收會超過書籤長度上限，只收兩種：
   * 1. 開頭剛好是公文前綴：沒有字典擋著，前綴規則會吃掉正式名稱的首字
   *   （「就業促進津貼實施辦法」被剝成「業促進津貼實施辦法」）。
   * 2. 條文中有被引用，且書籤的左邊界規則會切錯：
   *    名稱出現在「及／或／與／暨」後面，要靠字典認出連接詞右邊是一部完整法規
   *   （「申請取得戶籍資料或土地登記規則第二十四條之一」）；
   *    或名稱本身含有書籤當成邊界的字（src/lawhover.js 的 HARD_EDGE）
   *   （「認定標準及資格審查辦法」「高資產客戶適用之金融商品及服務管理辦法」）。 */
  const prefixes = prefixList();
  const corpus = laws.concat(orders).map(l => l.text).join('\n');
  const EDGE = /及|或|與|暨|準用|適用|規定|所稱|依|按|第[0-9一二三四五六七八九十百千]+[條項款目]/;
  const picked = orders.map(l => l.name).filter(n =>
    prefixes.some(p => n.startsWith(p) && n.length - p.length >= 2) ||
    (corpus.includes(n + '第') &&
     (EDGE.test(n) || new RegExp('[及或與暨]' + escapeRe(n) + '第').test(corpus))));
  const base = new Set(laws.map(l => l.name).concat(picked));
  /* 字典以最長後綴比對左邊界。收了短名就必須一併收結尾是它的正式全名，
   * 否則全名會被切成短名而指向另一部法規
   *（收了「復審文書使用收費標準」卻沒收「官兵權益保障會復審文書使用收費標準」）。 */
  const all = laws.concat(orders).map(l => l.name);
  const longer = all.filter(n => !base.has(n) && [...base].some(k => n.length > k.length && n.endsWith(k)));
  const names = [...new Set([...base, ...longer])].sort();

  fs.writeFileSync(OUT, JSON.stringify(names));
  console.log('法規名字典：法律 ' + new Set(laws.map(l => l.name)).size + ' 部＋命令 ' +
              (names.length - new Set(laws.map(l => l.name)).size) + ' 部 → ' +
              path.relative(process.cwd(), OUT));
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
