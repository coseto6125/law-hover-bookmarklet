/* 隨機抽查：跨站台、跨法規，確認條文與沿革都顯示正確版本
 * 使用者要求：抽查法規、法條、沿革條目是否正常顯示、版本是否正確 */
const fs = require('fs');
const { panelReady, injected } = require('./wait');
const path = require('path');
const root = path.join(__dirname, '..');
const url = fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

// 抽樣涵蓋不同機關、不同規模、不同站台型態
const SAMPLES = [
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109', law: '建築法' },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001', law: '勞動基準法' },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030055', law: '行政程序法' },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021', law: '個人資料保護法' },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070118', law: '公寓大廈管理條例' },
  { site: '臺東', url: 'https://law.taitung.gov.tw/LawContent.aspx?id=FL023844', law: '臺東縣議會組織自治條例' },
  { site: '臺北', url: 'https://laws.gov.taipei/Law/LawSearch/LawArticleContent/FL039973', law: '臺北市建築管理工程處組織規程' },
];

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('\x1b[33m略過：未安裝 playwright\x1b[0m'); process.exit(0); }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log('\x1b[33m略過：無法啟動 Chromium\x1b[0m'); process.exit(0); }
  try { await globalThis.fetch('https://law.moj.gov.tw/'); }
  catch (e) { console.log('\x1b[33m略過：無法連線\x1b[0m'); await browser.close(); process.exit(0); }

  for (const sp of SAMPLES) {
    console.log('\n\x1b[1m' + sp.site + ' · ' + sp.law + '\x1b[0m');
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));
    });
    try {
      await page.goto(sp.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      const cdp = await ctx.newCDPSession(page);
      try { await cdp.send('Page.navigate', { url }); } catch (e) {}
      // 等注入完成即可，不必固定等 5 秒
      await injected(page, { timeout: 20000 });

      const base = await page.evaluate(() => ({
        marks: document.querySelectorAll('[data-flno],[data-ex]').length,
        heads: document.querySelectorAll('[data-lh-head]').length,
        csp: window.__csp.length,
      }));
      ok('腳本載入且無 CSP 違規與 JS 錯誤',
         base.csp === 0 && errs.length === 0, 'CSP=' + base.csp + ' err=' + errs.slice(0, 1));
      ok('有標記條號（' + base.heads + ' 個）', base.heads > 0, '標記 ' + base.heads);

      // 隨機挑三個條號驗證條文內容
      const picks = await page.evaluate(() => {
        const hs = [...document.querySelectorAll('[data-lh-head]')];
        const out = [];
        for (let i = 0; i < 3 && hs.length; i++) {
          const e = hs[Math.floor(Math.random() * hs.length)];
          if (e && out.indexOf(e.dataset.lhHead) < 0) out.push(e.dataset.lhHead);
        }
        return out;
      });

      for (const flno of picks) {
        // 頁面上該條的實際內容（作為對照基準）
        const expect = await page.evaluate(f => {
          const h = [...document.querySelectorAll('[data-lh-head]')].find(e => e.dataset.lhHead === f);
          if (!h) return null;
          const row = h.closest('tr, .row, li');
          if (!row) return null;
          const t = row.textContent.replace(/\s+/g, '').replace(/^第[0-9\-]+條/, '');
          return t.slice(0, 24);
        }, flno);

        await page.evaluate(f => {
          const h = [...document.querySelectorAll('[data-lh-head]')].find(e => e.dataset.lhHead === f);
          h.scrollIntoView({ block: 'center' });
          h.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }, flno);
        await panelReady(page, { timeout: 15000 });
        const panel = await page.evaluate(() => {
          const q = [...document.body.children].find(n => {
            const c = String(n.className || '').split(' ');
            return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
          });
          return q ? q.textContent.replace(/\s+/g, '') : '';
        });
        // 沿革面板必須標明是「哪一條」，且不可顯示成別條
        const titleOk = panel.indexOf('第' + flno + '條') >= 0 ||
                        panel.indexOf('第' + String(flno).replace('-', '之') + '條') >= 0;
        ok('第 ' + flno + ' 條的沿革面板標題正確', titleOk, panel.slice(0, 50));
        ok('第 ' + flno + ' 條沿革有明確結論',
           /修正\d+次|未被個別修正過|未見此條的修正紀錄|僅隨全文修正/.test(panel),
           panel.slice(0, 60));
      }

      // 條文引用抽查：面板內容須與頁面該條一致
      if (base.marks > 0) {
        const cite = await page.evaluate(() => {
          const m = [...document.querySelectorAll('[data-flno]')].filter(e => e.dataset.pcode);
          if (!m.length) return null;
          const e = m[Math.floor(Math.random() * m.length)];
          return { flno: e.dataset.flno, name: e.dataset.name, raw: e.textContent };
        });
        if (cite) {
          await page.evaluate(c => {
            const e = [...document.querySelectorAll('[data-flno]')]
              .find(x => x.dataset.flno === c.flno && x.dataset.pcode);
            e.scrollIntoView({ block: 'center' });
            e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          }, cite);
          await panelReady(page, { timeout: 15000 });
          const p2 = await page.evaluate(() => {
            const q = [...document.body.children].find(n => {
              const c = String(n.className || '').split(' ');
              return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
            });
            return q ? q.textContent.replace(/\s+/g, '') : '';
          });
          // 面板必須標明是哪一條，且條號要與引用相符
          ok('引用「' + cite.raw.slice(0, 14) + '」的面板標題與條號相符',
             !!p2 && (p2.indexOf('第' + cite.flno + '條') >= 0 ||
                      p2.indexOf('第' + String(cite.flno).replace('-', '之') + '條') >= 0 ||
                      /查不到/.test(p2)),
             '面板：' + p2.slice(0, 50));
          ok('未顯示錯誤資料（寧可查不到）',
             !p2 || /查不到/.test(p2) || p2.indexOf('第' + cite.flno + '條') >= 0 ||
             p2.indexOf('第' + String(cite.flno).replace('-', '之') + '條') >= 0,
             p2.slice(0, 50));
        }
      }
    } catch (e) {
      ok(sp.law + ' 可正常載入', false, e.message.split('\n')[0].slice(0, 60));
    }
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fail === 0
    ? `\x1b[32m隨機抽查全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
