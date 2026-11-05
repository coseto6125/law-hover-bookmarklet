/* 用 jsdom + 真實頁面 fixture 驗證 bookmarklet 端到端行為 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const F = f => fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 用建置時同一份注入邏輯，確保測到的就是實際出貨的程式碼。
const code = require('../build/source').loadSource().code;

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
    // 「憲法」「民法」「刑法」既是字尾也是真實法規名，不算泛稱
    ok('沒有任何標記的法規名是泛稱字尾',
       !ms.some(m => /^(法|辦法|條例|規則|標準|細則|準則|通則|編)$/.test(m.dataset.name)),
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

  console.log('\n\x1b[1m多組別名與跨段落前指（第三輪 review 的 critical）\x1b[0m');
  {
    const mk = (law, pc, html) => {
      const d = new JSDOM('<body><h2 id="hlLawName">' + law + '</h2>' + html + '</body>',
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + pc,
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')];
    };

    /* 同一部法規可定義多組別名，只記第一組會讓「本條例」也指向「本法」的法規。
     * 各類所得扣繳率標準同時定義所得稅法與臺灣地區與大陸地區人民關係條例。 */
    let ms = mk('各類所得扣繳率標準', 'G0340028',
      '<p>本標準依所得稅法（以下簡稱本法）第八十八條規定訂定之。</p>' +
      '<p>臺灣地區與大陸地區人民關係條例（以下簡稱本條例）另有規定。</p>' +
      '<p>依本條例第二十五條規定辦理。</p>');
    const be = ms.find(m => m.textContent.indexOf('本條例') >= 0);
    ok('多組別名時「本條例」指向正確的法規',
       be && be.dataset.name === '臺灣地區與大陸地區人民關係條例',
       be ? be.dataset.name : '未辨識');
    ok('法規名內部的「與」不被當成邊界切開',
       be && be.dataset.name.indexOf('臺灣地區') === 0, be && be.dataset.name);

    /* 定義了「本法」之後，其他自指詞（本辦法）仍應指本頁法規 */
    ms = mk('國家安全情報工作統合辦法', 'A0010029',
      '<p>本辦法依國家安全局組織法（以下簡稱本法）第二條規定訂定之。</p>' +
      '<p>本辦法第二條所稱情報機關如下。</p>');
    const bb = ms.find(m => m.textContent.indexOf('本辦法') >= 0);
    ok('未定義別名的自指詞仍指本頁法規',
       bb && bb.dataset.name === '國家安全情報工作統合辦法' && !!bb.dataset.pcode,
       bb ? bb.dataset.name : '未辨識');

    /* 前指詞的先行詞在前一個段落（不同文字節點）時，
     * 原本會回退成本頁法規，顯示錯誤條文 */
    ms = mk('公務人員任用法', 'S0020001',
      '<div class="line-0000">技術人員任用條例（以下簡稱該條例）於中華民國七十五年廢止。</div>' +
      '<div class="line-0004">原依該條例第五條第一項規定進用之人員。</div>');
    const ce = ms.find(m => m.textContent.indexOf('該條例') >= 0);
    ok('跨段落的前指詞不被誤綁本頁法規',
       ce && ce.dataset.name === '技術人員任用條例' && !ce.dataset.pcode,
       ce ? ce.dataset.name + (ce.dataset.pcode ? '[本頁]' : '') : '未辨識');

    /* 子法定義「以下簡稱本法」時，本法指母法 */
    ms = mk('公教人員保險法施行細則', 'S0070002',
      '<p>本細則依公教人員保險法（以下簡稱本法）第五條規定訂定之。</p>' +
      '<p>承保機關每年應依照本法第五條第二項辦理。</p>');
    const bf = ms.find(m => m.textContent.indexOf('本法') >= 0);
    ok('「以下簡稱本法」時本法指母法',
       bf && bf.dataset.name === '公教人員保險法' && !bf.dataset.pcode,
       bf ? bf.dataset.name : '未辨識');
    ok('別名不被公文前綴污染', bf && bf.dataset.name.indexOf('本細則') < 0,
       bf && bf.dataset.name);

    /* 實際頁面的別名定義前面是條號與換行，不會黏著本頁法規名。
     * 此時「本細則依」的「本」先被前綴清單剝掉，留下「細則依化粧品衛生安全管理法」
     *（化粧品衛生安全管理法施行細則 L0030014 實測）。 */
    ms = mk('化粧品衛生安全管理法施行細則', 'L0030014',
      '<div class="col-no"><a>第 1 條</a></div><div class="law-article">\n' +
      '<div class="line-0000">本細則依化粧品衛生安全管理法（以下簡稱本法）第三十一條規定訂定之。</div></div>' +
      '<div class="line-0000">本法第四條第一項化粧品產品登錄。</div>');
    const bg = ms.find(m => m.textContent.indexOf('本法第四條') >= 0);
    ok('別名定義前無黏字時仍剝除「本細則依」',
       bg && bg.dataset.name === '化粧品衛生安全管理法' && !bg.dataset.pcode,
       bg ? bg.dataset.name : '未辨識');

    /* 本頁法規名前面黏著公文前綴時，要先剝前綴才能剝本頁法規名
     *（mk 把標題放在最前面，無法重現，故直接建頁） */
    const d = new JSDOM('<body><span>有關</span><h2 id="hlLawName">建築法施行細則</h2>' +
      '<p>本細則依建築法（以下簡稱本法）訂定之。</p><p>本法第四條規定。</p></body>',
      { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070116',
        runScripts: 'outside-only', pretendToBeVisual: true });
    d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    d.window.eval(code);
    const bh = [...d.window.document.querySelectorAll('[data-flno]')]
      .find(m => m.textContent.indexOf('本法第四條') >= 0);
    ok('本頁法規名前有前綴時仍剝除「本細則依」',
       bh && bh.dataset.name === '建築法' && !bh.dataset.pcode,
       bh ? bh.dataset.name : '未辨識');

    /* 同一子句以連接詞並列的裸條號，延續前面的「本法」（L0030014 第 2 條） */
    ms = mk('化粧品衛生安全管理法施行細則', 'L0030014',
      '<p>本細則依化粧品衛生安全管理法（以下簡稱本法）第三十一條規定訂定之。</p>' +
      '<p>本法第四條第一項化粧品產品登錄與產品資訊檔案建立及第十七條第一項回收作業，應由化粧品製造或輸入業者為之。</p>');
    const bi = ms.find(m => m.textContent === '第十七條第一項');
    const bn = ms.find(m => m.textContent === '第三十一條');
    ok('別名定義後的條號屬於被定義的法規',
       bn && bn.dataset.name === '化粧品衛生安全管理法' && !bn.dataset.pcode,
       bn ? bn.dataset.name + (bn.dataset.pcode ? '[本頁]' : '') : '未辨識');
    ok('子句內並列的裸條號延續「本法」',
       bi && bi.dataset.name === '化粧品衛生安全管理法' && !bi.dataset.pcode && bi.dataset.flno === '17',
       bi ? bi.dataset.name + (bi.dataset.pcode ? '[本頁]' : '') : '未辨識');

    /* 子句內先出現本頁裸條號時，並列的是本頁條文（所得基本稅額條例施行細則第 23 條） */
    ms = mk('所得基本稅額條例施行細則', 'G0340115',
      '<p>本細則依所得基本稅額條例（以下簡稱本條例）第二十條規定訂定之。</p>' +
      '<p>第十四條第一項、第二項有關應加計本條例第十二條第一項第一款規定金額部分及第十五條，自本條例第十二條第一項第一款施行之日施行。</p>');
    const bj = ms.find(m => m.textContent === '第十五條');
    ok('子句先有本頁裸條號時不延續具名引用',
       bj && bj.dataset.name === '所得基本稅額條例施行細則' && !!bj.dataset.pcode,
       bj ? bj.dataset.name : '未辨識');

    /* 延續的對象是前指詞時，裸條號跟著解析，不可被丟掉（少年保護事件審理細則） */
    ms = mk('少年保護事件審理細則', 'C0010009',
      '<p>本細則依少年事件處理法（以下簡稱本法）第八十七條之一規定訂定之。</p>' +
      '<p>本法第十八條第一項之移送，應以書面為之。同法第十七條之報告及第十八條第八項之請求，得以書面為之。</p>');
    const bk = ms.find(m => m.textContent === '第十八條第八項');
    ok('延續前指詞的裸條號不被丟掉',
       bk && bk.dataset.name === '少年事件處理法' && !bk.dataset.pcode,
       bk ? bk.dataset.name : '未標記');

    /* 擴大延續的邊界（codex review 實測）：以下裸條號都應維持綁本頁 */
    const bare = (html, want) => {
      const a = mk('建築法', 'D0070109', html).find(m => m.textContent === want);
      return a ? a.dataset.name + (a.dataset.pcode ? '[本頁]' : '') : '未辨識';
    };
    let got = bare('<p>依民法第五條規定辦理者得參與第九條所定之審議程序。</p>', '第九條');
    ok('「參與」不是並列連接詞', got === '建築法[本頁]', got);
    got = bare('<p>第十四條所定事項（例如：依民法第五條規定辦理）及第十五條所定事項。</p>', '第十五條');
    ok('括號內的引用不延續到括號外', got === '建築法[本頁]', got);
    got = bare('<p>本條所定事項（依民法第五條規定辦理）及第十五條所定事項。</p>', '第十五條');
    ok('括號內的引用不延續到括號外（前面無引用）', got === '建築法[本頁]', got);
    got = bare('<p>建築法第十四條有關應依民法第五條規定辦理之事項及第十五條所定事項。</p>', '第十五條');
    ok('子句先有全名的本頁引用時不延續', got !== '民法', got);
    got = bare('<p>本法第十三條另有規定。同法第十四條有關應依民法第五條規定辦理之事項及第十五條所定事項。</p>', '第十五條');
    ok('子句先有前指詞時不延續', got !== '民法', got);
    got = bare('<p>消防法（以下簡稱本法）另有規定。建築法（以下簡稱本法）第九條所定事項。</p>', '第九條');
    ok('別名條號取緊鄰的定義，不取全頁第一筆', got === '建築法[本頁]', got);

    /* 前指詞找不到先行詞時，延續它的裸條號不跟著退回本頁（sonnet review） */
    ms = mk('勞工退休金條例', 'N0030020', '<p>依同法第十七條、第五十五條及第八十四條之二規定辦理。</p>');
    const bp = ms.find(m => m.textContent === '第五十五條');
    ok('延續無先行詞的前指詞時不綁本頁', !bp || !bp.dataset.pcode, bp && bp.dataset.name);
    /* 別名法規名不以現行字典改寫：廢止的舊法名會被對成另一部現行法 */
    got = bare('<p>本細則依電腦處理個人資料保護法（以下簡稱本法）第四十四條規定訂定之。</p><p>本法第五條</p>', '本法第五條');
    ok('別名為舊法名時不被改成現行法', got === '電腦處理個人資料保護法', got);

    /* 間隔是條項串時仍延續（「、第三項、」「但書第三款、」） */
    ms = mk('商業事件審理法', 'B0010072',
      '<p>適用民事訴訟法第四百八十二條、第四百八十八條第一項、第三項、第四百九十條之規定。</p>');
    const bq = ms.find(m => m.textContent === '第四百九十條');
    ok('條項串之後的條號延續前面的法規',
       bq && bq.dataset.name === '民事訴訟法' && !bq.dataset.pcode,
       bq ? bq.dataset.name + (bq.dataset.pcode ? '[本頁]' : '') : '未辨識');
    ms = mk('個人資料保護法施行細則', 'I0050022',
      '<p>本細則依個人資料保護法（以下簡稱本法）第五十五條規定訂定之。</p>' +
      '<p>本法第六條第一項但書第三款、第九條第二項第二款所稱當事人自行公開之個人資料。</p>');
    const br = ms.find(m => m.textContent === '第九條第二項第二款');
    ok('「但書第N款」之後的條號延續前面的法規',
       br && br.dataset.name === '個人資料保護法' && !br.dataset.pcode,
       br ? br.dataset.name + (br.dataset.pcode ? '[本頁]' : '') : '未辨識');
    /* 別名定義前的「除依」要剝除（臺灣地區砂糖平準基金條例施行細則第 1 條） */
    ms = mk('臺灣地區砂糖平準基金條例施行細則', 'J0040011',
      '<p>臺灣地區砂糖平準基金（以下簡稱平準基金）除依臺灣地區砂糖平準基金條例（以下簡稱本條例）之規定外，其施行依本細則之規定。</p>' +
      '<p>本條例第六條之平準基金專戶。</p>');
    const bs = ms.find(m => m.textContent === '本條例第六條');
    ok('別名定義前的「除依」被剝除',
       bs && bs.dataset.name === '臺灣地區砂糖平準基金條例', bs ? bs.dataset.name : '未辨識');

    got = bare('<p>期間計算依行政程序法第四十八條第五項但書，第五條所定申請文件應備齊。</p>', '第五條');
    ok('條項串不跨逗號延續', got === '建築法[本頁]', got);
    got = bare('<p>依國籍法第二條第一款至第四款，及第八條取得中華民國國籍者。</p>', '第八條');
    ok('逗號後緊接連接詞仍延續', got === '國籍法', got);
    got = bare('<p>刑事訴訟法第六條第一項、第二項，第七條及第八條前段之規定，於少年保護事件準用之。</p>', '第七條');
    ok('列舉中的逗號仍延續', got === '刑事訴訟法', got);

    /* 「查核」「查禁」開頭的法規名不剝「查」，公文的「查」仍剝除 */
    got = bare('<p>前項查核程序，除本法另有規定外，準用查核辦法第六條第三項規定。</p>', '查核辦法第六條第三項');
    ok('「查核辦法」不被剝成「核辦法」', got === '查核辦法', got);
    got = bare('<p>查民法第五條規定之意旨。</p>', '民法第五條');
    ok('公文的「查」仍剝除', got === '民法', got);

    /* 1.0.5：法規全文語料找出的法規名切錯，一次修正 */
    const nameOf2 = (law, pc, html, txt) => {
      const a = mk(law, pc, html).find(m => m.textContent === txt);
      return a ? a.dataset.name + (a.dataset.pcode ? '[本頁]' : '') : '未辨識';
    };
    got = nameOf2('公務人員個人專戶制退休資遣撫卹法', 'S0080036',
      '<p>適用公務人員退休資遣撫卹法（以下簡稱退撫法）施行細則第十七條規定。</p>', '施行細則第十七條');
    ok('別名括號夾在名稱中間時接回字尾', got === '公務人員退休資遣撫卹法施行細則', got);
    got = nameOf2('蒙藏委員會處務規程', 'A0000000',
      '<p>本規程依蒙藏委員會（以下簡稱本會）組織法第二十七條規定訂定之。</p>', '組織法第二十七條');
    ok('「本會）組織法」接回機關名', got === '蒙藏委員會組織法', got);
    got = nameOf2('公務人員個人專戶制退休資遣撫卹法', 'S0080036',
      '<p>適用退撫法第三十二條及其施行細則第三十二條規定。</p>', '其施行細則第三十二條');
    ok('「其施行細則」指前面那部法的施行細則', got === '退撫法施行細則', got);
    got = nameOf2('監察院各委員會辦事規則', 'A0000001',
      '<p>各委員會依據監察法第二十五條及同法施行細則第二十條規定。</p>', '同法施行細則第二十條');
    ok('「同法施行細則」指前面那部法的施行細則', got === '監察法施行細則', got);
    got = nameOf2('能源查核實施辦法', 'J0130026',
      '<p>本辦法依能源管理法第十二條及同法施行細則第四條、第八條規定訂定之。</p>', '第八條');
    ok('延續「同法施行細則」的條號也指施行細則', got === '能源管理法施行細則', got);
    got = nameOf2('建築法', 'D0070109', '<p>本法施行細則第二條</p>', '本法施行細則第二條');
    ok('「本法施行細則」指本頁法規的施行細則', got === '建築法施行細則', got);
    got = nameOf2('建築技術規則建築設計施工編', 'D0070115', '<p>應依本編第一百六十四條規定計算。</p>', '本編第一百六十四條');
    ok('「本編」指本頁', got === '建築技術規則建築設計施工編[本頁]', got);
    got = nameOf2('貨棧貨櫃集散站保稅倉庫物流中心及海關指定業者實施自主管理辦法', 'G0350000',
      '<p>依保稅倉庫設立及管理辦法第四條規定不得進儲。</p>', '保稅倉庫設立及管理辦法第四條');
    ok('字典裡的法規名內部的「及」不切斷（字典收入被引用的命令）', got === '保稅倉庫設立及管理辦法', got);
    got = nameOf2('金融機構國內分支機構管理辦法', 'G0380000',
      '<p>自有資本比率應依銀行資本適足性及資本等級管理辦法第五條規定。</p>', '銀行資本適足性及資本等級管理辦法第五條');
    ok('字典裡含「及」的名稱不切斷', got === '銀行資本適足性及資本等級管理辦法', got);
    got = bare('<p>依民法第五條及刑法第十條</p>', '刑法第十條');
    ok('「及」左邊是條號時仍是邊界', got === '刑法', got);
    got = nameOf2('懲治叛亂條例', 'A0000002', '<p>曾犯刑法第一百條第一項之罪。</p>', '刑法第一百條第一項');
    ok('「曾犯刑法」切出「刑法」', got === '刑法', got);
    got = nameOf2('原住民族依生活慣俗採取森林產物規則', 'M0040049',
      '<p>一、原住民族基本法第二條第二款所稱原住民。</p>', '原住民族基本法第二條第二款');
    ok('「基本法」結尾的「本法」不是自指詞', got === '原住民族基本法', got);
    got = bare('<p>依日本刑法第二條規定。</p>', '日本刑法第二條');
    ok('「日本刑法」不被認成我國刑法', got === '日本刑法', got);
    got = nameOf2('原住民族依生活慣俗採取森林產物規則', 'M0040049',
      '<p>依原住民族依生活慣俗採取森林產物規則（以下簡稱本規則）第二條規定辦理。</p><p>本規則第三條</p>', '本規則第三條');
    ok('別名的「依」切點不切進字典裡的完整名稱', got === '原住民族依生活慣俗採取森林產物規則[本頁]' || got === '原住民族依生活慣俗採取森林產物規則', got);
    got = nameOf2('電業法', 'J0030011', '<p>依能源管理法及其施行細則第四條規定辦理。</p>', '能源管理法及其施行細則第四條');
    ok('「X法及其施行細則」取前面的法規名', got === '能源管理法施行細則', got);
    got = nameOf2('電業法', 'J0030011', '<p>其施行細則第四條規定辦理。</p>', '其施行細則第四條');
    ok('「其」找不到先行法規時不綁本頁', got === '未辨識', got);
    got = nameOf2('電業法', 'J0030011', '<p>本法施行細則第二條及同法施行細則第三條。</p>', '同法施行細則第三條');
    ok('「同法施行細則」不重複接字尾', got === '電業法施行細則', got);
    got = bare('<p>申請文件應符合審查要求及臺北市建築管理自治條例第五條規定。</p>', '臺北市建築管理自治條例第五條');
    ok('句中的「及」仍是法規名的左邊界', got === '臺北市建築管理自治條例', got);
    got = bare('<p>依我國民法第五條規定。</p>', '民法第五條');
    ok('「我國民法」仍是我國民法', got === '民法', got);
    got = bare('<p>依日本國憲法第九條規定。</p>', '日本國憲法第九條');
    ok('「日本國憲法」不被認成我國憲法', got === '日本國憲法', got);
    got = bare('<p>依大韓民國憲法第一條規定。</p>', '大韓民國憲法第一條');
    ok('「大韓民國憲法」不被認成我國憲法', got === '大韓民國憲法', got);
    got = bare('<p>依本國刑法第十條規定。</p>', '刑法第十條');
    ok('「本國刑法」仍是我國刑法', got === '刑法', got);
    got = nameOf2('電業法', 'J0030011', '<p>依本法及其施行細則第二條規定。</p>', '本法及其施行細則第二條');
    ok('「本法及其施行細則」指本頁法規的施行細則', got === '電業法施行細則', got);
    got = nameOf2('電業法', 'J0030011', '<p>依民法第一條。依「勞工保險條例」及其施行細則第二條規定。</p>', '及其施行細則第二條');
    ok('引號名稱及其施行細則', got === '勞工保險條例施行細則', got);
    got = nameOf2('公務人員個人專戶制退休資遣撫卹法', 'S0080036',
      '<p>適用公務人員退休資遣撫卹法（以下簡稱退撫法）施行細則第十七條及同法施行細則第十八條規定。</p>', '同法施行細則第十八條');
    ok('別名接字尾之後的「同法施行細則」不重複接字尾', got === '公務人員退休資遣撫卹法施行細則', got);
    got = nameOf2('各級選舉委員會執行監察職務準則', 'D0020051',
      '<p>對涉有違反總統選罷法第四十六條之一。</p>', '總統選罷法第四十六條之一');
    ok('「涉有違反」被剝除', got === '總統選罷法', got);
    ms = mk('期貨交易所管理規則', 'G0400004',
      '<p>本規則依照期貨交易法（以下簡稱本法）第八條第二項規定訂定之。</p><p>本法第九條</p>');
    const bu = ms.find(m => m.textContent === '本法第九條');
    ok('「本規則依照」被剝除', bu && bu.dataset.name === '期貨交易法', bu ? bu.dataset.name : '未辨識');
    ms = mk('發電業設備規則', 'J0030100',
      '<p>發電業依電業法（以下簡稱本法）第二十條規定。</p><p>本法第九條</p>');
    const bv = ms.find(m => m.textContent === '本法第九條');
    ok('別名定義前句中的「依」之後才是法規名', bv && bv.dataset.name === '電業法', bv ? bv.dataset.name : '未辨識');
    got = nameOf2('失業中高齡者及高齡者就業促進辦法', 'N0090041',
      '<p>準用就業促進津貼實施辦法第三條規定。</p>', '就業促進津貼實施辦法第三條');
    ok('命令名稱開頭的「就」不被剝除', got === '就業促進津貼實施辦法', got);

    /* 「除」「特依」不是法規名的一部分（全國法規 11803 部無一以「除」開頭） */
    got = bare('<p>除教師請假規則第四條第一項第五款、第五條另有規定外，依本法辦理。</p>', '第五條');
    ok('「除」不併入法規名', got === '教師請假規則', got);
    ms = mk('土壤及地下水污染整治費收費辦法', 'O0110005',
      '<p>為加強土壤及地下水污染之整治，特依土壤及地下水污染整治法（以下簡稱本法）第二十八條規定訂定之。</p>' +
      '<p>本法第十二條第一項</p>');
    const bt = ms.find(m => m.textContent === '本法第十二條第一項');
    ok('別名定義前的「特依」被剝除',
       bt && bt.dataset.name === '土壤及地下水污染整治法', bt ? bt.dataset.name : '未辨識');

    /* 字典比對出的完整法規名不可再被前綴清單剝字（「就」「本」等單字前綴） */
    ms = mk('社會救助法施行細則', 'D0050080',
      '<p>五、依就業保險法第二十五條規定辦理失業認定。</p>');
    const bl = ms.find(m => m.textContent.indexOf('保險法') >= 0);
    ok('「就業保險法」不被剝成「業保險法」',
       bl && bl.dataset.name === '就業保險法', bl ? bl.dataset.name : '未辨識');
    ms = mk('勞工保險條例施行細則', 'N0050002',
      '<p>就業保險法（以下簡稱本法）另有規定。</p><p>本法第四條</p>');
    const bm = ms.find(m => m.textContent === '本法第四條');
    ok('別名定義不把「就業保險法」剝成「業保險法」',
       bm && bm.dataset.name === '就業保險法', bm ? bm.dataset.name : '未辨識');
  }

  console.log('\n\x1b[1m兩字法規名（fable 以 8574 個真實段落找到的高危）\x1b[0m');
  {
    /* SUFFIX 含單字元的「法」，若要求名稱前段至少 2 字，
     * 「民法」「刑法」「憲法」這類 2 字法規名會完全比對不到，
     * 接著被裸條號規則綁成本頁法規，顯示完全不相干的條文且無提示。 */
    const mk = (txt, law, pc) => {
      const d = new JSDOM('<body><h2 id="hlLawName">' + law + '</h2><p>' + txt + '</p></body>',
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + pc,
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')];
    };

    // 公司法第 192 條的真實原句
    let ms = mk('民法第十五條之二及第八十五條之規定，對於第一項行為能力，不適用之。',
                '公司法', 'J0080001');
    ok('「民法第十五條之二」不被綁成本頁法規',
       ms.length >= 1 && ms[0].dataset.name === '民法' && !ms[0].dataset.pcode,
       ms.map(m => m.dataset.name + ' 第' + m.dataset.flno + '條').join(' | '));
    ok('後接的「第八十五條」沿用民法',
       ms.length === 2 && ms[1].dataset.name === '民法',
       ms.map(m => m.dataset.name).join(' | '));

    for (const [txt, want] of [['民法第五條', '民法'], ['刑法第十條', '刑法'],
                               ['憲法第七條', '憲法'], ['公司法第八條', '公司法']]) {
      const r = mk(txt + '規定辦理。', '建築法', 'D0070109');
      ok('「' + txt + '」→ ' + want,
         r.length >= 1 && r[0].dataset.name === want && !r[0].dataset.pcode,
         r.map(m => m.dataset.name + (m.dataset.pcode ? '[本頁]' : '')).join(' | ') || '未標記');
    }
  }

  console.log('\n\x1b[1m自指詞與前指詞（第二輪 review 的 critical）\x1b[0m');
  {
    const mk = (html, url) => {
      const d = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')];
    };

    /* 子法寫「○○法（以下簡稱本法）」時，「本法」指母法而非本頁。
     * 綁成本頁會顯示施行細則自己的條文，內容完全不同。 */
    let ms = mk('<body><h2 id="hlLawName">公教人員保險法施行細則</h2>' +
      '<p>本細則依公教人員保險法（以下簡稱本法）第五條規定訂定之。</p>' +
      '<p>承保機關每年應依照本法第五條第二項辦理。</p></body>',
      'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=S0070002');
    const selfRef = ms.find(m => m.textContent.indexOf('本法') >= 0);
    ok('「以下簡稱本法」時，本法指母法而非本頁',
       selfRef && selfRef.dataset.name === '公教人員保險法' && !selfRef.dataset.pcode,
       selfRef ? selfRef.dataset.name : '未辨識');
    ok('自指詞標記範圍只含自指詞本身',
       selfRef && selfRef.textContent === '本法第五條第二項', selfRef && JSON.stringify(selfRef.textContent));

    /* 「同法／該法」是前指詞，指前文最近提到的法規，不是本頁法規。 */
    ms = mk('<body><h2 id="hlLawName">行政程序法</h2><p>依建築法第五條及同法第七條規定。</p></body>',
      'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030055');
    const ana = ms.find(m => m.textContent.indexOf('同法') >= 0);
    ok('「同法」指前文最近提到的法規', ana && ana.dataset.name === '建築法',
       ana ? ana.dataset.name : '未辨識');
    ok('「同法」不被誤綁本頁法規', ana && !ana.dataset.pcode);

    /* 沒有前文可指時退回本頁，但不可顯示錯誤法規 */
    ms = mk('<body><h2 id="hlLawName">建築法</h2><p>依同法第七條規定。</p></body>',
      'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109');
    ok('無前文可指時退回本頁法規',
       ms.length === 1 && ms[0].dataset.name === '建築法', ms.map(m => m.dataset.name).join());
  }

  console.log('\n\x1b[1m長法規名（第二輪 review 的 critical）\x1b[0m');
  {
    /* 官方法規名可達 34 字以上。具名比對失敗時，裸條號規則會把內部的
     * 「第3條」綁成本頁法規，顯示出條號正確但法規完全錯誤的條文。 */
    const LONG = '營造業承攬工程造價限額工程規模範圍申報淨值及一定期間承攬總額認定辦法';
    const mk2 = txt => {
      const d = new JSDOM('<body><h2 id="hlLawName">測試法</h2><p>' + txt + '</p></body>',
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=X',
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      return [...d.window.document.querySelectorAll('[data-flno]')];
    };
    let ms = mk2('依「' + LONG + '」第3條規定。');
    ok('引號內的 34 字法規名可正確辨識',
       ms.length === 1 && ms[0].dataset.name === LONG, ms.map(m => m.dataset.name).join());
    ok('不會退回綁成本頁法規', ms.length === 1 && !ms[0].dataset.pcode,
       ms.map(m => m.dataset.name + (m.dataset.pcode ? '[本頁]' : '')).join());

    /* 未加引號時，法規名內部的「及」與句子連接詞無法從語法區分，
     * 會被切成較短的名稱。此時寧可查不到也不能綁成本頁法規（查錯更危險）。
     * 使用者加引號即可正確辨識。 */
    ms = mk2('依' + LONG + '第3條規定。');
    ok('未加引號的長法規名不會被誤綁本頁法規',
       ms.every(m => !m.dataset.pcode),
       ms.map(m => m.dataset.name + (m.dataset.pcode ? '[本頁]' : '')).join());
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
    /* 施行細則頁的標題含母法名稱，母法的引用不可抓成本頁代碼
     *（勞工保險條例施行細則頁上的「勞工保險條例第三條」曾顯示細則第三條） */
    const dom = new JSDOM('<body><h2 id="hlLawName">勞工保險條例施行細則</h2>' +
      '<p>依勞工保險條例第三條規定辦理。</p></body>', {
      url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0050002',
      runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    const urls = [];
    w.fetch = (u) => { urls.push(String(u)); return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }); };
    w.eval(code);
    const mk = [...w.document.querySelectorAll('[data-flno]')].find(m => m.dataset.name === '勞工保險條例');
    if (mk) mk.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ok('施行細則頁上的母法引用不抓本頁代碼',
       !!mk && urls.length > 0 && !urls.some(u => /pcode=N0050002/.test(u)), urls.join(' ') || '未發出請求');
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

  /* codex 第三輪 review：法規名的左邊界被前文吃掉。
   * 純字元規則會把「兒童及少年性剝削防制條例」的「兒童及」誤判為句子連接詞而切掉，
   * 也窮舉不完「承租人違反」這類動詞前綴，故改以已知法規名字典做最長後綴匹配。 */
  /* 不支援的網站上，書籤必須只顯示提示就結束：不掃描、不標記、不連線。
   * 掃描非法規網站沒有意義（取不到條文），還會平白改動別人的頁面。 */
  /* 取全文的站台（臺北市、新北市）同一部法規只該下載一次。
   * 去重的 key 必須是法規而非條號：外層 once() 用 art|pcode|flno，
   * 同一法規的不同條號是不同 key，在第一份全文完成前會各下載一次
   * 完全相同的全文（codex review 第 8 項）。 */
  console.log('\n\x1b[1m全文站台的並發請求合併\x1b[0m');
  {
    const mk = () => {
      const d = new JSDOM(
        '<body><h3>臺北市建築管理自治條例</h3>' +
        '<div class="col-article"><p>依第 3 條與第 5 條、第 7 條規定辦理。</p></div></body>',
        { url: 'https://laws.gov.taipei/Law/LawSearch/LawArticleContent/FL039973',
          runScripts: 'outside-only', pretendToBeVisual: true });
      return d;
    };

    // 三個條號同時滑過，全文只該下載一次
    const d1 = mk();
    const calls = [];
    d1.window.fetch = u => { calls.push(String(u)); return new Promise(() => {}); };
    d1.window.eval(code);
    const marks = [...d1.window.document.querySelectorAll('[data-flno]')];
    ok('標記到三個條號', marks.length === 3, '標記 ' + marks.length + ' 處');
    marks.forEach(m => m.dispatchEvent(
      new d1.window.MouseEvent('mouseover', { bubbles: true })));
    await sleep(600);
    ok('三個條號共用一次全文下載',
       calls.length === 1, '請求 ' + calls.length + ' 次：' + calls.join(', '));

    // 失敗後不能被去重機制卡住，必須能重試
    const d2 = mk();
    let n = 0;
    d2.window.fetch = () => { n++; return Promise.reject(new Error('網路失敗')); };
    d2.window.eval(code);
    const m2 = d2.window.document.querySelector('[data-flno]');
    m2.dispatchEvent(new d2.window.MouseEvent('mouseover', { bubbles: true }));
    await sleep(500);
    const first = n;
    m2.dispatchEvent(new d2.window.MouseEvent('mouseout', { bubbles: true }));
    m2.dispatchEvent(new d2.window.MouseEvent('mouseover', { bubbles: true }));
    await sleep(500);
    ok('下載失敗後仍可重試（未被去重卡住）', n > first,
       '首次 ' + first + ' 次，重試後 ' + n + ' 次');
  }

  console.log('\n\x1b[1m不支援的網站只提示、不掃描\x1b[0m');
  for (const site of ['https://www.google.com/search?q=%E5%BB%BA%E7%AF%89%E6%B3%95',
                      'https://zh.wikipedia.org/wiki/建築法',
                      'https://example.com/doc.html']) {
    const d = new JSDOM(
      '<body><p>依建築法第77條之2規定，及民法第184條、刑法第10條</p></body>',
      { url: site, runScripts: 'outside-only', pretendToBeVisual: true });
    let calls = 0;
    d.window.fetch = () => { calls++; return Promise.resolve(
      { ok: false, status: 404, text: () => Promise.resolve('') }); };
    d.window.eval(code);
    const host = new d.window.URL(site).hostname;
    const marked = d.window.document.querySelectorAll('[data-flno],[data-ex],[data-lh-head]').length;
    ok(host + ' 不標記任何引用', marked === 0, '標記 ' + marked + ' 處');
    ok(host + ' 不發出任何連線', calls === 0, '連線 ' + calls + ' 次');
    ok(host + ' 顯示不支援提示',
       d.window.document.body.textContent.includes('本工具僅在法規網站上運作'));
  }

  /* 提示要如實列出支援範圍，否則其他縣市的使用者會誤以為自己的縣市不能用。 */
  {
    const d = new JSDOM('<body><p>建築法第7條</p></body>',
      { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
    d.window.fetch = () => Promise.resolve(
      { ok: false, status: 404, text: () => Promise.resolve('') });
    d.window.eval(code);
    const t = d.window.document.body.textContent;
    ok('提示涵蓋地方法規而非只講臺北市',
       t.includes('22 縣市'), t.match(/目前支援：[^]{0,50}/) || '');
  }

  console.log('\n\x1b[1m法規名左邊界（字典）\x1b[0m');
  {
    const cut = [
      ['違反兒童及少年性剝削防制條例第三十一條之罪', '兒童及少年性剝削防制條例'],
      ['但應受民事訴訟法第四百六十六條之限制', '民事訴訟法'],
      ['承租人違反民法第四百四十三條之規定', '民法'],
      ['不得行使民法第四百四十五條之權利', '民法'],
      ['依家庭暴力防治法第十四條規定', '家庭暴力防治法'],
      ['觸犯毒品危害防制條例第四條之罪', '毒品危害防制條例']
    ];
    for (const [text, want] of cut) {
      const d = new JSDOM(
        `<body><h2 id="hlLawName">刑事訴訟法</h2><p>${text}</p></body>`,
        { url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=C0010001',
          runScripts: 'outside-only', pretendToBeVisual: true });
      d.window.fetch = () => Promise.resolve(
        { ok: false, status: 404, text: () => Promise.resolve('') });
      d.window.eval(code);
      const got = [...d.window.document.querySelectorAll('[data-flno]')]
        .map(x => x.dataset.name);
      ok('「' + text.slice(0, 12) + '…」→ ' + want,
         got.indexOf(want) >= 0, got.join('/') || '（無）');
    }
  }

  /* 以下各段皆為 review 對已出貨程式碼實測找到的錯誤資料。
   * 共用：建立指定網址的頁面、以路由函式回應 fetch、讀取目前可見的面板文字。 */
  const site = (html, url, route) => {
    const d = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = d.window;
    w.__calls = [];
    w.fetch = u => {
      w.__calls.push(String(u));
      const body = route(decodeURIComponent(String(u)));
      return Promise.resolve(body == null
        ? { ok: false, status: 404, text: () => Promise.resolve('') }
        : { ok: true, status: 200, text: () => Promise.resolve(body) });
    };
    w.eval(code);
    return w;
  };
  const panelOf = w => {
    const p = [...w.document.body.children].find(x => {
      const c = String(x.className || '').split(' ');
      return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(y => /-hide$/.test(y));
    });
    return p ? p.textContent.replace(/\s+/g, ' ') : '';
  };
  const hoverOn = async (w, el, ms) => {
    if (!el) return '（找不到標記）';
    el.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(ms || 400);
    return panelOf(w);
  };
  const MOJ = pc => 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=' + pc;
  // 只回應沿革頁，其餘一律 404
  const histSite = (pc, file, url, body) => site(
    '<!DOCTYPE html><html><head><title>主管法規共用系統-法規內容-測試辦法</title></head><body>' +
    '<h2 id="hlLawName">X</h2>' + (body || '') + '</body></html>',
    url || MOJ(pc), u => /LawHistory|LawContentSource/.test(u) ? F(file) : null);
  const whensOf = async (pc, file, url) => {
    const w = histSite(pc, file, url);
    const h = await w.__lawhover__.hist(pc);
    return { h, w, at: fl => w.__lawhover__.histFor(h, fl).map(r => r.when) };
  };

  console.log('\n\x1b[1m沿革條號清單的解析（review 以真實沿革頁實測）\x1b[0m');
  {
    const xf = await whensOf('C0000001', 'history-C0000001.html');
    ok('範圍「74～75-1」涵蓋第 75 條（98 年修正）',
       xf.at('75').includes('九十八年六月十日'), xf.at('75').join('、'));
    ok('範圍「74～75-1」涵蓋第 74-1 條', xf.at('74-1').includes('九十八年六月十日'),
       xf.at('74-1').join('、'));
    ok('範圍上界依之號比較：75-2 不在「74～75-1」內',
       !xf.at('75-2').includes('九十八年六月十日'), xf.at('75-2').join('、'));
    ok('範圍「358～363」涵蓋端點第 358 條（92 年增訂）',
       xf.at('358').includes('九十二年六月二十五日'), xf.at('358').join('、'));
    ok('範圍「358～363」涵蓋中間的第 360 條',
       xf.at('360').includes('九十二年六月二十五日'), xf.at('360').join('、'));
    ok('範圍外的第 364 條不被算入「358～363」',
       !xf.at('364').includes('九十二年六月二十五日'), xf.at('364').join('、'));
    ok('跨行斷開的「334↵-1」不誤判為第 334 條',
       !xf.at('334').includes('九十一年一月三十日'), xf.at('334').join('、'));
    ok('跨行斷開的「334↵-1」歸給第 334-1 條',
       xf.at('334-1').includes('九十一年一月三十日'), xf.at('334-1').join('、'));
    ok('解析出的條號清單不含斷行殘片「-1」',
       !xf.h.list.some(r => r.arts.some(a => !/^\d+(-\d+)?$/.test(a))),
       JSON.stringify(xf.h.list.map(r => r.arts.filter(a => !/^\d+(-\d+)?$/.test(a))).flat()));
    const t1935 = xf.h.list.find(r => /二十四年一月一日/.test(r.when));
    ok('最後一筆沿革不吃進頁尾文字', t1935 && !/最新訊息|中央法規/.test(t1935.text),
       t1935 && t1935.text.slice(-40));

    const mf = await whensOf('B0000001', 'history-B0000001.html');
    ok('斷在數字中間的「78↵4～790」歸給第 784、785 條',
       mf.at('785').includes('九十八年一月二十三日'), mf.at('785').join('、'));
    // 換行也可能吃掉頓號：「刪除第 986、987、993↵994 條」是兩條，不能接成 993994
    ok('換行取代頓號時拆成兩條（「993↵994」）',
       mf.at('993').includes('八十七年六月十七日') && mf.at('994').includes('八十七年六月十七日'),
       mf.at('993').join('、') + ' / ' + mf.at('994').join('、'));
    ok('斷在數字中間的「1↵055-2」歸給第 1055-2 條，不產生第 1 條',
       mf.at('1055-2').includes('八十五年九月二十五日') && !mf.at('1').includes('八十五年九月二十五日'),
       mf.at('1055-2').join('、') + ' / ' + mf.at('1').join('、'));
    ok('長條號清單不截斷：第 749 條見於 88 年 4 月債編修正',
       mf.at('749').includes('八十八年四月二十一日'), mf.at('749').join('、'));
    ok('長條號清單不截斷：清單尾端的第 756-9 條也找得到',
       mf.at('756-9').includes('八十八年四月二十一日'), mf.at('756-9').join('、'));
  }

  console.log('\n\x1b[1m條號排版不明確時不猜（codex review 反例）\x1b[0m');
  {
    // 合成的中央站沿革頁：第 2 筆的條號清單在原站折行處無法判斷是拆開還是接起來
    const page = rows => '<html><body>' + rows.map(r => '<div class="row"><div class="col-data text-pre">' + r +
      '</div></div>\n').join('') + '</body></html>';
    const histHtml = async (html, heads) => {
      const w = site('<!DOCTYPE html><html><body><h2 id="hlLawName">X</h2>' + (heads || '') + '</body></html>',
        MOJ('Z0000001'), u => /LawHistory/.test(u) ? html : null);
      const h = await w.__lawhover__.hist('Z0000001');
      return { w, h, named: fl => w.__lawhover__.histFor(h, fl).filter(r => !r.whole).map(r => r.when) };
    };
    const A = '一百十年一月一日', B = '一百十一年二月二日';
    const hp = page([
      '3. 中華民國' + B + '總統令修正公布第 74～75\n    80 條條文',
      '2. 中華民國' + A + '總統令修正公布第 10、11\n    12 條條文',
      '1. 中華民國一百年一月一日總統令制定公布全文 1200 條']);
    const x = await histHtml(hp, '<div class="col-no">第 1112 條</div><div class="col-no">第 12 條</div>');
    ok('「10、11↵12」不把第 1112 條當成修正過', !x.named('1112').includes(A), x.named('1112').join('、'));
    ok('「10、11↵12」拆接兩可時，第 12 條也不算確定修正', !x.named('12').includes(A), x.named('12').join('、'));
    // 「11↵12」整組兩可（11、12 或 1112），只有第 10 條確定
    ok('同一清單中確定的條號照常計入（第 10 條），兩可那組的第 11 條不算',
       x.named('10').includes(A) && !x.named('11').includes(A), x.named('10') + ' / ' + x.named('11'));
    ok('「74～75↵80」不把範圍延伸成 74～7580（第 100 條）', !x.named('100').includes(B), x.named('100').join('、'));
    await sleep(300);
    const t12 = await hoverOn(x.w, x.w.document.querySelector('[data-lh-head="12"]'));
    ok('排版不明確的紀錄另行說明，不計入修正次數',
       /無法確認/.test(t12) && /一百十年一月一日/.test(t12) && !/本條個別修正/.test(t12), t12.slice(0, 140));
    const h1112 = x.w.document.querySelector('[data-lh-head="1112"]');
    ok('排版不明確的紀錄不讓條號標題標成修正過', h1112 && !h1112.dataset.lhMod, h1112 && h1112.getAttribute('title'));

    /* 一組內有多個斷行時，每個斷行都可能是接或拆（2^k 種讀法），
     * 不能只比「全部接」與「全部拆」：「1↵0↵55」可讀成 1055，也可讀成 10、55。 */
    const C = '一百十二年三月三日';
    const y = await histHtml(page(['1. 中華民國' + C + '總統令修正公布第 1\n    0\n    55 條條文']));
    ok('「1↵0↵55」兩種讀法都成立時不當成第 1055 條', !y.named('1055').includes(C), y.named('1055').join('、'));
    ok('「1↵0↵55」兩種讀法都成立時第 10、55 條也不算確定',
       !y.named('10').includes(C) && !y.named('55').includes(C), y.named('10') + ' / ' + y.named('55'));
    ok('「1↵0↵55」列為不確定、交由面板說明',
       y.h.list.length === 1 && !!y.h.list[0].unsure, JSON.stringify(y.h.list[0] && y.h.list[0].unsure));
    // 只有一種讀法成立時照常採用：「1↵05↵5」的「05」不能單獨成條，唯一讀法是 1055
    const y2 = await histHtml(page(['1. 中華民國' + C + '總統令修正公布第 1\n    05\n    5 條條文']));
    ok('唯一成立的讀法照常採用（「1↵05↵5」→ 1055）', y2.named('1055').includes(C), y2.named('1055').join('、'));

    // 全形數字的日期：不能因年份是全形而整筆漏掉
    const fw = await histHtml(page(['1. 中華民國１１５年１月１日令修正第 4 條']));
    ok('全形數字年份的沿革條目照常解析', fw.named('4').length === 1 && /115/.test(fw.named('4')[0] || ''),
       fw.h.list.length + ' 筆：' + fw.named('4').join('、'));
  }

  console.log('\n\x1b[1m制定與全文修正分開陳述\x1b[0m');
  {
    // 刑法第 13 條自 24 年制定後未曾修正，沿革只有制定公布那一筆
    const w = histSite('C0000001', 'history-C0000001.html', null,
      '<div class="col-no">第 13 條</div><div class="col-no">第 75 條</div>');
    await sleep(300);
    const head = w.document.querySelector('[data-lh-head="13"]');
    ok('只有制定紀錄的條號，標題提示不說「全文修正」',
       head && !/全文修正/.test(head.getAttribute('title') || ''), head && head.getAttribute('title'));
    const t = await hoverOn(w, head);
    ok('只有制定紀錄的條號，沿革面板標為制定而非全文修正',
       /（制定）/.test(t) && !/（全文修正）|僅隨全文修正/.test(t), t.slice(0, 90));
    const t75 = await hoverOn(w, w.document.querySelector('[data-lh-head="75"]'));
    ok('個別修正過的條號，制定紀錄標為制定', /本條個別修正 \d+ 次/.test(t75) && /（制定）/.test(t75) &&
       !/全文修正/.test(t75), t75.slice(0, 120));

    // 建築法有兩次修正公布全文、一次制定公布：第 9 條只隨這三筆異動
    const wb = histSite('D0070109', 'history-D0070109.html', null,
      '<div class="col-no">第 9 條</div><div class="col-no">第 78 條</div>');
    await sleep(300);
    const t9 = await hoverOn(wb, wb.document.querySelector('[data-lh-head="9"]'));
    ok('修正公布全文仍稱全文修正，制定另計（建築法第 9 條）',
       /全文修正異動 2 次/.test(t9) && /（制定）/.test(t9), t9.slice(0, 120));
    // 第 78 條在 73 年「76～78」的範圍內，先前被誤報為未個別修正
    const t78 = await hoverOn(wb, wb.document.querySelector('[data-lh-head="78"]'));
    ok('範圍「76～78」涵蓋建築法第 78 條', /本條個別修正 1 次/.test(t78) && /七十三年十一月七日/.test(t78),
       t78.slice(0, 120));
  }

  console.log('\n\x1b[1m地方法規沿革（以 <br> 分隔的條目）\x1b[0m');
  {
    const kf = await whensOf('GL000080', 'history-glrs-kcg.html',
      'https://outlaw.kcg.gov.tw/LawContent.aspx?id=GL000080');
    ok('無編號、以 <br> 分隔的沿革逐筆解析（高雄）', kf.h.list.length === 2,
       kf.h.list.length + ' 筆：' + kf.h.list.map(r => r.text.slice(0, 30)).join(' | '));
    ok('高雄沿革反查第 4 條的修正', kf.at('4').includes('102年1月10日'), kf.at('4').join('、'));
    const tf = await whensOf('GL000050', 'history-glrs-tycg.html',
      'https://law.tycg.gov.tw/LawContent.aspx?id=GL000050');
    const raw = (F('history-glrs-tycg.html').match(/\d+\.中華民國/g) || []).length;
    ok('有編號但以 <br> 分隔的沿革不黏成一筆（桃園）', raw > 1 && tf.h.list.length === raw,
       '解析 ' + tf.h.list.length + ' 筆，原始 ' + raw + ' 筆');
  }

  console.log('\n\x1b[1m司法院解釋的字號驗證\x1b[0m');
  {
    const page = '<body><h2 id="hlLawName">建築法</h2>' +
      '<p>參照司法院釋字第7號及釋字第77號，並依114年憲判字第6號與115年憲判字第6號判決。</p></body>';
    const list = (jy) => '<a href="/LawClass/ExContent.aspx?ty=CJ&amp;JC=CJ00009709&amp;JNO=6&amp;JYEAR=' +
      jy + '&amp;JCASE=憲判">x</a>';
    const route = jy => u => /ty=C&CC=D&CNO=/.test(u) ? F('explain-C-77.html')
      : /LawSearchJudge/.test(u) ? list(jy)
      : /ty=CJ/.test(u) ? F('explain-CJ-115-6.html') : null;
    const pick = (w, kind, no, yr) => [...w.document.querySelectorAll('[data-ex]')]
      .find(m => m.dataset.ex === kind && m.dataset.exno === no && (!yr || m.dataset.exyear === yr));

    let w = site(page, MOJ('D0070109'), route('115'));
    let t = await hoverOn(w, pick(w, 'C', '7'));
    ok('釋字第 7 號不接受第 77 號的內容（號碼須完全相同）',
       !/釋字第 77 號/.test(t) && /查不到/.test(t), t.slice(0, 80));
    w = site(page, MOJ('D0070109'), route('115'));
    t = await hoverOn(w, pick(w, 'C', '77'));
    ok('釋字第 77 號正常顯示', /釋字第 77 號/.test(t) && !/查不到/.test(t), t.slice(0, 80));

    w = site(page, MOJ('D0070109'), route('114'));
    t = await hoverOn(w, pick(w, 'CJ', '6', '114'));
    ok('憲判字驗證年度：114 年第 6 號不接受 115 年的判決',
       !/115 年憲判字第 6 號/.test(t) && /查不到/.test(t), t.slice(0, 80));
    w = site(page, MOJ('D0070109'), route('115'));
    t = await hoverOn(w, pick(w, 'CJ', '6', '115'));
    ok('115 年憲判字第 6 號正常顯示', /115 年憲判字第 6 號/.test(t) && !/查不到/.test(t), t.slice(0, 80));

    // 同一則解釋在回應前連續滑過兩次，只該請求一次
    w = site(page, MOJ('D0070109'), () => null);
    w.fetch = u => { w.__calls.push(String(u)); return new Promise(() => {}); };
    const m7 = pick(w, 'C', '77');
    m7.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    m7.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true }));
    m7.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(200);
    ok('同一則解釋並發滑過只請求一次', w.__calls.length === 1, w.__calls.length + ' 次');
  }

  console.log('\n\x1b[1m全文切條：只認條首標題，不認條文內的引用\x1b[0m');
  {
    const GL = 'https://glrs.nantou.gov.tw/LawContent.aspx?id=GL000001';
    const doc = inner => '<!DOCTYPE html><html><head><title>南投縣政府主管法規共用系統-法規內容-南投縣測試自治條例</title></head>' +
      '<body><div id="ctl00_cp_content_divLawContent08" class="ClearCss">' + inner + '</div></body></html>';
    /* 書籤所在頁只放引用，滑過後取回的全文才是受測對象。
     * 條號標題常是 3 字的獨立文字節點（「第1條」），短於掃描門檻不會被標記，
     * 所以不能拿全文頁自己的標題來滑。 */
    const cite = '<!DOCTYPE html><html><head><title>南投縣政府主管法規共用系統-法規內容-南投縣測試自治條例</title></head>' +
      '<body><p>依第1條、第2條、第5條、第一百零四條、第一百零五條、第一百零六條規定辦理。</p></body></html>';
    const art = async (html, fl, url) => {
      const w = site(cite, url || GL, () => html);
      return hoverOn(w, [...w.document.querySelectorAll('[data-flno]')].find(m => m.dataset.flno === fl));
    };
    for (const [label, inner] of [
      ['以 <br> 分行', '第1條<br>應依第2條規定申請。<br>第2條<br>真正的第二條內容。'],
      ['以換行字元分行', '第1條\n應依第2條規定申請。\n第2條\n真正的第二條內容。'],
      ['條號在 <strong> 內、本文同行', '<strong>第1條</strong>&nbsp;應依第2條規定申請。<br>' +
        '<strong>第2條</strong>&nbsp;真正的第二條內容。'],
      ['標題寫法混用（<strong> 與純文字）', '<strong>第1條</strong>&nbsp;應依第2條規定申請。<br>' +
        '第2條　真正的第二條內容。'],
    ]) {
      const html = doc(inner);
      const t2 = await art(html, '2');
      ok('全文切條（' + label + '）：第 2 條取到真正的第 2 條', /真正的第二條內容/.test(t2) && !/規定申請/.test(t2),
         t2.slice(0, 80));
      const t1 = await art(html, '1');
      ok('全文切條（' + label + '）：第 1 條本文完整', /應依第2條規定申請/.test(t1), t1.slice(0, 80));
    }
    // 條號後不接空白的標題仍要認得（codex review 反例）
    const ns = doc('第1條 甲。<br>第2條乙。<br>第3條 丙。');
    let tn = await art(ns, '1');
    ok('標題後無空白：第 1 條不吞進第 2 條', /甲。/.test(tn) && !/乙/.test(tn), tn.slice(0, 60));
    tn = await art(ns, '2');
    ok('標題後無空白：第 2 條取到「乙。」', /乙。/.test(tn) && !/甲|丙/.test(tn), tn.slice(0, 60));

    /* 位在行首、整個元素就是條號的粗體，不一定是標題（codex review 反例）。
     * 同號候選有兩個時無從判斷，寧可查不到，也不能顯示引用後面的那段文字。 */
    const dup = doc('<strong>第一百零四條</strong><br><p><strong>第一百零五條</strong>所定之申請事項，依本條辦理。</p>' +
      '<br><strong>第一百零五條</strong>　真正第一百零五條內容。');
    const d105 = await art(dup, '105');
    ok('同號候選不明確時不顯示引用後的文字（第 105 條）', !/所定之申請事項/.test(d105) && /查不到/.test(d105),
       d105.slice(0, 80));
    const d104 = await art(dup, '104');
    ok('分界不明確時第 104 條不顯示混入的內容', !/所定之申請事項/.test(d104) && /查不到/.test(d104),
       d104.slice(0, 80));

    // 區塊元素的結尾也是分界：<p> 之後緊接的文字另起一行（codex review 第三輪反例）
    const blk = doc('<p>第1條 甲。</p>第2條 乙。<p>第3條 丙。</p>');
    let tb = await art(blk, '1');
    ok('區塊結尾也是分界：第 1 條不吞進其後的第 2 條', /甲。/.test(tb) && !/乙/.test(tb), tb.slice(0, 60));
    tb = await art(blk, '2');
    ok('區塊結尾也是分界：第 2 條取到「乙。」', /乙。/.test(tb) && !/甲|丙/.test(tb), tb.slice(0, 60));

    /* 分界改以「已知的行內元素以外一律是分界」判定，不逐一列舉區塊元素（codex review 第四輪反例：<section>）。 */
    const sec = doc('<section>第1條 甲。</section>第2條 乙。<section>第3條 丙。</section>');
    let tsec = await art(sec, '1');
    ok('非行內元素（<section>）的進出都是分界：第 1 條只到「甲。」', /甲。/.test(tsec) && !/乙|丙/.test(tsec), tsec.slice(0, 60));
    tsec = await art(sec, '2');
    ok('非行內元素（<section>）之後的第 2 條取到「乙。」', /乙。/.test(tsec) && !/甲|丙/.test(tsec), tsec.slice(0, 60));

    /* 標題比對不可吃掉其後的換行，否則下一行的標題失去行首而被併入前一條（codex review 第四輪反例）。 */
    const nob = doc('第1條\n第2條 乙。\n第3條 丙。');
    const tnb = await art(nob, '1');
    ok('沒有本文的第 1 條不把第 2 條當成本文', !/乙/.test(tnb) && /查不到/.test(tnb), tnb.slice(0, 60));
    const tnb2 = await art(nob, '2');
    ok('緊接在無本文標題後的第 2 條照常取得', /乙。/.test(tnb2) && !/丙/.test(tnb2), tnb2.slice(0, 60));

    /* 順序規則：條號沿頁面必須嚴格遞增（codex review 第五輪反例）。
     * 表格儲存格自成一行，裡面的「第一百零五條」看起來像標題；它夾在第一條與第二條之間，
     * 只靠順序無法判斷 {一、一百零五} 與 {一、二} 哪個才是標題序列，相關各條一律拒答。 */
    const tbl5 = '第一條 本辦法之法令依據如下：\n<table><tr><td>民法</td><td>第一百零五條</td><td>意思表示效力。</td></tr></table>' +
      '\n依上表規定辦理。<br>\n第二條 本辦法自發布日施行。\n';
    const ord = doc(tbl5);
    const o105 = await art(ord, '105');
    ok('表格內的條號不當標題：第 105 條拒答', /查不到/.test(o105) && !/意思表示效力/.test(o105), o105.slice(0, 80));
    const o1 = await art(ord, '1');
    ok('順序不明確時第 1 條拒答，不顯示截斷的本文', /查不到/.test(o1) && !/本辦法之法令依據/.test(o1), o1.slice(0, 80));
    // 對照：同樣有表格，但表格內沒有條號，順序明確，第 1 條完整含表格、第 2 條照常
    const ctl = doc(tbl5.replace('第一百零五條', '意思表示'));
    const c1 = await art(ctl, '1');
    ok('對照：順序明確時第 1 條完整顯示（含表格與表後文字）',
       /法令依據/.test(c1) && /民法/.test(c1) && /依上表規定辦理/.test(c1) && !/自發布日施行/.test(c1), c1.slice(0, 100));
    const c2 = await art(ctl, '2');
    ok('對照：順序明確時第 2 條照常顯示', /自發布日施行/.test(c2) && !/民法/.test(c2), c2.slice(0, 80));
    // 對照：條號遞增但跳號（中間條文已刪除未列），仍是唯一的遞增序列，照常顯示
    const gap = doc('第一條 甲。<br>第三條 丙。<br>第三條之一 丙一。<br>第五條 戊。');
    const g3 = await art(gap, '5');
    ok('對照：跳號但遞增的標題照常顯示（第 5 條）', /戊。/.test(g3) && !/丙/.test(g3), g3.slice(0, 60));

    /* 同號候選有兩個時，兩者都不能當分界：前一條的結尾因此也不確定（codex review 第三輪反例）。
     * 第 104 條只顯示「甲。」會漏掉可能屬於它的後半段。 */
    const dup2 = doc('<strong>第一百零四條</strong><br>甲。\n<p><strong>第一百零五條</strong> 所定之申請事項，依本條辦理。</p>' +
      '\n<br><strong>第一百零五條</strong>　真正第一百零五條內容。<br><strong>第一百零六條</strong> 丁。');
    const e104 = await art(dup2, '104');
    ok('同號候選旁的前一條也拒答（第 104 條）', /查不到/.test(e104) && !/甲。/.test(e104), e104.slice(0, 80));
    const e105 = await art(dup2, '105');
    ok('同號候選本身拒答（第 105 條）', /查不到/.test(e105) && !/所定之|真正/.test(e105), e105.slice(0, 80));
    const e106 = await art(dup2, '106');
    ok('同號候選之後、分界明確的第 106 條照常顯示', /丁。/.test(e106) && !/真正/.test(e106), e106.slice(0, 80));

    const kcg = F('whole-glrs-kcg.html');
    const tk = await art(kcg, '2', 'https://outlaw.kcg.gov.tw/LawContent.aspx?id=GL000080');
    ok('真實全文頁（高雄）第二條', /本辦法之主管機關為本府都市發展局/.test(tk) && !/特訂定本辦法/.test(tk),
       tk.slice(0, 80));

    console.log('\n\x1b[1m中文條號含「零」\x1b[0m');
    const row = (h, b) => '<tr><td class="th" scope="row">' + h + '</td><td><div class="ClearCss"><div>' +
      b + '</div></div></td></tr>';
    const tbl = '<!DOCTYPE html><html><head><title>南投縣政府主管法規共用系統-法規內容-南投縣測試自治條例</title></head><body>' +
      '<table id="ctl00_cp_content_tableLawArticleBasic">' + row('第一百零四條', '違反第一百零五條規定者，處罰之。') +
      row('第一百零五條', '第一百零五條的條文內容。') + row('第一百十五條', '違反第一百十五條規定者亦同。') +
      '</table></body></html>';
    const wt = site(tbl, GL, () => tbl);
    ok('「第一百零五條」等中文條號標題全部標記', wt.document.querySelectorAll('[data-lh-head]').length === 3,
       '標記 ' + wt.document.querySelectorAll('[data-lh-head]').length + ' 個：' +
       [...wt.document.querySelectorAll('[data-lh-head]')].map(e => e.dataset.lhHead).join('、'));
    ok('「第一百零五條」標題的條號為 105',
       !!wt.document.querySelector('[data-lh-head="105"]'));
    const t105 = await art(tbl, '105');
    ok('表格模式取得第一百零五條', /第一百零五條的條文內容/.test(t105) && !/處罰之/.test(t105), t105.slice(0, 80));
    const blob = doc('第一百零四條<br>違反第一百零五條規定者，處罰之。<br>第一百零五條<br>零號條文的內容。');
    const t104 = await art(blob, '104');
    ok('全文模式第一百零四條不吞進第一百零五條', /處罰之/.test(t104) && !/條文內容|零號/.test(t104), t104.slice(0, 80));
    const t105b = await art(blob, '105');
    ok('全文模式取得第一百零五條', /零號條文的內容/.test(t105b), t105b.slice(0, 80));
    /* 條文本身以自己的條號起頭（「第一百零五條的條文內容」）時，行首出現兩個同號候選，
     * 與引用折到行首無從區分，依「查不到比查錯安全」拒答。 */
    const self = doc('第一百零四條<br>處罰之。<br>第一百零五條<br>第一百零五條的條文內容。');
    const s105 = await art(self, '105');
    ok('條文以自身條號起頭、同號候選兩個時拒答', /查不到/.test(s105) && !/條文內容/.test(s105), s105.slice(0, 80));
    // 同一情形改用單一換行字元分行（前一條標題吃掉換行時，第二個候選會失去行首而漏判）
    const selfn = await art(doc('第一百零四條\n處罰之。\n第一百零五條\n第一百零五條的條文內容。'), '105');
    ok('條文以自身條號起頭（換行字元分行）時同樣拒答', /查不到/.test(selfn) && !/條文內容/.test(selfn), selfn.slice(0, 80));
  }

  /* 以下各段為 0d95fdf 之後 review 實測找到的錯誤，每段都先寫成失敗的測試再修。 */
  const marksOf = w => [...w.document.querySelectorAll('[data-flno],[data-ex]')];
  const descr = m => m.textContent + '→' + m.dataset.name + ' ' + m.dataset.flno + (m.dataset.pcode ? '[本頁]' : '');
  const pageOf = (law, pc, html) => site('<body><h2 id="hlLawName">' + law + '</h2>' + html + '</body>', MOJ(pc), () => null);

  console.log('\n\x1b[1m外國法規前綴（review 發現）\x1b[0m');
  {
    /* 國名前綴原本只擋「刑法」「憲法」「民法」，其他字典法規名直接取字尾：
     * 「依日本民事訴訟法第一條」被標成我國民事訴訟法第一條。 */
    let w = pageOf('刑事訴訟法', 'C0010001', '<p>依日本民事訴訟法第一條規定辦理。</p>');
    let ms = marksOf(w);
    ok('「日本民事訴訟法」不被當成我國民事訴訟法', !ms.some(m => m.dataset.name === '民事訴訟法'),
       ms.map(descr).join(' / ') || '（無）');
    w = pageOf('刑事訴訟法', 'C0010001', '<p>依德國行政程序法第五條規定。</p>');
    ms = marksOf(w);
    ok('「德國行政程序法」不被當成我國行政程序法', !ms.some(m => m.dataset.name === '行政程序法'),
       ms.map(descr).join(' / ') || '（無）');
    /* 字典名稱以「本法」結尾（教育基本法）時，國名前綴不可讓它退化成自指詞「本法」而綁本頁 */
    w = pageOf('刑事訴訟法', 'C0010001', '<p>參照日本教育基本法第一條規定。</p>');
    ms = marksOf(w);
    ok('「日本教育基本法」不被當成我國教育基本法，也不綁本頁',
       !ms.some(m => m.dataset.name === '教育基本法' || m.dataset.pcode), ms.map(descr).join(' / ') || '（無）');
    // 6751e1f 的豁免：我國、本國、中華民國
    for (const pre of ['我國', '本國', '中華民國']) {
      w = pageOf('刑事訴訟法', 'C0010001', '<p>依' + pre + '民事訴訟法第一條規定辦理。</p>');
      ms = marksOf(w);
      ok('「' + pre + '民事訴訟法」仍是我國民事訴訟法', ms.some(m => m.dataset.name === '民事訴訟法' && m.dataset.flno === '1'),
         ms.map(descr).join(' / ') || '（無）');
    }
    w = pageOf('刑事訴訟法', 'C0010001', '<p>依民事訴訟法第一條規定辦理。</p>');
    ms = marksOf(w);
    ok('沒有國名前綴時照常標記', ms.some(m => m.dataset.name === '民事訴訟法'), ms.map(descr).join(' / ') || '（無）');
  }

  console.log('\n\x1b[1m新北市本頁法規的具名引用（review 發現）\x1b[0m');
  {
    /* 新北市網址用 fcode= 而非 pcode=；原本只認 pcode，具名引用本頁法規時一律回「本站不支援跨法規查詢」。 */
    const NT = 'https://web.law.ntpc.gov.tw/Scripts/FLAWDAT0202.aspx?fcode=F0001';
    const page = '<!DOCTYPE html><html><head><title>新北市道路管理自治條例</title></head><body>' +
      '<h2>新北市道路管理自治條例</h2><table><tr><td class="col-th">第 5 條</td>' +
      '<td class="col-td">本條例所稱道路，指供公眾通行之道路。</td></tr></table>' +
      '<p>違反新北市道路管理自治條例第五條規定者。</p>' +
      '<p>依新北市道路管理自治條例施行細則第五條辦理。</p></body></html>';
    const w = site(page, NT, u => /FLAWDAT0202\.aspx\?fcode=F0001/.test(u) ? page : null);
    const named = marksOf(w).find(m => m.dataset.name === '新北市道路管理自治條例');
    const txt = await hoverOn(w, named);
    ok('具名引用本頁法規時取得本頁條文', /本條例所稱道路/.test(txt) && !/不支援/.test(txt), txt.slice(0, 60));
    const other = marksOf(w).find(m => m.dataset.name === '新北市道路管理自治條例施行細則');
    const t2 = await hoverOn(w, other);
    ok('名稱只是包含本頁法規名時不當成本頁', !/本條例所稱道路/.test(t2) && /查不到/.test(t2), t2.slice(0, 60));
  }

  console.log('\n\x1b[1m具名規則放棄的範圍不吞前面的裸條號（review 發現）\x1b[0m');
  {
    /* 「所定辦法第三條」的「辦法」是泛稱，查不到；但原本放棄範圍涵蓋整段比對，
     * 前面的「第五條」「第六條」也一併不標。 */
    const cases = [
      ['違反第五條或依第六條所定辦法第三條規定者，處罰之。', ['第五條→建築法 5[本頁]', '第六條→建築法 6[本頁]']],
      ['依第五條規定之辦法第三條辦理。', ['第五條→建築法 5[本頁]']],
      // 之X 條號也是左邊界：原本切成「一所定辦法」，第五條之一整個不見
      ['依第五條之一所定辦法第三條辦理。', ['第五條之一→建築法 5-1[本頁]']],
      ['依第五條第二項所定辦法第三條辦理。', ['第五條第二項→建築法 5[本頁]']],
    ];
    for (const [txt, want] of cases) {
      const got = marksOf(pageOf('建築法', 'D0070109', '<p>' + txt + '</p>')).map(descr);
      ok('「' + txt.slice(0, 16) + '…」標記 ' + want.join('、'), JSON.stringify(got) === JSON.stringify(want),
         got.join(' / ') || '（無）');
    }
  }

  console.log('\n\x1b[1m面板關閉後，查詢結果不可再開啟面板（review 發現）\x1b[0m');
  {
    /* 滑出標記後面板已關，慢回來的查詢結果（成功或 404）把面板重新打開，
     * 顯示「查不到條文」且不會再自動關閉。 */
    for (const ok200 of [false, true]) {
      const d = new JSDOM('<body><h2 id="hlLawName">建築法</h2><p>依第77條之2規定辦理。</p></body>',
        { url: MOJ('D0070109'), runScripts: 'outside-only', pretendToBeVisual: true });
      const w = d.window;
      w.fetch = () => new Promise(r => setTimeout(() => r(ok200
        ? { ok: true, status: 200, text: () => Promise.resolve(F('single-77-2.html')) }
        : { ok: false, status: 404, text: () => Promise.resolve('') }), 500));
      w.eval(code);
      const mk = w.document.querySelector('[data-flno]');
      mk.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
      await sleep(30);
      mk.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true }));
      await sleep(900);
      const p = panelOf(w);
      ok('滑出後慢回來的' + (ok200 ? '條文' : '404') + '不重開面板', p === '', p.slice(0, 40));
    }
  }

  console.log('\n\x1b[1m回報表單保留使用者的修改（review 發現）\x1b[0m');
  {
    const w = pageOf('建築法', 'D0070109', '<p>依第5條規定。</p>');
    const fab = [...w.document.body.children].find(n => /-fab$/.test(String(n.className || '').split(' ')[0]));
    fab.click();
    const dlg = [...w.document.body.children].find(n => /-dlg$/.test(String(n.className || '').split(' ')[0]));
    const diag = dlg && dlg.querySelectorAll('textarea')[1];
    const opts = dlg ? [...dlg.querySelectorAll('[class*="-opt"]')] : [];
    ok('回報對話框帶入診斷資訊', diag && /網址: /.test(diag.value), diag && diag.value.slice(0, 40));
    if (diag && opts.length === 2) {
      diag.value = '（使用者刪掉網址與瀏覽器）';
      opts[0].click();
      ok('選問題類型不覆蓋使用者改過的診斷資訊', diag.value === '（使用者刪掉網址與瀏覽器）', diag.value.slice(0, 40));
      opts[1].click();
      ok('改選另一種類型也不覆蓋', diag.value === '（使用者刪掉網址與瀏覽器）', diag.value.slice(0, 40));
      /* jsdom 沒有剪貼簿，複製必定失敗：整份內容改放到另一個框讓使用者手動選取，
       * 診斷框保留使用者的修改，之後的輸出也以使用者當下的修改為準（codex review 發現） */
      const copy = [...dlg.querySelectorAll('button')].find(b => /複製內容/.test(b.textContent));
      copy.click(); await sleep(30);
      ok('複製失敗後診斷框仍是使用者的修改', diag.value === '（使用者刪掉網址與瀏覽器）', diag.value.slice(0, 40));
      diag.value = '（使用者又改過）';
      copy.click(); await sleep(30);
      const manual = dlg.querySelectorAll('textarea')[2];
      const full = manual ? manual.value : '';
      const nDiag = full.split('--- 診斷資訊 ---').length - 1;
      ok('複製失敗兩次，手動複製的內容只有一份診斷資訊', nDiag === 1, '出現 ' + nDiag + ' 次');
      ok('再次複製時用的是使用者最新的修改', /使用者又改過/.test(full) && !/使用者刪掉網址/.test(full),
         full.slice(0, 80));
    }
  }

  console.log('\n\x1b[1m不支援的網站重複點書籤不累積（review 發現）\x1b[0m');
  {
    const d = new JSDOM('<body><p>依建築法第7條規定</p></body>',
      { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
    d.window.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    for (let i = 0; i < 3; i++) d.window.eval(code);
    const kids = [...d.window.document.body.children].map(n => String(n.className || '').split(' ')[0]);
    const n = re => kids.filter(c => re.test(c)).length;
    const st = d.window.document.querySelectorAll('style').length;
    ok('點三次只有一張樣式表', st === 1, st + ' 張');
    ok('不建立條文面板', n(/-p$/) === 0, n(/-p$/) + ' 個');
    ok('提示只留一個', n(/-t$/) === 1, n(/-t$/) + ' 個');
    ok('第二次以後仍顯示不支援提示', d.window.document.body.textContent.includes('本工具僅在法規網站上運作'));
    ok('書籤狀態已設定（count 為 0）', !!d.window.__lawhover__ && d.window.__lawhover__.count() === 0);
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
