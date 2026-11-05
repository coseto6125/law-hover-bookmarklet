/* 法規名字典的品質稽核。
 *
 * 字典以「最長後綴匹配」判定法規名的左邊界。若字典收錄不全，短名會把
 * 更長的真實法規名吃掉而顯示錯誤法條（「查不到比查錯安全」的反例）：
 *   「依公教人員保險法」→ 字典只有「保險法」→ 取成「保險法」
 *   「觸犯監獄行刑法」  → 被「刑法」吃掉
 * 手寫的 100 部字典實測有 264 例這種切錯，改收錄官方完整清單後歸零。
 * 這支測試把該性質固定下來，避免日後為了縮短書籤而裁減字典。
 */
const { loadSource } = require('../build/source');
const { reporter } = require('./wait');
const { lawMarks } = require('./dom');

const report = reporter('法規名字典');
const { ok } = report;

const names = loadSource().names;

console.log('\n\x1b[1m字典基本性質\x1b[0m');
ok('收錄數量達官方規模（>1200 部）', names.length > 1200, '實際 ' + names.length + ' 部');
ok('無重複', new Set(names).size === names.length,
   '重複 ' + (names.length - new Set(names).size) + ' 筆');
ok('無空白或過短名稱', names.every(n => n.trim().length >= 2),
   JSON.stringify(names.filter(n => n.trim().length < 2).slice(0, 5)));
ok('已去除制定日註記', !names.some(n => /（[^）]*\d{2,3}\.\d{2}\.\d{2}[^）]*）/.test(n)),
   JSON.stringify(names.filter(n => /\d{2,3}\.\d{2}\.\d{2}/.test(n)).slice(0, 3)));

/* 核心性質：對每一部法規，套上常見的引用前綴後，最長後綴匹配都要還原出
 * 完整的原名，不能被字典裡某個較短的名稱截走。
 *
 * 注意：這個迴圈只是「字典資料」的檢查，用最簡單的最長後綴匹配驗證字典本身
 * 收錄完整（1300 多部 × 21 個前綴，逐一建 jsdom 頁面太慢）。它不代表出貨程式
 * 的行為；出貨的 matchKnown（含外國國名防護與 REAL_LAW_NAMES）由下方
 * 「實際引用句」與「地方法規」兩段，直接把原始碼注入 jsdom 頁面來驗證。 */
console.log('\n\x1b[1m最長匹配不被短名吃掉（全 ' + names.length + ' 部 × 常見前綴）\x1b[0m');
const PREFIXES = ['違反', '依', '依據', '按', '適用', '準用', '觸犯', '不受', '應受',
  '但應受', '參照', '援引', '詳見', '另見', '惟', '其', '並', '或', '及', '與', '暨'];

// 先按長度分組，避免 1344 × 21 × 1344 的三重迴圈
const byLen = names.slice().sort((a, b) => b.length - a.length);
const bad = [];
for (const n of names) {
  for (const p of PREFIXES) {
    const raw = p + n;
    let best = '';
    for (const k of byLen) { if (raw.endsWith(k)) { best = k; break; } }
    if (best !== n) bad.push(raw + ' → 得「' + best + '」應為「' + n + '」');
  }
}
ok('無任何一部法規被切錯', bad.length === 0,
   bad.length + ' 例，前 5：\n      ' + bad.slice(0, 5).join('\n      '));

console.log('\n\x1b[1m實際引用句\x1b[0m');
const CASES = [
  ['違反兒童及少年性剝削防制條例第三十一條', '兒童及少年性剝削防制條例'],
  ['依公教人員保險法第十二條', '公教人員保險法'],
  ['觸犯監獄行刑法第七十四條', '監獄行刑法'],
  ['適用金融消費者保護法第十條', '金融消費者保護法'],
  ['準用商業會計法第三十三條', '商業會計法'],
  ['依強制汽車責任保險法第七條', '強制汽車責任保險法'],
  ['承租人違反民法第四百四十三條', '民法']
];
/* 以出貨程式碼在 jsdom 頁面上標記，取第一個標記的法規名。 */
const nameOf = text => {
  const ms = lawMarks('測試法', 'X', '<p>' + text + '</p>');
  return ms.length ? ms[0].dataset.name : '';
};
for (const [text, want] of CASES) {
  const best = nameOf(text);
  ok('「' + text + '」→ ' + want, best === want, '實得「' + best + '」');
}

