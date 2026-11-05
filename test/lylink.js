/* 立法院版本連結：為何只連到版本清單，而不是直達某一版。
 *
 * 版本網址是 /lglawc/lawsingle?^{lyCode}{民國年月日}00^0…，前段內部識別碼
 * 可以留空，看起來只要把沿革日期填進去就能直達。實作後才發現不行：
 *
 *   立法院用「修正日」索引版本，全國法規資料庫的沿革只記載「公布日」。
 *   兩者無法互相推導，建築法 14 筆沿革的兩種日期「全部不同」，
 *   例如修正 92/05/06 對公布 92/06/05，修正 64/12/26 甚至對公布 65/01/08。
 *
 * 最危險的是立法院對不存在的日期不報錯，而是回一個標著該日期、內容卻是
 * 空的版本頁。用公布日組連結會 100% 落在空殼上，使用者看到標著「92年6月5日」
 * 的空頁面，只會以為那天的條文不存在——正是「顯示錯誤比查不到更危險」。
 *
 * 也試過在頁面內取回立法院的對照表來換算：fetch 被 CSP 的 connect-src 擋，
 * iframe 被對方的 frame-ancestors 擋，開放資料 API 不通。全量對照表約 249KB，
 * 遠超書籤 64000 字元的上限。
 *
 * 因此連到版本清單頁，並在提示裡標明公布日——清單頁每一版都是
 * 「修正日／公布日」上下並列，使用者拿公布日就找得到。
 */
const https = require('https');
const { constants } = require('crypto');
const { loadSource } = require('../build/source');
const { reporter, fetchRetry, UA } = require('./wait');

const report = reporter('立法院版本連結');
const { ok } = report;
const src = loadSource().code;

/* lis.ly.gov.tw 的 TLS 設定要求舊式重新協商，OpenSSL 3 預設拒絕
 * （ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED），內建 fetch 因此永遠連不上，
 * 這支測試的線上段落從沒真正跑過。只對這個測試開 SSL_OP_LEGACY_SERVER_CONNECT。 */
const lyFetch = (url, init) => new Promise((resolve, reject) => {
  const req = https.get(url, {
    secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    headers: init.headers, signal: init.signal,
  }, res => {
    const chunks = [];
    res.on('data', d => chunks.push(d));
    res.on('end', () => resolve({
      ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
      text: () => Promise.resolve(Buffer.concat(chunks).toString('utf8')),
    }));
    res.on('error', reject);
  });
  req.on('error', reject);
});

// 全部重試失敗回 null（呼叫端以 -1 / 空字串表示取不到）
const get = url => fetchRetry(url, { fetch: lyFetch, retryNotOk: false, map: r => r.text() }).catch(() => null);

async function main() {
  console.log('\n\x1b[1m程式碼不得用沿革日期組直達版本網址\x1b[0m');
  /* 沿革日期是公布日，拿它組 lawsingle?^code+日期 的網址一定落在空殼頁。
   * 這裡直接檢查程式碼裡沒有這種組法，避免日後有人「順手優化」又踩回去。 */
  ok('未組出 lawsingle 版本網址',
     !/lawsingle\?[^'"]*\^'\s*\+/.test(src) && !src.includes("'lglawc/lawsingle?^'"),
     '程式碼疑似在組直達網址');
  ok('立法院連結走官方轉址端點',
     src.includes('LawRedirect.ashx?CODE=') || src.includes('LawRedirectLY.aspx'),
     '找不到轉址端點');

  console.log('\n\x1b[1m線上佐證：公布日組出的網址是空殼\x1b[0m');
  try { await lyFetch('https://lis.ly.gov.tw/', { headers: UA }); }
  catch (e) {
    report.skip('線上驗證無法連線（' + e.message + '）');
    return report.done();
  }

  const V = d => 'https://lis.ly.gov.tw/lglawc/lawsingle?^01158' + d + '^00000000000';
  /* 建築法 92 年那次：修正 92/05/06、公布 92/06/05。
   * 取版本頁裡「全文」連結的內容長度，真版本有數千字，空殼只有一百餘字。 */
  async function bodyLen(dateCode) {
    const h = await get(V(dateCode));
    if (!h) return -1;
    const m = /href=([^\s>"']*lawsingle[^\s>"']*0000009000000[^\s>"']*)/.exec(h);
    if (!m) return 0;
    const full = await get('https://lis.ly.gov.tw' + m[1].replace(/^["']/, ''));
    return full ? full.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length : -1;
  }

  const fixed = await bodyLen('092050600');   // 修正日
  const pub = await bodyLen('092060500');     // 公布日
  const fake = await bodyLen('099123100');    // 捏造的日期

  /* 用相對差距判斷而非絕對字數：頁面含固定的框架文字，
   * 絕對門檻會隨對方改版而失準。真版本的條文量遠大於空殼。 */
  ok('修正日取得真實條文', fixed > 3000, '長度 ' + fixed);
  ok('公布日的內容明顯少於修正日（是空殼）',
     pub > 0 && fixed > pub * 2, '修正日 ' + fixed + ' vs 公布日 ' + pub);
  ok('捏造日期與公布日得到相同的空殼（系統不報錯，只是回空頁）',
     pub === fake, '公布日 ' + pub + ' vs 捏造 ' + fake);

  console.log('\n\x1b[1m兩種日期確實不同（故無法推導）\x1b[0m');
  const list = await get('https://lis.ly.gov.tw/lglawc/lawsingle?^01158^00000000000');
  const text = (list || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const pairs = [...text.matchAll(
    /中華民國(\d{2,3})年(\d{1,2})月(\d{1,2})日(?:制定|修正|全文修正)\s*中華民國(\d{2,3})年(\d{1,2})月(\d{1,2})日公布/g)];
  ok('取得修正日／公布日對照', pairs.length >= 10, '取得 ' + pairs.length + ' 筆');
  const same = pairs.filter(m => m[1] === m[4] && m[2] === m[5] && m[3] === m[6]);
  ok('兩種日期沒有一筆相同（不能拿公布日當修正日）',
     pairs.length > 0 && same.length === 0,
     same.length + ' 筆相同');

  report.done();
}

main().catch(e => { console.error(e); process.exit(1); });
