/* 對線上 law.moj.gov.tw 的端到端驗證。
 * 前面的測試都用 fixture，這支直接打真實站台，確認實際運作。
 * 需要網路；離線時會明確報告而非假性通過。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const decoded = decodeURIComponent(
  fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8').slice('javascript:'.length)
);

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' };

// 在 jsdom 中架設一個真的會連線的 fetch，並記錄所有請求
function attachRealFetch(window, log) {
  window.fetch = function (u) {
    log.push(String(u));
    return globalThis.fetch(String(u), { headers: UA })
      .then(r => ({ ok: r.ok, status: r.status, text: () => r.text() }));
  };
}

function hover(window, mark, ms) {
  mark.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  return new Promise(r => setTimeout(r, ms || 6000));
}
function panelText(window) {
  const p = [...window.document.body.children].find(n => {
    const c = String(n.className || '').split(' ');
    return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(x => /-hide$/.test(x));
  });
  return p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
}

async function loadPage(url) {
  /* law.moj.gov.tw 偶發 ETIMEDOUT（IPv6 連線嘗試逾時），單次失敗會讓整支測試
   * 誤報為程式錯誤。重試三次以區分「真的壞了」與「網路抖一下」。 */
  let html = null, lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      html = await globalThis.fetch(url, { headers: UA }).then(r => r.text());
      break;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  if (html === null) throw lastErr;
  /* 維持 outside-only：dangerously 會連站台自己的 jQuery 等腳本一起跑，
   * 在 jsdom 下大量報錯而淹沒測試結果。 */
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  /* jsdom 沒有 DecompressionStream，載入器會判定環境不支援而 alert 後中止，
   * 整支測試因此測不到任何東西。補上 Node 內建的 zlib 版本讓解壓路徑照常運作。 */
  if (!dom.window.DecompressionStream) {
    const { DecompressionStream } = require('node:stream/web');
    dom.window.DecompressionStream = DecompressionStream;
  }
  // 載入器同樣用到 Response 來串接解壓；jsdom 也沒有。
  if (!dom.window.Response) dom.window.Response = globalThis.Response;
  // jsdom 的 Blob 沒有 stream()，載入器靠它接上 DecompressionStream。
  dom.window.Blob = globalThis.Blob;
  /* 載入器解壓後是用 appendChild 插入 inline script 來執行本體，
   * 而 outside-only 不會執行任何 script 元素。攔下這一次插入並自行 eval，
   * 就能只跑我們的程式、不跑站台的腳本。 */
  const head = dom.window.document.head;
  const origAppend = head.appendChild.bind(head);
  let ranBody = null;
  const bodyRan = new Promise(resolve => { ranBody = resolve; });
  head.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && node.textContent) {
      dom.window.eval(node.textContent);
      ranBody();
      return node;
    }
    return origAppend(node);
  };
  if (!dom.window.TextDecoder) dom.window.TextDecoder = globalThis.TextDecoder;
  const log = [];
  attachRealFetch(dom.window, log);
  dom.window.eval(decoded);
  /* 解壓是非同步的，eval(decoded) 只是啟動它。要等本體真的執行完才能
   * 檢查標記，否則永遠讀到 0 個。逾時就明講，不要假性通過。 */
  await Promise.race([
    bodyRan,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('書籤本體 5 秒內未執行')), 5000))
  ]);
  return { window: dom.window, log };
}

