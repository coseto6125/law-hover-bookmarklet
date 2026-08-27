/* 跨平台驗證：同一份書籤在桌機與行動裝置上皆須可用
 *
 * 使用者回報手機 Chrome 加入書籤後沒有效果。實測釐清：
 *   程式碼本身在所有平台都能執行（與 OS/CPU 架構無關），
 *   差異在「觸發方式」與「沒有 hover」兩點，兩者都在程式內處理，
 *   因此不需要分手機版/桌面版書籤。
 */
const fs = require('fs');
const { panelReady, injected } = require('./wait');
const path = require('path');
const root = path.join(__dirname, '..');
const url = fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

async function main() {
  let chromium, devices;
  try { ({ chromium, devices } = require('playwright')); }
  catch (e) { console.log('\x1b[33m略過：未安裝 playwright\x1b[0m'); process.exit(0); }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log('\x1b[33m略過：無法啟動 Chromium\x1b[0m'); process.exit(0); }
  try { await globalThis.fetch('https://law.moj.gov.tw/'); }
  catch (e) { console.log('\x1b[33m略過：無法連線\x1b[0m'); await browser.close(); process.exit(0); }

  const CASES = [
    ['Windows 桌機', { viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' }, false],
    ['macOS 桌機', { viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' }, false],
    ['Android 手機', { ...devices['Pixel 7'], hasTouch: true, isMobile: true }, true],
    ['iPhone', { ...devices['iPhone 14'], hasTouch: true, isMobile: true }, true],
    ['iPad', { ...devices['iPad Pro 11'], hasTouch: true }, true],
  ];

  console.log('\n\x1b[1m同一份書籤在各平台皆可執行\x1b[0m');
  const results = [];
  for (const [name, opt, isTouch] of CASES) {
    const ctx = await browser.newContext(opt);
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));
    });
    await p.goto('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109', { waitUntil: 'domcontentloaded' });
    const cdp = await ctx.newCDPSession(p);
    try { await cdp.send('Page.navigate', { url }); } catch (e) {}
    await injected(p, { timeout: 20000 });
    const r = await p.evaluate(() => ({
      marks: document.querySelectorAll('[data-flno],[data-ex]').length,
      heads: document.querySelectorAll('[data-lh-head]').length,
      csp: window.__csp.length,
      touch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
    }));
    ok(name + '：標記 ' + r.marks + ' 處、條號 ' + r.heads + ' 個',
       r.marks >= 70 && r.heads >= 100 && r.csp === 0, JSON.stringify(r));
    results.push([name, r, isTouch, ctx, p]);
  }

  console.log('\n\x1b[1m觸控裝置改以點擊觸發（沒有 hover）\x1b[0m');
  for (const [name, r, isTouch, ctx, p] of results) {
    if (!isTouch) { await ctx.close(); continue; }
    ok(name + ' 被正確識別為觸控裝置', r.touch);
    await p.tap('[data-flno]').catch(() => {});
    await panelReady(p, { timeout: 15000 });
    const shown = await p.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      return q ? q.textContent.replace(/\s+/g, ' ').slice(0, 40) : '';
    });
    ok(name + ' 點擊標記可顯示面板', shown.length > 10, shown || '面板未顯示');

    // 面板不可超出小螢幕
    const box = await p.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      if (!q) return null;
      const b = q.getBoundingClientRect();
      return { over: b.right > innerWidth + 2 || b.left < -2, w: Math.round(b.width), vw: innerWidth };
    });
    ok(name + ' 面板未超出畫面', box && !box.over, box ? JSON.stringify(box) : '無面板');

    /* 複製：手機未取得剪貼簿權限時 clipboard API 會拋 NotAllowedError，
     * 且它回傳 Promise，用 try/catch 包不住（使用者回報手機複製有問題）。
     * 應退回 execCommand，再失敗才提示手動複製。 */
    await p.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      const a = q && [...q.querySelectorAll('a')].find(x => /複製條文/.test(x.textContent));
      if (a) a.click();
    });
    await p.waitForTimeout(900);
    const copyState = await p.evaluate(() => {
      const q = [...document.body.children].find(n => {
        const c = String(n.className || '').split(' ');
        return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
      });
      const a = q && [...q.querySelectorAll('a')].find(x => /複製|已複製|長按/.test(x.textContent));
      return a ? a.textContent : '';
    });
    ok(name + ' 複製有明確結果（成功或可行的退路）',
       /已複製|長按選取/.test(copyState), '按鈕文字：' + copyState);
    ok(name + ' 未殘留暫時 textarea',
       await p.evaluate(() => document.querySelectorAll('textarea[readonly]').length === 0));
    await ctx.close();
  }

  console.log('\n\x1b[1m長條文的面板可捲動且不超出畫面\x1b[0m');
  {
    const SIZES = [
      ['桌機 800h', { viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }, false],
      ['矮視窗 500h', { viewport: { width: 1000, height: 500 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }, false],
      ['手機', { ...devices['Pixel 7'], hasTouch: true, isMobile: true }, true],
    ];
    for (const [nm, opt, touch] of SIZES) {
      const ctx = await browser.newContext(opt);
      const p = await ctx.newPage();
      try {
        await p.goto('https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070109',
          { waitUntil: 'domcontentloaded', timeout: 35000 });
        const cdp = await ctx.newCDPSession(p);
        try { await cdp.send('Page.navigate', { url }); } catch (e) {}
        await injected(p, { timeout: 20000 });
        if (touch) await p.tap('[data-flno]').catch(() => {});
        else await p.evaluate(() => {
          const x = document.querySelector('[data-flno]');
          x.scrollIntoView({ block: 'center' });
          x.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        await panelReady(p, { timeout: 15000 });
        // 塞入大量內容模擬超長條文（真實法規如所得稅法確有數十款）
        const r = await p.evaluate(() => {
          const q = [...document.body.children].find(n => {
            const c = String(n.className || '').split(' ');
            return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
          });
          if (!q) return null;
          const body = q.querySelector('[class*="-b"]');
          if (body) for (let i = 0; i < 80; i++) {
            const d = document.createElement('div');
            d.textContent = (i + 1) + '、這是第 ' + (i + 1) + ' 款，用來測試超長條文。';
            body.appendChild(d);
          }
          const rc = q.getBoundingClientRect();
          return {
            h: Math.round(rc.height), sh: q.scrollHeight, vh: innerHeight,
            canScroll: q.scrollHeight > q.clientHeight + 2,
            outTop: rc.top < -1, outBottom: Math.round(rc.bottom) > innerHeight + 1,
          };
        });
        ok(nm + ' 有長內容時可捲動', r && r.canScroll,
           r ? '面板 ' + r.h + ' / 內容 ' + r.sh : '無面板');
        ok(nm + ' 不超出畫面上緣', r && !r.outTop);
        ok(nm + ' 不超出畫面下緣（看得到底部連結）', r && !r.outBottom,
           r ? '面板高 ' + r.h + ' 視窗 ' + r.vh : '');
        const bottom = await p.evaluate(() => {
          const q = [...document.body.children].find(n => {
            const c = String(n.className || '').split(' ');
            return /-p$/.test(c[0]) && !c.some(y => /-hide$/.test(y));
          });
          q.scrollTop = q.scrollHeight;
          return Math.round(q.scrollTop);
        });
        ok(nm + ' 可捲到底讀完整條文', bottom > 100, 'scrollTop=' + bottom);
      } catch (e) {
        ok(nm + ' 長條文測試', false, e.message.split('\n')[0].slice(0, 50));
      }
      await ctx.close();
    }
  }

  await browser.close();
  console.log('\n' + (fail === 0
    ? `\x1b[32m跨平台驗證全部通過：${pass} 項\x1b[0m`
    : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
