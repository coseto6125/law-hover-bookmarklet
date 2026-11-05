/* 抽查：跨站台、跨法規，確認條文與沿革都顯示正確版本
 * 使用者要求：抽查法規、法條、沿革條目是否正常顯示、版本是否正確
 *
 * 抽樣是固定清單，不用亂數：同樣的程式碼每次測同樣的條文，失敗才能重現。
 * 內容比對有兩種：
 *   1. 沿革面板：標題條號須等於頁面該列的條號；must 列出該條「不會再變」的歷史
 *      （制定／訂定日），面板必須含有，證明顯示的是這一條的沿革而不是別條的。
 *   2. 引用面板：固定取文件順序第一個綁定本頁法規的引用，面板內容須含頁面上
 *      同一條的開頭文字（與頁面逐字比對）。 */
const fs = require('fs');
const { panelReady, injected, reporter, launchOrSkip } = require('./wait');
const path = require('path');
const root = path.join(__dirname, '..');
const url = fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const report = reporter('隨機抽查');
const { ok } = report;

// 抽樣涵蓋不同機關、不同規模、不同站台型態
const SAMPLES = [
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109', law: '建築法',
    picks: ['1', '3', '30'], must: { 1: '二十七年十二月二十六日（制定）', 3: '二十七年十二月二十六日（制定）' } },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001', law: '勞動基準法',
    picks: ['1', '2', '12'], must: { 1: '七十三年七月三十日（制定）', 2: '七十三年七月三十日（制定）' } },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030055', law: '行政程序法',
    picks: ['1', '44', '167'], must: {} },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021', law: '個人資料保護法',
    picks: ['1', '2', '53-1'], must: { 1: '八十四年八月十一日（制定）', 2: '八十四年八月十一日（制定）' } },
  { site: '中央', url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070118', law: '公寓大廈管理條例',
    picks: ['1', '2', '29'], must: { 1: '八十四年六月二十八日（制定）' } },
  { site: '臺東', url: 'https://law.taitung.gov.tw/LawContent.aspx?id=FL023844', law: '臺東縣議會組織自治條例',
    picks: ['4', '13', '24'], must: {} },
  { site: '臺北', url: 'https://laws.gov.taipei/Law/LawSearch/LawArticleContent/FL039973', law: '臺北市建築管理工程處組織規程',
    picks: ['1', '2', '9'], must: { 1: '95年7月30日（訂定）', 2: '95年7月30日（訂定）' },
    noCite: true /* 全文沒有綁定本頁法規的引用 */ },
];

async function main() {
  const { browser } = await launchOrSkip(report);
  try { await globalThis.fetch('https://law.moj.gov.tw/'); }
  catch (e) { await browser.close(); report.bail('無法連線（' + e.message + '）'); }

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

      const picks = sp.picks;

      for (const flno of picks) {
        // 頁面上該條的條號標示（作為對照基準）：面板標題必須是同一條
        const expect = await page.evaluate(f => {
          const h = [...document.querySelectorAll('[data-lh-head]')].find(e => e.dataset.lhHead === f);
          const row = h && h.closest('tr, .row, li');
          const m = row && /^第\s*([0-9]+(?:-[0-9]+)?)\s*條/.exec(row.textContent.replace(/\s+/g, ''));
          return m ? m[1] : null;
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
        ok('第 ' + flno + ' 條的沿革面板標題正確', titleOk && expect === flno,
           '頁面條號=' + expect + ' ' + panel.slice(0, 50));
        if (sp.must[flno]) {
          ok('第 ' + flno + ' 條的沿革含固定史實「' + sp.must[flno] + '」',
             panel.indexOf(sp.must[flno].replace(/\s+/g, '')) >= 0, panel.slice(0, 80));
        }
        ok('第 ' + flno + ' 條沿革有明確結論',
           /修正\d+次|未被個別修正過|未見此條的修正紀錄|僅隨全文修正|沒有可確認修正本條/.test(panel),
           panel.slice(0, 60));
      }

      // 條文引用抽查：面板內容須與頁面該條一致
      if (base.marks > 0 || !sp.noCite) {
        const cite = await page.evaluate(() => {
          /* 文件順序第一個「頁面上有實質條文」的本頁引用，固定不隨機。
           * 已刪除／空白的條文沒有內容可比對，跳過。 */
          for (const e of document.querySelectorAll('[data-flno]')) {
            if (!e.dataset.pcode) continue;
            const h = [...document.querySelectorAll('[data-lh-head]')].find(x => x.dataset.lhHead === e.dataset.flno);
            const row = h && h.closest('tr, .row, li');
            const body = row ? row.textContent.replace(/\s+/g, '').replace(/^第[0-9\-]+條/, '').slice(0, 16) : '';
            if (body.length >= 6 && !/^[（(]刪除[）)]/.test(body)) {
              return { flno: e.dataset.flno, name: e.dataset.name, raw: e.textContent, body };
            }
          }
          return null;
        });
        if (!cite) {
          ok('有可比對的本頁引用', !!sp.noCite, '頁面沒有綁定本頁法規且有條文的引用');
        } else {
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
          ok('引用「' + cite.raw.slice(0, 14) + '」的面板含頁面該條的開頭文字',
             cite.body.length >= 6 && p2.indexOf(cite.body) >= 0,
             '期望「' + cite.body + '」；面板：' + p2.slice(0, 60));
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
  report.done();
}
main().catch(e => { console.error(e); process.exit(1); });