async function main() {
  try { await globalThis.fetch('https://law.moj.gov.tw/', { headers: UA }); }
  catch (e) { console.log('\x1b[33m略過：無法連線至 law.moj.gov.tw（' + e.message + '）\x1b[0m'); process.exit(0); }

  /* --- 情境一：建築法全文頁，裸條號取文 --- */
  console.log('\n\x1b[1m情境一 · 建築法全文頁（裸條號）\x1b[0m');
  const a = await loadPage('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109');
  const marksA = [...a.window.document.querySelectorAll('[data-flno]')];
  ok('標記大量交叉引用', marksA.length >= 70, '標記 ' + marksA.length + ' 處');
  /* 啟動時唯一允許的請求是本頁法規的沿革：paintHeads() 用它替條號標題上色
   * （修正過標黃）。條文一律等滑過才取，不預先抓。 */
  ok('注入後只取本頁沿革，未預取任何條文',
     a.log.every(u => u.includes('LawHistory.aspx?pcode=D0070109')),
     '請求：' + (a.log.join(', ') || '（無）'));

  const m3 = marksA.find(m => m.dataset.flno === '3' && m.dataset.pcode);
  await hover(a.window, m3);
  const t3 = panelText(a.window);
  ok('滑過「第三條」取回真實條文', !!t3 && t3.includes('本法適用地區如左'), (t3 || '（無面板）').slice(0, 70));
  ok('面板標題正確標示條號', !!t3 && /第\s*3\s*條/.test(t3), (t3 || '').slice(0, 30));
  // 允許重試造成的額外請求，但必須全部指向同一端點（未觸發搜尋）
  ok('免經搜尋（所有請求皆為取條文，無搜尋請求）',
     a.log.length >= 1 && !a.log.some(u => /LawSearchResult/.test(u)), a.log.join(' | '));
  // 條文請求排在啟動的沿革請求之後，故以「有沒有」判斷而非取第一筆。
  ok('請求確實指向該法規 pcode',
     a.log.some(u => u.includes('pcode=D0070109&flno=3')), a.log.join(', '));

  /* --- 情境二：跨法規具名引用（需搜尋 pcode） --- */
  console.log('\n\x1b[1m情境二 · 跨法規具名引用（土地法）\x1b[0m');
  const mLand = marksA.find(m => m.dataset.name === '土地法');
  ok('辨識到「不受土地法第二十五條」並剝除前綴', !!mLand,
     mLand ? mLand.dataset.name + ' ' + mLand.dataset.flno : '未找到');
  if (mLand) {
    const before = a.log.length;
    await hover(a.window, mLand, 9000);
    const tL = panelText(a.window);
    ok('經同源搜尋取得土地法條文', !!tL && tL.length > 40 && !tL.includes('查不到條文'),
       (tL || '（無面板）').slice(0, 90));
    ok('面板標示為土地法而非建築法', !!tL && tL.includes('土地法'), (tL || '').slice(0, 40));
    const added = a.log.slice(before);
    ok('先搜尋再取文（順序正確，允許重試）',
       added.length >= 2 && /LawSearchResult/.test(added[0]) &&
       added.some(u => /LawSingle/.test(u)), added.join(' | '));
  }

  /* --- 情境三：另一部法規，驗證非建築法專用 --- */
  console.log('\n\x1b[1m情境三 · 公寓大廈管理條例（換一部法規）\x1b[0m');
  const b = await loadPage('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070118');
  const marksB = [...b.window.document.querySelectorAll('[data-flno]')];
  ok('於另一部法規同樣標記引用', marksB.length >= 10, '標記 ' + marksB.length + ' 處');
  const selfB = marksB.filter(m => m.dataset.pcode === 'D0070118');
  ok('裸條號綁定該頁自己的 pcode（非寫死建築法）', selfB.length > 0, '自指 ' + selfB.length + ' 處');
  if (selfB.length) {
    await hover(b.window, selfB[0], 7000);
    const tB = panelText(b.window);
    ok('取回該法規條文成功', !!tB && !tB.includes('查不到條文'), (tB || '（無面板）').slice(0, 80));
  }

  /* --- 情境四：查不到時的行為 --- */
  console.log('\n\x1b[1m情境四 · 不存在的條號（查不到比查錯安全）\x1b[0m');
  const c = await loadPage('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109');
  const target = [...c.window.document.querySelectorAll('[data-flno]')].find(m => m.dataset.pcode);
  target.dataset.flno = '9999';
  await hover(c.window, target, 7000);
  const tc = panelText(c.window);
  ok('不存在的條號不顯示任何條文內容', !!tc && tc.includes('查不到'), (tc || '（無面板）').slice(0, 80));
  ok('並說明原因', !!tc && tc.includes('查不到比查錯安全'), (tc || '').slice(0, 90));

  /* --- 情境五：連線範圍（隱私主張） --- */
  console.log('\n\x1b[1m情境五 · 連線範圍（驗證隱私主張）\x1b[0m');
  const all = [].concat(a.log, b.log, c.log);
  ok('全程有實際連線發生', all.length > 0, '共 ' + all.length + ' 次');
  ok('所有請求皆為 law.moj.gov.tw 同源',
     all.every(u => u.startsWith('https://law.moj.gov.tw/')),
     all.filter(u => !u.startsWith('https://law.moj.gov.tw/')).join(', ') || '');
  ok('無任何開發者伺服器或第三方網域',
     !all.some(u => /vercel|herokuapp|cloudflare|analytics|googleapis/i.test(u)));

  console.log('\n' + (fail === 0
    ? `\x1b[32m線上端到端全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
