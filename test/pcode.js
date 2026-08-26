/* 法規名稱 → pcode 對照的實測驗證
 *
 * 背景：此功能原先只在建築法與土地法兩部法規上驗過就標為 verified，
 * 實際擴大抽查後發現「刑法」「都市計畫法臺灣省施行細則」等會失敗。
 * 這支測試對多部法規實打線上搜尋，並驗證取回的 pcode 確實是該法規。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 對政府站台節流，並重試偶發的網路失敗（實測會出現 400 與 fetch failed）
let lastReq = 0;
async function politeFetch(url, tries) {
  tries = tries || 3;
  for (let i = 0; i < tries; i++) {
    const wait = 1200 - (Date.now() - lastReq);
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    try {
      const r = await globalThis.fetch(String(url), { headers: UA });
      if (r.ok) return r;
      if (i === tries - 1) return r;
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(1500 * (i + 1));
  }
}

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

// 期望值來自全國法規資料庫實際查證
const CASES = [
  { name: '建築法', pcode: 'D0070109', note: '完全相符（搜尋結果首筆是別部法規）' },
  { name: '土地法', pcode: 'D0060001', note: '完全相符' },
  { name: '消防法', pcode: 'D0120001', note: '完全相符' },
  { name: '民法', pcode: 'B0000001', note: '完全相符（首筆為別部法規）' },
  { name: '刑法', pcode: 'C0000001', note: '官方全名為「中華民國刑法」' },
  { name: '行政程序法', pcode: 'A0030055', note: '完全相符' },
  { name: '公寓大廈管理條例', pcode: 'D0070118', note: '完全相符' },
  { name: '都市計畫法', pcode: 'D0070001', note: '完全相符' },
  { name: '政府採購法', pcode: 'A0030057', note: '完全相符' },
  { name: '勞動基準法', pcode: 'N0030001', note: '完全相符（首筆為別部法規）' },
  { name: '個人資料保護法', pcode: 'I0050021', note: '完全相符' },
  { name: '區域計畫法', pcode: 'D0070030', note: '完全相符' },
  { name: '都市計畫法臺灣省施行細則', pcode: 'D0070012', note: '官方名稱帶括號註記' },
  { name: '建築技術規則建築設計施工編', pcode: 'D0070115', note: '以「編」結尾的分編法規' },
  { name: '水土保持法', pcode: 'M0110001', note: '完全相符' },
  { name: '空氣污染防制法', pcode: 'O0020001', note: '完全相符（首筆為別部法規）' },
  { name: '中華民國憲法', pcode: 'A0000001', note: '憲法（使用者實測回報）' },
  { name: '中華民國憲法增修條文', pcode: 'A0000002', note: '增修條文，需長字尾優先' },
];

// 必須「查不到」而非誤配到近似法規
const MUST_FAIL = [
  { name: '不存在的假法', why: '純虛構名稱' },
];

function makeEnv() {
  // 用一個與待測法規無關的頁面，強制走搜尋路徑而非本頁捷徑
  const dom = new JSDOM('<body><h2 id="hlLawName">職業安全衛生法</h2></body>', {
    url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0060001',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = u => politeFetch(u)
    .then(r => ({ ok: r.ok, status: r.status, text: () => r.text() }));
  w.eval(src);
  return w;
}

// 從腳本內部取出 findPcode：透過觸發 hover 走完整路徑
async function resolve(w, name) {
  const p = w.document.createElement('p');
  p.textContent = '依' + name + '第1條規定辦理。';
  w.document.body.appendChild(p);
  w.__lawhover__.toggle();
  const mark = [...w.document.querySelectorAll('[data-flno]')]
    .find(m => m.dataset.name === name && !m.dataset.pcode);
  if (!mark) return { err: '未標記或被誤判為本頁法規' };
  const seen = [];
  const orig = w.fetch;
  w.fetch = u => { seen.push(String(u)); return orig(u); };
  mark.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  await sleep(9000);
  const panel = [...w.document.body.children].find(n => {
    const c = String(n.className || '').split(' ');
    return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(x => /-hide$/.test(x));
  });
  const article = seen.find(u => /LawSingle/.test(u));
  const m = article && /pcode=([A-Z0-9]+)/i.exec(article);
  return {
    pcode: m ? m[1] : null,
    text: panel ? panel.textContent.replace(/\s+/g, ' ').trim() : '',
    requests: seen,
  };
}

async function main() {
  try { await globalThis.fetch('https://law.moj.gov.tw/', { headers: UA }); }
  catch (e) { console.log('\x1b[33m略過：無法連線（' + e.message + '）\x1b[0m'); process.exit(0); }

  console.log('\n\x1b[1m法規名稱 → pcode（線上實測 ' + CASES.length + ' 部）\x1b[0m');
  const w = makeEnv();
  for (const c of CASES) {
    const r = await resolve(w, c.name);
    const good = r.pcode === c.pcode;
    ok(c.name.padEnd(16) + ' → ' + c.pcode + '  (' + c.note + ')', good,
       r.err || ('實得 ' + r.pcode + '；面板：' + String(r.text).slice(0, 50)));
  }

  console.log('\n\x1b[1m取回的條文確實屬於該法規\x1b[0m');
  const w2 = makeEnv();
  for (const c of [CASES[4], CASES[12], CASES[3]]) {   // 刑法、細則、民法
    const r = await resolve(w2, c.name);
    const hasContent = r.text && !r.text.includes('查不到') && r.text.length > 30;
    ok(c.name + ' 取回真實條文', hasContent, String(r.text).slice(0, 70));
  }

  console.log('\n\x1b[1m查不到時不得誤配（查不到比查錯安全）\x1b[0m');
  const w3 = makeEnv();
  for (const c of MUST_FAIL) {
    const r = await resolve(w3, c.name);
    ok('「' + c.name + '」不應解析出任何 pcode（' + c.why + '）',
       !r.pcode, '誤配到 ' + r.pcode);
  }

  console.log('\n' + (fail === 0
    ? `\x1b[32mpcode 對照全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
