/* 真實瀏覽器驗證（Chromium）
 *
 * 前面的 jsdom 測試不會強制 CSP，這正是 inline style 問題連續兩次漏掉的原因。
 * 這支測試在真實 Chromium 中載入真實頁面、執行打包後的 bookmarklet，
 * 由瀏覽器實際強制 CSP，並監聽 securitypolicyviolation 事件。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bookmarklet = fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8');
const code = decodeURIComponent(bookmarklet.slice('javascript:'.length));

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
  catch (e) { console.log('\x1b[33m略過：無法啟動 Chromium（' + e.message.split('\n')[0] + '）\x1b[0m'); process.exit(0); }

  const page = await browser.newPage();

  // 收集瀏覽器實際回報的 CSP 違規
  const violations = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__csp.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        sample: e.sample ? String(e.sample).slice(0, 80) : '',
      });
    });
  });
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text()); });

  const URL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109';
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
  catch (e) { console.log('\x1b[33m略過：無法連線（' + e.message.split('\n')[0] + '）\x1b[0m'); await browser.close(); process.exit(0); }

  console.log('\n\x1b[1m真實 Chromium · 執行 bookmarklet\x1b[0m');
  const cspHeader = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return m ? m.content : '(由 HTTP 標頭提供)';
  });
  ok('已載入受 CSP 保護的真實頁面', true, 'CSP: ' + String(cspHeader).slice(0, 60));

  /* 以「使用者點擊書籤」的真實方式執行。
   * 這與 page.evaluate(eval) 有本質差異：
   *   - 頁面自身設定 location.href='javascript:...' 會被 CSP script-src 擋下（實測確認）
   *   - 使用者點擊書籤是瀏覽器發起的導覽，豁免於 CSP
   * 因此必須用 CDP Page.navigate 模擬，才代表真實使用情境。
   * 回傳 ERR_ABORTED 是正常的：IIFE 回傳 undefined，瀏覽器不會替換頁面內容。
   */
  const cdp = await page.context().newCDPSession(page);
  let navErr = null;
  try {
    const r = await cdp.send('Page.navigate', { url: bookmarklet });
    navErr = r.errorText && r.errorText !== 'net::ERR_ABORTED' ? r.errorText : null;
  } catch (e) { navErr = e.message.split('\n')[0]; }
  ok('以真實書籤導覽方式執行成功', !navErr, navErr);
  await page.waitForTimeout(800);
  ok('頁面未被取代（IIFE 回傳 undefined）',
     page.url().startsWith('https://law.moj.gov.tw/LawClass/LawAll.aspx'), page.url());

  const cspEvents = await page.evaluate(() => window.__csp || []);
  const styleViolations = cspEvents.filter(v => /style-src/.test(v.directive));
  ok('無 style-src 違規（本次修復的核心）', styleViolations.length === 0,
     styleViolations.map(v => v.directive + ' ' + v.sample).join('\n      '));
  ok('無任何 CSP 違規', cspEvents.length === 0,
     cspEvents.map(v => v.directive).join(', '));
  ok('主控台無 CSP 錯誤訊息', violations.length === 0, violations.slice(0, 2).join('\n      '));

  console.log('\n\x1b[1m標記與樣式實際生效\x1b[0m');
  const stats = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('[data-flno]')];
    const m0 = marks[0];
    const cs = m0 ? getComputedStyle(m0) : null;
    return {
      count: marks.length,
      selfBound: marks.filter(m => m.dataset.pcode).length,
      // 由 computed style 確認樣式真的生效，而非只是 class 掛上去
      borderStyle: cs ? cs.borderBottomStyle : '',
      borderColor: cs ? cs.borderBottomColor : '',
      cursor: cs ? cs.cursor : '',
      hasInlineStyle: marks.some(m => m.getAttribute('style')),
    };
  });
  ok('標記大量引用', stats.count >= 70, '標記 ' + stats.count + ' 處');
  ok('裸條號綁定當前頁法規', stats.selfBound >= 70, '自指 ' + stats.selfBound + ' 處');
  ok('底線樣式實際生效（computed style）', stats.borderStyle === 'dotted', stats.borderStyle);
  ok('標記顏色實際生效', /192,\s*57,\s*43/.test(stats.borderColor), stats.borderColor);
  ok('游標樣式實際生效', stats.cursor === 'help', stats.cursor);
  ok('未使用 inline style 屬性', !stats.hasInlineStyle);

  console.log('\n\x1b[1m懸停取文（真實網路 + 真實 CSP）\x1b[0m');
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('[data-flno]')].find(x => x.dataset.flno === '3' && x.dataset.pcode);
    m.scrollIntoView();
    m.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await page.waitForTimeout(6000);

  const panel = await page.evaluate(() => {
    const p = [...document.body.children].find(n => {
      const c = String(n.className || '').split(' ');
      return /^lh-[a-z0-9]+-p$/.test(c[0] || '') && !c.some(x => /-hide$/.test(x));
    });
    if (!p) return null;
    const cs = getComputedStyle(p);
    return {
      text: p.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      display: cs.display, position: cs.position, zIndex: cs.zIndex,
      bg: cs.backgroundColor, top: cs.top, left: cs.left,
      hasInlineStyle: !!p.getAttribute('style'),
      hitCount: p.querySelectorAll('[class*="-x"]').length,
    };
  });
  ok('面板已顯示', !!panel, panel ? '' : '未找到顯示中的面板');
  if (panel) {
    ok('面板含真實條文內容', panel.text.includes('本法適用地區如左'), panel.text.slice(0, 60));
    ok('面板定位樣式生效（規則層級）', panel.position === 'absolute', panel.position);
    ok('面板浮在最上層', panel.zIndex === '2147483647', panel.zIndex);
    ok('面板背景生效（非透明）', /255,\s*255,\s*255/.test(panel.bg), panel.bg);
    ok('面板座標已套用', panel.top !== 'auto' && panel.top !== '0px', 'top=' + panel.top + ' left=' + panel.left);
    ok('面板未使用 inline style', !panel.hasInlineStyle);
  }

  const after = await page.evaluate(() => (window.__csp || []).length);
  ok('取文與顯示過程仍無 CSP 違規', after === 0, '違規數 ' + after);

  console.log('\n\x1b[1m重複點擊書籤（使用者每頁都要點一次）\x1b[0m');
  {
    const before = await page.evaluate(() => document.querySelectorAll('[data-flno]').length);
    try { await cdp.send('Page.navigate', { url: bookmarklet }); } catch (e) {}
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      marks: document.querySelectorAll('[data-flno]').length,
      panels: [...document.body.children]
        .filter(n => /^lh-[a-z0-9]+-p$/.test(String(n.className || '').split(' ')[0])).length,
    }));
    ok('再次點擊不會重複標記', after.marks === before, before + ' → ' + after.marks);
    ok('再次點擊不會重複建立面板', after.panels === 1, '面板數 ' + after.panels);
  }

  console.log('\n\x1b[1m條號標題的沿革（滑「第 N 條」）\x1b[0m');
  {
    const hn = await page.evaluate(() => document.querySelectorAll('[data-lh-head]').length);
    ok('標記所有條號標題', hn >= 100, '標記 ' + hn + ' 個');
    const noInline = await page.evaluate(() =>
      ![...document.querySelectorAll('[data-lh-head]')].some(e => e.getAttribute('style')));
    ok('條號標記未使用 inline style', noInline);

    async function hoverHead(flno) {
      await page.evaluate(n => {
        const x = [...document.querySelectorAll('[data-lh-head]')].find(e => e.dataset.lhHead === n);
        x.scrollIntoView({ block: 'center' });
        x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }, flno);
      await page.waitForTimeout(9000);
      return page.evaluate(() => {
        const q = [...document.body.children].find(n => {
          const c = String(n.className || '').split(' ');
          return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
        });
        return q ? q.textContent.replace(/\s+/g, ' ') : '';
      });
    }

    const h3 = await hoverHead('3');
    ok('滑條號顯示沿革而非條文', /修正沿革/.test(h3) && !/本法適用地區如左/.test(h3), h3.slice(0, 70));
    ok('列出修正次數與年份', /本條共修正 \d+ 次/.test(h3) && /年/.test(h3), h3.slice(0, 60));
    ok('沿革面板有「當時條文」彈窗入口', /當時條文/.test(h3));
    ok('沿革面板有立法院入口', /立法院法律系統/.test(h3));

    // 建築法第 1 條曾於八十四年修正，先前誤以為未修正
    const h1 = await hoverHead('1');
    ok('條號沿革內容正確（第 1 條確有修正）',
       /本條共修正 \d+ 次/.test(h1) && /八十四年/.test(h1), h1.slice(0, 70));
    ok('條號沿革過程無 CSP 違規', (await page.evaluate(() => window.__csp.length)) === 0);
  }

  console.log('\n\x1b[1m修法紀錄（由沿革反查）\x1b[0m');
  {
    async function hoverArt(flno) {
      await page.evaluate(n => {
        const x = [...document.querySelectorAll('[data-flno]')]
          .find(e => e.dataset.flno === n && e.dataset.pcode);
        x.scrollIntoView({ block: 'center' });
        x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }, flno);
      await page.waitForTimeout(9000);
      return page.evaluate(() => {
        const q = [...document.body.children].find(n => {
          const c = String(n.className || '').split(' ');
          return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
        });
        return q ? q.textContent.replace(/\s+/g, ' ') : '';
      });
    }
    // 建築法第 3 條曾於 92 年修正，第 78 條自公布後未修正
    const t3 = await hoverArt('3');
    ok('條文面板同時顯示條文與沿革',
       /本法適用地區如左/.test(t3) && /本條修正 \d+ 次/.test(t3), t3.slice(0, 70));
    ok('修正過的條文顯示修正次數', /本條修正 \d+ 次/.test(t3),
       t3.slice(Math.max(0, t3.search(/本條修正|未見/) - 10), 90));
    ok('列出修正年份', /九十二年|\d+年/.test(t3));
    ok('提供完整沿革連結', /查看完整沿革/.test(t3));

    const t78 = await hoverArt('78');
    ok('未修正的條文明確說明', /未見此條的修正紀錄/.test(t78),
       t78.slice(Math.max(0, t78.search(/未見|本條修正/) - 10), 80));
    ok('查沿革過程無 CSP 違規', (await page.evaluate(() => window.__csp.length)) === 0);

    // 立法院有歷史條文全文，但跨網域無法內嵌，改以彈窗開啟。
    // 此入口僅在「有修正紀錄」的條文才出現，故回到第 3 條測試。
    await hoverArt('3');
    const lyHref = await page.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      const a = q && [...q.querySelectorAll('a')].find(x => x.textContent === '當時條文');
      return a ? a.href : null;
    });
    ok('提供「當時條文」入口', !!lyHref, lyHref || '未找到');
    ok('連向立法院公開轉址（不需 session）',
       !!lyHref && /ly\.gov\.tw\/Pages\/ashx\/LawRedirect\.ashx\?CODE=\d+/.test(lyHref),
       lyHref);

    const ctx2 = page.context();
    const [popup] = await Promise.all([
      ctx2.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      page.evaluate(() => {
        const q = [...document.body.children].find(n => {
          const c = String(n.className || '').split(' ');
          return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
        });
        [...q.querySelectorAll('a')].find(x => x.textContent === '當時條文').click();
      }),
    ]);
    ok('點擊後開啟彈窗', !!popup, '未開啟');
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      ok('彈窗落在立法院法律系統', /lis\.ly\.gov\.tw\/lglawc\/lawsingle/.test(popup.url()),
         popup.url().slice(0, 60));
      const ptxt = await popup.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
      ok('彈窗含歷次版本清單', /中華民國\d+年\d+月\d+日/.test(ptxt), ptxt.slice(0, 60));
      await popup.close();
    }
  }

  console.log('\n\x1b[1m司法院解釋（線上取文）\x1b[0m');
  {
    // 法規頁本身沒有釋字引用，注入一段模擬公文後重新掃描
    await page.evaluate(() => {
      const d = document.createElement('p');
      d.id = 'ex-test';
      d.textContent = '參照司法院釋字第748號解釋，並依115年憲判字第6號判決辦理。';
      document.querySelector('.law-reg-content').prepend(d);
    });
    try { await cdp.send('Page.navigate', { url: bookmarklet }); } catch (e) {}
    await page.waitForTimeout(1200);

    const exm = await page.evaluate(() => [...document.querySelectorAll('[data-ex]')]
      .map(x => ({ t: x.textContent, ex: x.dataset.ex, no: x.dataset.exno, y: x.dataset.exyear })));
    ok('辨識釋字與憲判字', exm.length === 2, JSON.stringify(exm));

    async function hoverEx(kind, no) {
      await page.evaluate(([k, n]) => {
        const x = [...document.querySelectorAll('[data-ex]')]
          .find(e => e.dataset.ex === k && e.dataset.exno === n);
        x.scrollIntoView({ block: 'center' });
        x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }, [kind, no]);
      await page.waitForTimeout(9000);
      return page.evaluate(() => {
        const q = [...document.body.children].find(n => {
          const c = String(n.className || '').split(' ');
          return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
        });
        return q ? q.textContent.replace(/\s+/g, ' ').trim() : '';
      });
    }

    const t748 = await hoverEx('C', '748');
    ok('釋字 748 取回解釋文', /相同性別二人/.test(t748), t748.slice(0, 70));
    ok('釋字面板含字號與日期', /釋字第 748 號/.test(t748) && /民國 106/.test(t748), t748.slice(0, 40));
    ok('釋字面板有複製與回報入口',
       /複製解釋文/.test(t748) && /這則顯示錯了/.test(t748));

    const tcj = await hoverEx('CJ', '6');
    ok('憲判字 6 取回內容（需先查 JC 流水號）',
       /憲判字第 6 號/.test(tcj) && tcj.length > 60 && !/查不到/.test(tcj), tcj.slice(0, 70));

    ok('取解釋過程無 CSP 違規',
       (await page.evaluate(() => window.__csp.length)) === 0);
    await page.evaluate(() => { const e = document.getElementById('ex-test'); if (e) e.remove(); });
  }

  console.log('\n\x1b[1m問題回報（兩階段）\x1b[0m');
  {
    const fabInfo = await page.evaluate(() => {
      const f = [...document.body.children].find(n => /-fab$/.test(String(n.className || '').split(' ')[0]));
      if (!f) return null;
      const r = f.getBoundingClientRect(), cs = getComputedStyle(f);
      return { txt: f.textContent, right: Math.round(innerWidth - r.right),
               bottom: Math.round(innerHeight - r.bottom), pos: cs.position };
    });
    ok('右下角有常駐回報入口', fabInfo && fabInfo.pos === 'fixed' &&
       fabInfo.right < 40 && fabInfo.bottom < 40,
       fabInfo ? JSON.stringify(fabInfo) : '未找到');

    await page.evaluate(() => [...document.body.children]
      .find(n => /-fab$/.test(String(n.className || '').split(' ')[0])).click());
    await page.waitForTimeout(400);
    const dlg = await page.evaluate(() => {
      const el = [...document.body.children].find(n => /-dlg$/.test(String(n.className || '').split(' ')[0]));
      if (!el) return null;
      const tas = [...el.querySelectorAll('textarea')];
      return {
        opts: [...el.querySelectorAll('[class*="-opt"]')].map(o => o.textContent),
        diag: tas.length > 1 ? tas[1].value : '',
        sendDisabled: [...el.querySelectorAll('button')]
          .find(b => /Email/.test(b.textContent)).disabled,
      };
    });
    ok('回報對話框可開啟', !!dlg, '未開啟（可能有 JS 錯誤）');
    if (dlg) {
      ok('第一階段：兩種問題類型', dlg.opts.length === 2 &&
         /沒有顯示資料/.test(dlg.opts[0]) && /資料顯示錯誤/.test(dlg.opts[1]),
         JSON.stringify(dlg.opts));
      ok('未選類型前不能送出', dlg.sendDisabled === true, '送出鈕未停用');
      ok('診斷自動帶入網址', /網址: https:\/\/law\.moj\.gov\.tw/.test(dlg.diag));
      ok('診斷自動帶入本頁法規與標記數',
         /本頁法規: /.test(dlg.diag) && /標記總數: \d+/.test(dlg.diag));
      ok('診斷含標記樣本（供重現解析結果）', /本頁標記樣本/.test(dlg.diag));
      ok('診斷不含頁面正文（隱私）', !/建築物非經申請/.test(dlg.diag));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok('Esc 可關閉回報視窗', await page.evaluate(() => ![...document.body.children]
       .some(n => /-dlg$/.test(String(n.className || '').split(' ')[0]))));
  }

  console.log('\n\x1b[1m條文面板的回報入口\x1b[0m');
  {
    await page.evaluate(() => {
      const x = [...document.querySelectorAll('[data-flno]')].find(e => e.dataset.pcode);
      x.scrollIntoView({ block: 'center' });
      x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await page.waitForTimeout(6500);
    const links = await page.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      return q ? [...q.querySelectorAll('a')].map(a => a.textContent) : null;
    });
    ok('條文面板有「這條顯示錯了」', links && links.indexOf('這條顯示錯了') >= 0,
       JSON.stringify(links));

    if (links && links.indexOf('這條顯示錯了') >= 0) {
      await page.evaluate(() => {
        const q = [...document.body.children].find(n => {
          const c = String(n.className || '').split(' ');
          return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
        });
        [...q.querySelectorAll('a')].find(a => a.textContent === '這條顯示錯了').click();
      });
      await page.waitForTimeout(400);
      const pre = await page.evaluate(() => {
        const el = [...document.body.children].find(n => /-dlg$/.test(String(n.className || '').split(' ')[0]));
        if (!el) return null;
        const tas = [...el.querySelectorAll('textarea')];
        return {
          on: [...el.querySelectorAll('[class*="-opt"]')].map(o => o.getAttribute('data-on')),
          raw: tas[0].value, diag: tas[1].value,
          sendDisabled: [...el.querySelectorAll('button')].find(b => /Email/.test(b.textContent)).disabled,
        };
      });
      ok('自動預選「資料顯示錯誤」', pre && pre.on[1] === '1', pre && JSON.stringify(pre.on));
      ok('自動帶入出問題的原文', pre && pre.raw.length > 0, pre && JSON.stringify(pre.raw));
      ok('自動帶入所顯示的條文內容', pre && /顯示的內容/.test(pre.diag));
      ok('預選後即可送出', pre && pre.sendDisabled === false);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  }

  console.log('\n\x1b[1m其他頁面型態（使用者實際會到的頁面）\x1b[0m');
  const PAGES = [
    { n: 'LawSingle 單條頁（有交叉引用）',
      u: 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070109&flno=91', min: 1 },
    { n: 'LawSingle 單條頁（無引用，應為 0）',
      u: 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070109&flno=9', min: 0, exact: 0 },
    { n: '法規沿革頁', u: 'https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode=D0070109', min: 1 },
    { n: '搜尋結果頁（無條號引用，應為 0）',
      u: 'https://law.moj.gov.tw/Law/LawSearchResult.aspx?ty=ONEBAR&kw=%E5%BB%BA%E7%AF%89%E6%B3%95&sNo=0',
      min: 0, exact: 0 },
    { n: '首頁', u: 'https://law.moj.gov.tw/', min: 0, exact: 0 },
  ];
  for (const t of PAGES) {
    const pg = await browser.newPage();
    await pg.addInitScript(() => {
      window.__csp = []; window.__err = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));
      window.addEventListener('error', e => window.__err.push(String(e.message)));
    });
    try {
      await pg.goto(t.u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const c2 = await pg.context().newCDPSession(pg);
      try { await c2.send('Page.navigate', { url: bookmarklet }); } catch (e) {}
      await pg.waitForTimeout(1500);
      const r = await pg.evaluate(() => ({
        marks: document.querySelectorAll('[data-flno]').length,
        csp: window.__csp.length, err: window.__err.length,
      }));
      const good = (t.exact !== undefined ? r.marks === t.exact : r.marks >= t.min) &&
                   r.csp === 0 && r.err === 0;
      ok(t.n, good, '標記=' + r.marks + ' CSP違規=' + r.csp + ' JS錯誤=' + r.err);
    } catch (e) {
      ok(t.n, false, e.message.split('\n')[0]);
    }
    await pg.close();
  }

  await browser.close();
  console.log('\n' + (fail === 0
    ? `\x1b[32m真實瀏覽器驗證全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
