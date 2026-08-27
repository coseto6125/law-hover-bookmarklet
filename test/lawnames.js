/* 法規名字典的品質稽核。
 *
 * 字典以「最長後綴匹配」判定法規名的左邊界。若字典收錄不全，短名會把
 * 更長的真實法規名吃掉而顯示錯誤法條（「查不到比查錯安全」的反例）：
 *   「依公教人員保險法」→ 字典只有「保險法」→ 取成「保險法」
 *   「觸犯監獄行刑法」  → 被「刑法」吃掉
 * 手寫的 100 部字典實測有 264 例這種切錯，改收錄官方完整清單後歸零。
 * 這支測試把該性質固定下來，避免日後為了縮短書籤而裁減字典。
 */
const fs = require('fs');
const path = require('path');
const { loadSource, root } = require('../build/source');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '\n      → ' + extra : '')); }
};

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
 * 完整的原名，不能被字典裡某個較短的名稱截走。 */
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
for (const [text, want] of CASES) {
  let best = '';
  for (const k of byLen) { if (text.replace(/第.*$/, '').endsWith(k)) { best = k; break; } }
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
  const raw = '違反' + n;
  let best = '';
  for (const k of byLen) { if (raw.endsWith(k)) { best = k; break; } }
  ok(n + ' 未被誤命中', best === '' || best === n, '誤命中「' + best + '」');
}

console.log(fail === 0
  ? '\n\x1b[32m法規名字典全部通過：' + pass + ' 項\x1b[0m'
  : '\n\x1b[31m通過 ' + pass + '，失敗 ' + fail + '\x1b[0m');
process.exit(fail === 0 ? 0 : 1);