/* 地方法規（自治條例、自治規則）不在中央開放資料裡，本來就不會命中字典。
 * 要確認的是它們不會被某個中央法規的短名誤命中而顯示錯法條——
 * 未命中是安全的（回退字元規則），誤命中才會出錯。 */
console.log('\n\x1b[1m地方法規不被中央短名誤命中\x1b[0m');
const LOCAL = [
  '臺北市建築管理自治條例', '臺東縣議會組織自治條例',
  '桃園市土地使用分區管制自治條例', '高雄市停車場管理自治條例',
  '臺中市公園管理自治條例', '新北市河川管理自治條例'
];
for (const n of LOCAL) {
  const best = nameOf('違反' + n + '第一條規定');
  ok(n + ' 未被誤命中', best === '' || best === n, '誤命中「' + best + '」');
}

console.log('\n\x1b[1m字典產生器（build/gen-lawnames.js）\x1b[0m');
{
  const zlib = require('zlib');
  const { unzipFirstJson, sourceConsts } = require('../build/gen-lawnames');
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  /* 組一個 zip：entries = [{name, data, method, descriptor}]。descriptor 為真時模擬串流產生的
   * zip：旗標位元 3、本機標頭的大小為 0，真正的大小只在中央目錄與資料之後的 descriptor。 */
  function makeZip(entries) {
    const locals = [], central = [];
    let off = 0;
    for (const e of entries) {
      const raw = Buffer.from(e.data);
      const body = e.method === 8 ? zlib.deflateRawSync(raw) : raw;
      const name = Buffer.from(e.name);
      const flag = e.descriptor ? 8 : 0;
      const head = Buffer.concat([u32(0x04034b50), u16(20), u16(flag), u16(e.method), u16(0), u16(0), u32(0),
        u32(e.descriptor ? 0 : body.length), u32(e.descriptor ? 0 : raw.length), u16(name.length), u16(0), name]);
      const dd = e.descriptor ? Buffer.concat([u32(0x08074b50), u32(0), u32(body.length), u32(raw.length)]) : Buffer.alloc(0);
      const local = Buffer.concat([head, body, dd]);
      central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(flag), u16(e.method), u16(0), u16(0), u32(0),
        u32(body.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
      locals.push(local);
      off += local.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(cd.length), u32(off), u16(0)]);
    return Buffer.concat([...locals, cd, end]);
  }
  const json = '\uFEFF{"Laws":[{"LawName":"民法"}]}';
  const want = { Laws: [{ LawName: '民法' }] };
  const same = (zip) => { try { return JSON.stringify(unzipFirstJson(zip)) === JSON.stringify(want); } catch { return false; } };
  ok('zip：deflate、無 data descriptor', same(makeZip([{ name: 'a.json', data: json, method: 8 }])));
  ok('zip：deflate、有 data descriptor（本機標頭大小為 0）',
     same(makeZip([{ name: 'a.json', data: json, method: 8, descriptor: true }])));
  ok('zip：stored、有 data descriptor', same(makeZip([{ name: 'a.json', data: json, method: 0, descriptor: true }])));
  ok('zip：略過前面的非 JSON 檔', same(makeZip([{ name: 'readme.txt', data: 'x', method: 8, descriptor: true },
     { name: 'b.json', data: json, method: 8, descriptor: true }])));
  const throwsWith = (buf, re) => { try { unzipFirstJson(buf); return false; } catch (e) { return re.test(e.message); } };
  ok('zip：非 zip 內容（錯誤頁面）給出明確訊息', throwsWith(Buffer.from('<html>503</html>'), /不是有效的 zip/));
  ok('zip：空內容給出明確訊息', throwsWith(Buffer.alloc(0), /不是有效的 zip/));
  ok('zip：沒有 JSON 檔給出明確訊息', throwsWith(makeZip([{ name: 'a.txt', data: 'x', method: 8 }]), /找不到 JSON/));

  const { prefixes, edge } = sourceConsts();
  ok('PREFIX 讀自原始碼（含「前項」「本法依」）', prefixes.includes('前項') && prefixes.includes('本法依'));
  ok('HARD_EDGE 讀自原始碼：含標點與全形數字', edge.test('甲（乙）辦法') && edge.test('第１條') && edge.test('及'));
  ok('HARD_EDGE 為無狀態（連續 .test 結果一致）', edge.test('甲及乙') === edge.test('甲及乙') && !edge.global);
}

report.done();
