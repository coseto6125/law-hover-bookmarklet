/* 等待條件成立，而不是固定睡一段時間。
 *
 * 測試原本用 waitForTimeout(9000) 這類固定等待來容納最慢的情況，
 * 但絕大多數時候面板 1 秒內就好了，剩下 8 秒是純粹的空等；
 * 三支瀏覽器測試合計約 105 秒都花在這裡。改為輪詢後，快的情況立刻返回，
 * 慢的情況仍有同樣的上限，可靠度不變而時間大幅下降。
 */

/* 等到頁面內的條件為真。fn 在瀏覽器內執行。 */
async function until(page, fn, arg, opt) {
  const o = opt || {};
  const timeout = o.timeout || 12000;
  const interval = o.interval || 100;
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > deadline) {
      if (o.required) throw new Error('等待逾時：' + (o.label || '條件未成立'));
      return false;
    }
    await page.waitForTimeout(interval);
  }
}

/* 等面板出現且不再是「查詢中」。取條文要先搜尋再取文，是最常見的等待點。 */
function panelReady(page, opt) {
  return until(page, () => {
    const q = [...document.body.children].find(n => {
      const c = String(n.className || '').split(' ');
      return /-p$/.test(c[0] || '') && !c.some(y => /-hide$/.test(y));
    });
    return !!q && !/查詢中|載入中/.test(q.textContent);
  }, null, Object.assign({ label: '面板顯示條文' }, opt));
}

/* 等書籤本體注入完成（頁面上出現標記或提示）。 */
function injected(page, opt) {
  return until(page, () =>
    document.querySelector('[data-flno],[data-lh-head],[class*="-toast"]') !== null,
    null, Object.assign({ label: '書籤已注入' }, opt));
}

module.exports = { until, panelReady, injected };
