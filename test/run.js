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
