/* 用 jsdom + 真實頁面 fixture 驗證 bookmarklet 端到端行為 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const F = f => fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8');
const code = fs.readFileSync(path.join(root, 'src/lawhover.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '\n      → ' + extra : '')); }
};

// 假的同源 fetch：把 URL 對應到 fixture
const routes = [
  [/LawSingle\.aspx.*flno=77-2/, 'single-77-2.html'],
  [/LawSearchResult\.aspx.*kw=/, 'search-jianzhufa.html'],
];
const calls = [];
function makeFetch() {
  return (url) => {
    calls.push(url);
    for (const [re, f] of routes) {
      if (re.test(decodeURIComponent(url)) || re.test(url)) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(F(f)) });
      }
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  };
}

const PAGE = `<!DOCTYPE html><html><body>
<h2 id="hlLawName">建築法</h2>
<div id="doc">
<p>二、案建築法第77條之2第1項規定，供公眾使用建築物之室內裝修應由開業建築師設計。</p>
<p>另依「都市計畫法臺灣省施行細則」第三十四條之三第二項辦理。</p>
<p>違反建築法第七十七條之二第１項及消防法第9條規定者，依法處理。</p>
<p>公寓大廈管理條例第56條第3項第2款參照。</p>
<p>本段沒有任何法條引用，不應被標記。</p>
<p>前項不受土地法第二十五條之限制。</p>
<p>依第九十九條規定辦理，並準用本法第五條。</p>
<p>另依建築技術規則建築設計施工編第167條之1辦理。</p>
<p>本法依中華民國憲法第一百十八條及中華民國憲法增修條文第九條第一項制定之。</p>
<p>參照司法院釋字第748號解釋及大法官釋字第603號意旨，並依115年憲判字第6號判決。另釋字第三十二號亦同。</p>
<a href="#">建築法第5條</a>
<script>var x = "建築法第9條";</script>
</div></body></html>`;

async function run() {
  const dom = new JSDOM(PAGE, {
    url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.fetch = makeFetch();
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => {} }, configurable: true });

  window.eval(code);

  console.log('\n\x1b[1m掃描與標記\x1b[0m');
  const marks = [...window.document.querySelectorAll('[data-flno],[data-ex]')];
  ok('有標記到引用', marks.length > 0, '標記數=' + marks.length);
  ok('標記 15 處引用', marks.length === 15,
     '實際 ' + marks.length + ' 處：' + marks.map(m => m.textContent).join(' / '));

  const byText = t => marks.find(m => m.textContent.includes(t));

  console.log('\n\x1b[1m條號解析\x1b[0m');
  const m1 = byText('建築法第77條之2');
  ok('阿拉伯數字 + 之X → flno=77-2', m1 && m1.dataset.flno === '77-2', m1 && m1.dataset.flno);
  ok('剝除前綴「案」→ 法規名=建築法', m1 && m1.dataset.name === '建築法', m1 && m1.dataset.name);
  ok('標記文字不含「案」', m1 && !m1.textContent.startsWith('案'), m1 && JSON.stringify(m1.textContent));
  ok('取得項次 xiang=1', m1 && m1.dataset.xiang === '1', m1 && m1.dataset.xiang);

  const m2 = byText('都市計畫法臺灣省施行細則');
  ok('引號法規名 + 中文數字 → flno=34-3', m2 && m2.dataset.flno === '34-3', m2 && m2.dataset.flno);
  ok('中文數字項次 第二項 → 2', m2 && m2.dataset.xiang === '2', m2 && m2.dataset.xiang);

  const m3 = byText('第七十七條之二');
  ok('中文數字 七十七 → 77-2', m3 && m3.dataset.flno === '77-2', m3 && m3.dataset.flno);
  ok('全形數字 第１項 → 1', m3 && m3.dataset.xiang === '1', m3 && m3.dataset.xiang);
  ok('剝除前綴「違反」', m3 && m3.dataset.name === '建築法', m3 && m3.dataset.name);

  const m4 = byText('公寓大廈管理條例');
  ok('項 + 款 解析', m4 && m4.dataset.xiang === '3' && m4.dataset.kuan === '2',
     m4 && (m4.dataset.xiang + '/' + m4.dataset.kuan));

  console.log('\n\x1b[1m裸條號（指向當前頁面法規）\x1b[0m');
  const bare = marks.filter(m => m.dataset.pcode);
  ok('有辨識裸條號', bare.length >= 2, '數量=' + bare.length);
  const b99 = byText('第九十九條');
  ok('「依第九十九條」→ 建築法 99', b99 && b99.dataset.flno === '99' && b99.dataset.name === '建築法',
     b99 && (b99.dataset.name + ' ' + b99.dataset.flno));
  ok('裸條號帶當前頁 pcode（免搜尋）', b99 && b99.dataset.pcode === 'D0070109', b99 && b99.dataset.pcode);
  const b5 = byText('本法第五條');
  ok('「本法第五條」→ 建築法 5', b5 && b5.dataset.flno === '5', b5 && b5.dataset.flno);
  const b25 = byText('土地法第二十五條');
  ok('剝除前綴「不受」→ 土地法', b25 && b25.dataset.name === '土地法', b25 && b25.dataset.name);
  ok('具名引用不被裸條號規則吃掉', b25 && !b25.dataset.pcode, b25 && b25.dataset.pcode);

  const mBian = byText('建築技術規則建築設計施工編');
  ok('以「編」結尾的分編法規（法條懸停（另一套 Chrome 擴充功能）官網列為支援）', !!mBian && mBian.dataset.flno === '167-1',
     mBian ? mBian.dataset.name + ' ' + mBian.dataset.flno : '未辨識');
  ok('「編」不會被誤切成較短名稱', mBian && mBian.dataset.name === '建築技術規則建築設計施工編',
     mBian && mBian.dataset.name);

  console.log('\n\x1b[1m憲法與增修條文（使用者實測回報）\x1b[0m');
  const mCon = byText('中華民國憲法第一百十八條');
  ok('「本法依中華民國憲法第一百十八條」→ 中華民國憲法 118',
     mCon && mCon.dataset.name === '中華民國憲法' && mCon.dataset.flno === '118',
     mCon ? mCon.dataset.name + ' ' + mCon.dataset.flno : '未辨識');
  ok('剝除「本法依」前綴，不吃掉「中華民國」',
     mCon && mCon.textContent === '中華民國憲法第一百十八條', mCon && JSON.stringify(mCon.textContent));
  const mAmd = byText('增修條文第九條');
  ok('「中華民國憲法增修條文第九條第一項」正確斷詞',
     mAmd && mAmd.dataset.name === '中華民國憲法增修條文' && mAmd.dataset.flno === '9',
     mAmd ? mAmd.dataset.name + ' ' + mAmd.dataset.flno : '未辨識');
  ok('增修條文取得項次', mAmd && mAmd.dataset.xiang === '1', mAmd && mAmd.dataset.xiang);
  ok('長字尾優先：不被切成「憲法」', mAmd && mAmd.dataset.name !== '中華民國憲法',
     mAmd && mAmd.dataset.name);

  console.log('\n\x1b[1m司法院解釋（釋字／憲判字）\x1b[0m');
  const ex748 = byText('釋字第748號');
  ok('「司法院釋字第748號」→ C/748',
     ex748 && ex748.dataset.ex === 'C' && ex748.dataset.exno === '748',
     ex748 ? ex748.dataset.ex + '/' + ex748.dataset.exno : '未辨識');
  const ex603 = byText('大法官釋字第603號');
  ok('「大法官釋字第603號」也認得', ex603 && ex603.dataset.exno === '603',
     ex603 && ex603.dataset.exno);
  const exCN = byText('釋字第三十二號');
  ok('中文數字釋字 → 32', exCN && exCN.dataset.exno === '32', exCN && exCN.dataset.exno);
  const cj = byText('憲判字第6號');
  ok('「115年憲判字第6號」→ CJ/6/115',
     cj && cj.dataset.ex === 'CJ' && cj.dataset.exno === '6' && cj.dataset.exyear === '115',
     cj ? cj.dataset.ex + '/' + cj.dataset.exno + '/' + cj.dataset.exyear : '未辨識');
  ok('憲判字不被釋字規則誤切', cj && cj.textContent.indexOf('憲判字') >= 0,
     cj && JSON.stringify(cj.textContent));
  ok('解釋類標記不帶條號', ex748 && !ex748.dataset.flno);

  console.log('\n\x1b[1m排除規則\x1b[0m');
  ok('<script> 內不標記', !window.document.querySelector('script [data-flno]'));
  ok('<a> 內不標記（避免破壞原站連結）', !window.document.querySelector('a [data-flno]'));
  ok('無引用段落未被更動',
     window.document.body.textContent.includes('本段沒有任何法條引用，不應被標記。'));

  console.log('\n\x1b[1m同源取條文（fetch fixture）\x1b[0m');
  m1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));

  const cands = [...window.document.body.children]
    .filter(n => n.className && /^lh-[a-z0-9]+-p$/.test(String(n.className).split(' ')[0] || ''));
  if (process.env.DBG) cands.forEach((n,i)=>console.log('   [dbg] panel'+i,'display='+JSON.stringify(n.style.display),JSON.stringify(n.textContent.slice(0,60))));
  const panel = cands.find(n => !/-hide$/.test(String(n.className).split(' ').pop() || ''));
  ok('面板已顯示', !!panel, panel ? '' : '找不到顯示中的面板');
  if (panel) {
    const txt = panel.textContent;
    ok('面板含條文正文', txt.includes('建築物室內裝修應遵守左列規定'), txt.slice(0, 90));
    ok('面板標題含 77-2', /77-2|七十七條之二/.test(txt), txt.slice(0, 60));
    ok('有「在全國法規資料庫開啟」連結', txt.includes('在全國法規資料庫開啟'));
    ok('有「複製條文」', txt.includes('複製條文'));
    const hl = [...panel.querySelectorAll('div')].find(d => /-x$/.test(String(d.className).split(' ').pop() || ''));
    ok('第1項已標黃', !!hl, hl ? hl.textContent.slice(0, 40) : '未找到高亮');
  }

  console.log('\n\x1b[1m連線範圍（隱私）\x1b[0m');
  ok('曾發出請求', calls.length > 0, '次數=' + calls.length);
  ok('所有請求都在 law.moj.gov.tw 同源',
     calls.every(u => u.startsWith('https://law.moj.gov.tw')),
     calls.filter(u => !u.startsWith('https://law.moj.gov.tw')).join(', '));
  ok('沒有任何第三方網域', !calls.some(u => /vercel|api\.|analytics/.test(u)));

  console.log('\n\x1b[1m網路不穩時的重試\x1b[0m');
  {
    // 前兩次失敗、第三次成功，模擬公司 proxy 的偶發中斷
    const dom = new JSDOM(PAGE, {
      url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    let n = 0;
    w.fetch = (u) => {
      n++;
      if (n <= 2) return Promise.reject(new Error('fetch failed'));
      const f = /LawSearchResult/.test(String(u)) ? 'search-jianzhufa.html' : 'single-77-2.html';
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(F(f)) });
    };
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => {} }, configurable: true });
    w.eval(code);
    // 挑 77-2 這處，與 fixture 回傳的條文相符
    const mk = [...w.document.querySelectorAll('[data-flno]')].find(m => m.dataset.flno === '77-2');
    mk.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 3000));
    const pn = [...w.document.body.children].find(x => {
      const c = String(x.className || '').split(' ');
      return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(y => /-hide$/.test(y));
    });
    const txt = pn ? pn.textContent : '';
    ok('前兩次連線失敗後仍能取回條文', txt.includes('建築物室內裝修應遵守'), txt.slice(0, 60));
    ok('前兩次失敗後成功（重試生效）', n >= 3, '請求數 ' + n);
  }

  {
    // 持續失敗時必須明確報錯，不得顯示可疑內容
    const dom = new JSDOM(PAGE, {
      url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    let n = 0;
    w.fetch = () => { n++; return Promise.reject(new Error('fetch failed')); };
    w.eval(code);
    const mk = [...w.document.querySelectorAll('[data-flno]')].find(m => m.dataset.pcode);
    // 裸條號免搜尋，因此請求數即為單一端點的重試次數
    mk.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 3500));
    const pn = [...w.document.body.children].find(x => {
      const c = String(x.className || '').split(' ');
      return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(y => /-hide$/.test(y));
    });
    ok('持續失敗時明講查不到', pn && pn.textContent.includes('查不到'), pn && pn.textContent.slice(0, 50));
    ok('重試次數有上限（不無限重試）', n === 3, '請求數 ' + n);
  }

  console.log('\n\x1b[1m快取\x1b[0m');
  const before = calls.length;
  m3.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  ok('同一條再查不重複請求（命中快取）', calls.length === before,
     '新增 ' + (calls.length - before) + ' 次請求');

  console.log('\n' + (fail === 0
    ? `\x1b[32m全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
