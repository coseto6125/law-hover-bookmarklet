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

  console.log('\n\x1b[1m自指詞與泛稱字尾（review 發現）\x1b[0m');
  {
    // 「本辦法」被 trimName 剝成「辦法」後，會拿泛稱去搜尋別部法規
    const d = new JSDOM(
      '<body><h2 id="hlLawName">公寓大廈管理條例</h2>' +
      '<p>本辦法第1條、該辦法第2條、同辦法第3條、本憲法第5條、' +
      '案建築法第7條、不受土地法第25條規定。</p></body>',
      { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070118',
        runScripts: 'outside-only', pretendToBeVisual: true });
    const w = d.window;
    const calls = [];
    w.fetch = u => { calls.push(String(u)); return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }); };
    w.eval(code);
    const ms = [...w.document.querySelectorAll('[data-flno]')];
    const byT = t => ms.find(m => m.textContent.includes(t));

    const self1 = byT('本辦法');
    ok('「本辦法」指向本頁法規而非搜尋「辦法」',
       self1 && self1.dataset.name === '公寓大廈管理條例' && !!self1.dataset.pcode,
       self1 ? self1.dataset.name : '未辨識');
    ok('自指詞完整標記（含「本」字）',
       self1 && self1.textContent === '本辦法第1條', self1 && JSON.stringify(self1.textContent));
    ok('沒有任何標記的法規名是泛稱字尾',
       !ms.some(m => /^(法|辦法|條例|規則|標準|細則|準則|通則|憲法|編)$/.test(m.dataset.name)),
       ms.map(m => m.dataset.name).join(', '));
    ok('真實法規仍正確辨識',
       byT('建築法') && byT('建築法').dataset.name === '建築法' &&
       byT('土地法') && byT('土地法').dataset.name === '土地法');
  }

  console.log('\n\x1b[1m法規名左邊界（review 發現，皆為現行條文原句）\x1b[0m');
  {
    /* 原本只靠前綴黑名單修剪左邊界，會把前一段文字吃進法規名，
     * 導致真實引用完全查不到。以下三句取自站上現行條文。 */
    const nameOf = (txt, self) => {
      const d = new JSDOM('<body><h2 id="hlLawName">' + self + '</h2><p>' + txt + '</p></body>',
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=X',
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')].map(x => x.dataset.name);
    };
    const cases = [
      ['第一百六十四條及民法第九百零八條規定', '公司法', '民法'],
      ['行政機關依中央法規標準法第七條規定', '行政程序法', '中央法規標準法'],
      ['曾犯本條或陸海空軍刑法第五十四條之罪', '中華民國刑法', '陸海空軍刑法'],
    ];
    for (const [txt, self, want] of cases) {
      const got = nameOf(txt, self);
      ok('「' + txt.slice(0, 12) + '…」→ ' + want, got.indexOf(want) >= 0, got.join(' / '));
    }
    // 邊界規則不可切壞法規名本身
    ok('「憲法增修條文」不被邊界切壞',
       nameOf('本法依中華民國憲法增修條文第九條制定', 'X法').indexOf('中華民國憲法增修條文') >= 0);
    ok('「建築技術規則建築設計施工編」完整保留',
       nameOf('另依建築技術規則建築設計施工編第167條之1', 'X法')
         .indexOf('建築技術規則建築設計施工編') >= 0);
  }

  console.log('\n\x1b[1m連續條號的作用範圍（review 發現的 critical）\x1b[0m');
  {
    /* 「人口販運防制法第三十二條、第三十三條」的後半段仍屬該法。
     * 若一律綁成本頁法規，會顯示完全錯誤的條文，這是最危險的一種錯誤。 */
    const mk = (txt, lawName, pcode) => {
      const d = new JSDOM('<body><h2 id="hlLawName">' + lawName + '</h2><p>' + txt + '</p></body>',
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + pcode,
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')];
    };

    let ms = mk('犯人口販運防制法第三十二條、第三十三條之行為者。', '中華民國刑法', 'C0000001');
    ok('連續條號沿用前一部法規（不誤綁本法）',
       ms.length === 2 && ms[1].dataset.name === ms[0].dataset.name && !ms[1].dataset.pcode,
       ms.map(m => m.dataset.name + ' 第' + m.dataset.flno + '條').join(' | '));

    ms = mk('依建築法第5條及第7條規定。', '中華民國刑法', 'C0000001');
    ok('「及第X條」同樣沿用前法',
       ms.length === 2 && ms[1].dataset.name === '建築法',
       ms.map(m => m.dataset.name + ' 第' + m.dataset.flno + '條').join(' | '));

    ms = mk('依建築法第5條規定辦理。另依第9條處理。', '中華民國刑法', 'C0000001');
    ok('句號後作用範圍結束，回到本頁法規',
       ms.length === 2 && ms[1].dataset.name === '中華民國刑法' && !!ms[1].dataset.pcode,
       ms.map(m => m.dataset.name + ' 第' + m.dataset.flno + '條').join(' | '));

    ms = mk('依第九十九條規定辦理。', '中華民國刑法', 'C0000001');
    ok('純裸條號仍指向本頁法規',
       ms.length === 1 && !!ms[0].dataset.pcode, ms.map(m => m.dataset.name).join());
  }

  console.log('\n\x1b[1m非同步競態（review 發現的 critical）\x1b[0m');
  {
    /* 快速掃過多個標記時，較早發出的請求可能較晚回來覆蓋面板，
     * 導致在 A 條旁看到 B 條的內文。以序號把關只讓最新結果生效。 */
    const single = F('single-77-2.html');
    const d = new JSDOM('<body><h2 id="hlLawName">建築法</h2><p>依第3條及依第5條規定。</p></body>',
      { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
        runScripts: 'outside-only', pretendToBeVisual: true });
    const w = d.window;
    let n = 0;
    w.fetch = () => {
      const i = ++n;
      return new Promise(r => setTimeout(() => r({
        ok: true, status: 200,
        text: () => Promise.resolve(single.replace(/第 77-2 條/g, '第 ' + (i === 1 ? '3' : '5') + ' 條')),
      }), i === 1 ? 300 : 30));   // 第一個請求刻意較慢
    };
    w.eval(code);
    const ms = [...w.document.querySelectorAll('[data-flno]')];
    ms[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));
    ms[1].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    const p = [...w.document.body.children].find(x => {
      const c = String(x.className || '').split(' ');
      return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
    });
    const txt = p ? p.textContent.replace(/\s+/g, ' ') : '';
    ok('舊請求不覆蓋最新懸停的面板',
       /第 5 條/.test(txt) && !/第 3 條/.test(txt), txt.slice(0, 45));
  }

  console.log('\n\x1b[1m請求去重（review 發現）\x1b[0m');
  {
    /* 滑鼠在同一標記上移動會重複觸發 mouseover，
     * 進行中的請求若不共用 Promise 就會重複發出（codex review 實測）。 */
    const d = new JSDOM(PAGE, {
      url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = d.window;
    const calls = [];
    w.fetch = u => {
      calls.push(String(u));
      return new Promise(r => setTimeout(() => r({
        ok: true, status: 200, text: () => Promise.resolve(F('single-77-2.html')),
      }), 200));
    };
    w.eval(code);
    const m = [...w.document.querySelectorAll('[data-flno]')].find(x => x.dataset.flno === '77-2');
    m.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    m.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    m.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const single = calls.filter(u => /LawSingle/.test(u));
    ok('連續三次懸停同一標記只發一次請求', single.length === 1,
       single.length + ' 次：' + single.join(' | '));
  }

  console.log('\n\x1b[1m條號驗證嚴格性（review 發現）\x1b[0m');
  {
    // 「要第 7 條卻拿到第 77 條」是最誤導人的方向，必須攔下
    const single = F('single-77-2.html');
    const d = new JSDOM('<body><h2 id="hlLawName">建築法</h2><p>依第7條規定辦理。</p></body>',
      { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
        runScripts: 'outside-only', pretendToBeVisual: true });
    const w = d.window;
    // 不論要哪一條都回傳第 77-2 條，模擬原站回錯內容
    w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(single) });
    w.eval(code);
    const m = [...w.document.querySelectorAll('[data-flno]')].find(x => x.dataset.flno === '7');
    ok('有辨識到第 7 條的引用', !!m);
    if (m) {
      m.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      const p = [...w.document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      const txt = p ? p.textContent : '';
      ok('取回第 77-2 條時被攔下（不顯示錯誤條文）',
         /查不到|驗證失敗/.test(txt) && !/建築物室內裝修應遵守/.test(txt), txt.slice(0, 60));
    }
  }

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
  // 條文本身命中快取；沿革是另一個端點，首次查詢會有一次額外請求
  const added = calls.slice(before);
  ok('同一條再查不重複取條文（命中快取）',
     !added.some(u => /LawSingle/.test(u)),
     added.join(' | '));

  console.log('\n' + (fail === 0
    ? `\x1b[32m全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
