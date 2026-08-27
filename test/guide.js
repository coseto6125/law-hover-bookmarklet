/* 安裝頁引導動畫的驗證
 *
 * 背景：游標位置原本寫死座標，元素位置一改就對不上（使用者回報位置錯誤）。
 * 改為依實際元素座標計算後，用這支測試確保游標全程對準目標。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('\x1b[33m略過：未安裝 playwright\x1b[0m'); process.exit(0); }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log('\x1b[33m略過：無法啟動 Chromium\x1b[0m'); process.exit(0); }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(root, 'docs/index.html'), { waitUntil: 'domcontentloaded' });

  console.log('\n\x1b[1m引導動畫可開啟\x1b[0m');
  ok('「?」求助鈕存在', await page.evaluate(() => !!document.getElementById('helpBtn')));
  await page.click('#helpBtn');
  await page.waitForTimeout(400);
  ok('點擊後開啟引導', await page.evaluate(() =>
    document.getElementById('guide').className.includes('on')));
  ok('自動開始播放', await page.evaluate(() =>
    document.getElementById('guidePlay').disabled === true));

  console.log('\n\x1b[1m幽靈游標全程對準目標\x1b[0m');
  // 每個階段：等動畫完成後，量游標尖端與目標中心的距離
  const STEPS = [
    [3500, '移到紅色按鈕', 'stageBtn'],
    [5000, '拖到書籤列插入點', 'bmDrop'],
    [7200, '跟到新增的書籤', 'bmNew'],
    [10000, '點擊書籤', 'bmNew'],
    [12600, '滑到被標記的條號', 'sc1'],
  ];
  let last = 400;
  for (const [ms, label, target] of STEPS) {
    await page.waitForTimeout(ms - last);
    last = ms;
    const r = await page.evaluate(t => {
      const g = document.getElementById('ghost'), el = document.getElementById(t);
      const gr = g.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (!er.width && !er.height) return { hidden: true };
      // 游標圖形尖端在左上角附近
      return { d: Math.round(Math.hypot((gr.x + 3) - (er.x + er.width / 2),
                                        (gr.y + 2) - (er.y + er.height / 2))),
               visible: g.classList.contains('on') };
    }, target);
    if (r.hidden) { ok(label + '（目標此時隱藏）', true); continue; }
    ok(label, r.d < 30, '距離目標中心 ' + r.d + 'px');
  }

  console.log('\n\x1b[1m動畫階段依序推進\x1b[0m');
  const cap = await page.evaluate(() => document.getElementById('capT').textContent);
  ok('已進入最後階段', /滑過去就好|就這樣/.test(cap), cap);
  await page.waitForTimeout(2000);
  const done = await page.evaluate(() => ({
    cap: document.getElementById('capT').textContent,
    bm: document.getElementById('bmNew').classList.contains('on'),
    cite: document.getElementById('sc1').classList.contains('on'),
    mini: document.getElementById('miniPanel').classList.contains('on'),
    btn: document.getElementById('guidePlay').textContent,
  }));
  ok('書籤已加入書籤列', done.bm);
  ok('條號已被標記', done.cite);
  ok('條文面板已顯示', done.mini);
  ok('播放結束可重看', /再看一次/.test(done.btn), done.btn);

  console.log('\n\x1b[1m操作與收尾\x1b[0m');
  ok('全程無 JS 錯誤', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Esc 可關閉引導', await page.evaluate(() =>
    !document.getElementById('guide').className.includes('on')));

  console.log('\n\x1b[1m手機操作動畫\x1b[0m');
  {
    ok('手機說明入口存在', await page.evaluate(() => !!document.getElementById('mobBtn')));
    await page.click('#mobBtn');
    await page.waitForTimeout(500);
    ok('手機動畫可開啟', await page.evaluate(() =>
      document.getElementById('mguide').className.includes('on')));

    const stages = [];
    let last = 500;
    for (const ms of [2600, 4400, 5600, 8500, 9900]) {
      await page.waitForTimeout(ms - last); last = ms;
      stages.push(await page.evaluate(() => ({
        url: document.getElementById('mgUrl').textContent,
        sugg: document.getElementById('mgSugg').classList.contains('on'),
        cite: document.getElementById('mgCite').classList.contains('on'),
        panel: document.getElementById('mgPanel').classList.contains('on'),
        cap: document.getElementById('mgCapT').textContent,
      })));
    }
    ok('示範在網址列輸入書籤名稱', stages[0].url === '法條', stages[0].url);
    ok('示範建議清單（手機執行書籤的唯一入口）', stages[1].sugg);
    ok('點選後書籤執行、條號被標記', stages[2].cite && !stages[2].sugg);
    ok('示範用點擊代替 hover', stages[3].panel, stages[3].cap);
    ok('動畫完成', /就這樣/.test(stages[4].cap), stages[4].cap);
    ok('提醒先在電腦加好書籤再同步', await page.evaluate(() =>
      /電腦上加好/.test(document.getElementById('mgCapD').textContent)));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('Esc 可關閉手機動畫', await page.evaluate(() =>
      !document.getElementById('mguide').className.includes('on')));
  }

  console.log('\n\x1b[1m版本更新紀錄（eli5 + ADHD 設計）\x1b[0m');
  {
    const v = await page.evaluate(() => {
      const sec = document.getElementById('changelog');
      if (!sec) return null;
      /* 只看最新的那一塊版本紀錄。整個 section 會累積所有歷史版本，
       * 拿它算條列數會隨版本增加而膨脹，測到的不是單一版的可讀性。 */
      const latest = sec.querySelector('.ver');
      if (!latest) return null;
      return {
        tag: (latest.querySelector('.ver-tag') || {}).textContent,
        tldr: (latest.querySelector('.ver-tldr') || {}).textContent || '',
        items: latest.querySelectorAll('.ver-item').length,
        hasDetails: !!sec.querySelector('details'),
        detailsOpen: sec.querySelector('details') ? sec.querySelector('details').open : null,
        jargon: /Promise|regex|CSP|DOM|API|refactor/i.test(
          latest.querySelector('.ver-tldr').textContent +
          [...latest.querySelectorAll('.ver-item')].map(e => e.textContent).join('')),
        remind: /重新拉一次書籤/.test(document.body.textContent),
      };
    });
    ok('版本紀錄存在', !!v);
    if (v) {
      /* 對照 package.json，避免每次發版都要改測試。 */
      const want = require('../package.json').version;
      ok('標明版本 ' + want, v.tag === want, v.tag);
      // ADHD：先給一句話結論，不必讀完
      ok('開頭有一句話結論', /一句話/.test(v.tldr) && v.tldr.length < 90, v.tldr.slice(0, 50));
      ok('條列可掃視（' + v.items + ' 項）', v.items >= 4 && v.items <= 8, String(v.items));
      // eli5：主要內容不該出現技術術語
      ok('主要內容不含技術術語', !v.jargon);
      // ADHD：細節收折，不強迫閱讀
      ok('技術細節收在折疊裡', v.hasDetails && v.detailsOpen === false);
      ok('提醒更新後要重拉書籤', v.remind);
    }
  }

  console.log('\n\x1b[1m全頁對比符合 WCAG AA\x1b[0m');
  {
    // 使用者回報回報區的步驟序號對比不足（實測 1.37:1）
    const bad = await page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const rgb = s => { const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
      const opaque = e => { let n = e; while (n) {
        const c = getComputedStyle(n).backgroundColor, m = c.match(/[\d.]+/g);
        if (m && (m.length < 4 || parseFloat(m[3]) > 0.5)) return rgb(c);
        n = n.parentElement; } return [255, 255, 255]; };
      const out = [];
      document.querySelectorAll('body *').forEach(e => {
        if (!e.textContent.trim() || e.children.length) return;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !e.offsetParent) return;
        const fg = rgb(cs.color); if (!fg) return;
        const bg = opaque(e), l1 = lum(fg), l2 = lum(bg);
        const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
        const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
        if (r < need) out.push(e.textContent.trim().slice(0, 20) + ' = ' + r.toFixed(2) + ':1');
      });
      return out;
    });
    ok('無對比不足的文字', bad.length === 0, bad.slice(0, 4).join(' | '));
  }

  console.log('\n\x1b[1m範例區可實際操作\x1b[0m');
  await page.hover('.cite');
  await page.waitForTimeout(600);
  const demo = await page.evaluate(() => {
    const q = document.getElementById('panel');
    return q.className.includes('on') ? q.textContent.replace(/\s+/g, ' ') : '';
  });
  ok('滑過範例引用顯示條文', /建築物之施工管理/.test(demo), demo.slice(0, 50));
  const cites = await page.evaluate(() => document.querySelectorAll('.cite').length);
  ok('範例含多處引用（含釋字）', cites >= 5, '共 ' + cites + ' 處');

  await browser.close();
  console.log('\n' + (fail === 0
    ? `\x1b[32m引導動畫驗證全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
