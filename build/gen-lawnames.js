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
const acorn = require('acorn');
const walk = require('acorn-walk');

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

/* 書籤剝除公文前綴的清單（PREFIX）與左邊界規則（HARD_EDGE）都直接從 src/lawhover.js 讀，
 * 不另外維護一份。用 acorn 依名稱找出宣告，連同它們依賴的 NUMC / NUM 一起求值。
 * HARD_EDGE 由 NUM 組成，不是字面量，所以要求值而不是只取字面量。 */
function sourceConsts() {
  const src = fs.readFileSync(SRC, 'utf8');
  const inits = new Map();
  walk.simple(acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script' }), {
    VariableDeclarator(n) {
      if (n.id.type === 'Identifier' && n.init) inits.set(n.id.name, src.slice(n.init.start, n.init.end));
    }
  });
  const order = ['NUMC', 'NUM', 'HARD_EDGE', 'PREFIX'];
  for (const k of order) if (!inits.has(k)) throw new Error('src/lawhover.js 找不到 ' + k + ' 宣告');
  const [prefixes, edge] = new Function(order.map(k => 'var ' + k + ' = ' + inits.get(k) + ';').join('\n') +
    '\nreturn [PREFIX, HARD_EDGE];')();
  if (!Array.isArray(prefixes) || !prefixes.length || !(edge instanceof RegExp)) {
    throw new Error('PREFIX 或 HARD_EDGE 的型別不符');
  }
  // 來源的 HARD_EDGE 帶 g 旗標（給 exec 迴圈用）；.test 會記住 lastIndex，這裡要無狀態的版本
  return { prefixes, edge: new RegExp(edge.source) };
}

/* 條文中每個「第」前面緊接的法規名，以及其中前一字是連接詞的。
 * 單次掃描全文，比逐一以名稱搜尋 2700 萬字快約 60 倍。 */
function citedNames(corpus, names) {
  const set = new Set(names);
  const lens = [...new Set(names.map(n => n.length))];
  const cited = new Set(), afterConj = new Set();
  for (let i = corpus.indexOf('第'); i >= 0; i = corpus.indexOf('第', i + 1)) {
    for (const len of lens) {
      if (len > i) continue;
      const n = corpus.slice(i - len, i);
      if (!set.has(n)) continue;
      cited.add(n);
      if ('及或與暨'.includes(corpus[i - len - 1])) afterConj.add(n);
    }
  }
  return { cited, afterConj };
}

async function main() {
  const [laws, orders] = await Promise.all([fetchLaws(LAW), fetchLaws(ORDER)]);
  /* 命令（辦法、規則等）約一萬部，全收會超過書籤長度上限，只收三種：
   * 1. 開頭剛好是公文前綴：沒有字典擋著，前綴規則會吃掉正式名稱的首字
   *   （「就業促進津貼實施辦法」被剝成「業促進津貼實施辦法」）。
   * 2. 條文中有被引用，且書籤的左邊界規則會切錯：
   *    名稱出現在「及／或／與／暨」後面，要靠字典認出連接詞右邊是一部完整法規
   *   （「申請取得戶籍資料或土地登記規則第二十四條之一」）；
   *    或名稱本身含有書籤當成邊界的字（src/lawhover.js 的 HARD_EDGE）
   *   （「認定標準及資格審查辦法」「高資產客戶適用之金融商品及服務管理辦法」）。 */
  const { prefixes, edge: EDGE } = sourceConsts();
  const corpus = laws.concat(orders).map(l => l.text).join('\n');
  const { cited, afterConj } = citedNames(corpus, orders.map(l => l.name));
  const picked = orders.map(l => l.name).filter(n =>
    prefixes.some(p => n.startsWith(p) && n.length - p.length >= 2) ||
    (cited.has(n) && (EDGE.test(n) || afterConj.has(n))) ||
    // 3. 名稱含「依」：別名定義會在句中最後一個「依」切開，要靠字典保護（全部約十部）
    n.includes('依'));
  const base = new Set(laws.map(l => l.name).concat(picked));
  /* 字典以最長後綴比對左邊界。收了短名就必須一併收結尾是它的正式全名，
   * 否則全名會被切成短名而指向另一部法規
   *（收了「復審文書使用收費標準」卻沒收「官兵權益保障會復審文書使用收費標準」）。 */
  const all = laws.concat(orders).map(l => l.name);
  const baseList = [...base];
  const longer = all.filter(n => !base.has(n) && baseList.some(k => n.length > k.length && n.endsWith(k)));
  const names = [...new Set([...base, ...longer])].sort();

  fs.writeFileSync(OUT, JSON.stringify(names));
  console.log('法規名字典：法律 ' + new Set(laws.map(l => l.name)).size + ' 部＋命令 ' +
              (names.length - new Set(laws.map(l => l.name)).size) + ' 部 → ' +
              path.relative(process.cwd(), OUT));
}

/* 極簡 zip 解析：官方 zip 只有幾個檔案，找出第一個 .json 用 raw deflate 解開，
 * 免得為了一次建置引入 zip 相依套件。
 * 從檔尾的中央目錄讀大小與位置，不讀本機標頭的大小：串流產生的 zip 會設 data descriptor
 * 旗標，本機標頭的大小是 0，真正的大小只在中央目錄裡。 */
function unzipFirstJson(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('下載內容不是有效的 zip（找不到中央目錄），可能是錯誤頁面或下載中斷');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip 中央目錄損毀');
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    if (!/\.json$/i.test(name)) continue;
    if (compSize === 0xffffffff || local === 0xffffffff) throw new Error('不支援 zip64');
    if (method !== 0 && method !== 8) throw new Error('不支援的 zip 壓縮方式：' + method);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + compSize);
    const out = method === 8 ? zlib.inflateRawSync(raw) : raw;
    return JSON.parse(out.toString('utf8').replace(/^\uFEFF/, ''));
  }
  throw new Error('zip 內找不到 JSON');
}

module.exports = { unzipFirstJson, sourceConsts };
if (require.main === module) {
  main().catch(e => { console.error('產生法規名字典失敗：' + e.message); process.exit(1); });
}
