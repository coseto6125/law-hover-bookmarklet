/* 測試共用工具：等待條件、回報與退出碼、重試抓取、瀏覽器啟動。
 *
 * 這些原本在十多支測試裡各自複製一份，名稱與行為逐漸分歧
 * （有的略過會回傳 0、有的重試失敗回 null 或丟例外）。集中在這裡，
 * 讓每支測試的輸出格式與退出碼規則一致：
 *   0  全部通過（或 ALLOW_SKIP=1 時略過）
 *   1  有檢查失敗，或一項檢查都沒執行
 *   77 略過（沒有 playwright、無法啟動 Chromium、無法連線）。
 *      略過不等於通過：npm run test:all 因此不會在 0 項瀏覽器檢查下顯示成功。
 *      確實要在沒有瀏覽器或網路的環境跑時，設 ALLOW_SKIP=1。
 */

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

/* ---------- 回報與退出碼 ---------- */

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SKIP_CODE = 77;
let skipped = false;   // 略過是整個程序的事實，與哪個 reporter 無關

const allowSkip = () => process.env.ALLOW_SKIP === '1';

/* 印出略過原因並記下來；不結束程序。部分案例仍可繼續跑（mobile 的離線案例）。 */
function skip(reason) {
  skipped = true;
  console.log('\x1b[33m略過：' + String(reason).trim() + '\x1b[0m');
}

/* 退出碼：失敗優先，其次未被允許的略過。 */
function exitCode(fail) {
  if (fail > 0) return 1;
  return skipped && !allowSkip() ? SKIP_CODE : 0;
}

function skipNote() {
  if (!skipped) return;
  console.log(allowSkip()
    ? '\x1b[33m（有項目略過；ALLOW_SKIP=1，視為可接受）\x1b[0m'
    : '\x1b[31m（有項目略過，不視為通過；退出碼 ' + SKIP_CODE + '，ALLOW_SKIP=1 可允許略過）\x1b[0m');
}

/* label 是摘要行的名稱，例如 reporter('CSP 相容性') 印出「CSP 相容性全部通過：N 項」；
 * 不給 label 時印「全部通過：N 項」。摘要文字與舊版逐字相同，供人與 CI 解析。 */
function reporter(label) {
  let pass = 0, fail = 0, finished = false;
  const r = {
    ok(name, cond, extra) {
      if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
      else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '\n      → ' + extra : '')); }
    },
    get pass() { return pass; },
    get fail() { return fail; },
    skip,
    /* 還沒跑任何檢查就得離開（缺 playwright、離線）：印原因並以略過碼結束。 */
    bail(reason) {
      skip(reason);
      skipNote();
      process.exit(exitCode(fail));
    },
    /* 印摘要並結束程序。重複呼叫只生效第一次。一項檢查都沒跑視為失敗，
     * 否則「全部通過：0 項」會讓壞掉的測試看起來是綠的。 */
    done() {
      if (finished) return;
      finished = true;
      if (pass + fail === 0) {
        console.log('\n\x1b[31m沒有執行任何檢查\x1b[0m');
        skipNote();
        process.exit(skipped && !allowSkip() ? SKIP_CODE : 1);
      }
      console.log('\n' + (fail === 0
        ? `\x1b[32m${label || ''}全部通過：${pass} 項\x1b[0m`
        : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
      skipNote();
      process.exit(exitCode(fail));
    },
  };
  return r;
}

/* 載入 playwright 並啟動 Chromium。任一步失敗就以略過碼結束（見檔頭）。
 * 回傳 { chromium, devices, browser }，呼叫端負責 browser.close()。 */
async function launchOrSkip(t) {
  const bail = reason => (t && t.bail ? t.bail(reason) : reporter().bail(reason));
  let pw;
  try { pw = require('playwright'); }
  catch (e) { return bail('未安裝 playwright'); }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { return bail('無法啟動 Chromium（' + String(e.message).split('\n')[0] + '）'); }
  return { chromium: pw.chromium, devices: pw.devices, browser };
}

/* ---------- 重試抓取 ---------- */

let nextSlot = 0;   // 節流用：下一個可送出請求的時間點，所有呼叫共用

/* 帶退避重試的 fetch。
 *   tries       嘗試次數（至少 1）
 *   backoff     第 i 次失敗後等 backoff * i 毫秒
 *   retryNotOk  true：非 2xx 也重試（站台偶發回 400）；false：回應一到就收下
 *   minGap      兩次請求之間至少相隔的毫秒數（對政府站台節流）。
 *               以預約時段實作，並行呼叫也會排隊，不會同時送出
 *   timeout     單次請求逾時毫秒，逾時視為失敗並重試
 *   fetch       替換底層的 fetch（簽章同 globalThis.fetch(url, init)），預設用內建的
 *   map         在重試迴圈內對 Response 做的轉換（如 r => r.text()）；
 *               轉換丟錯也算一次失敗。給了 map 就回傳轉換結果
 * 全部嘗試用完：丟出最後一次的例外；若最後一次是非 2xx 回應則回傳該回應
 * （有 map 時回傳 map 的結果）。呼叫端自行決定要不要把例外換成 null。 */
async function fetchRetry(url, opt) {
  const o = opt || {};
  const u = String(url == null ? '' : url).trim();
  if (!u) throw new TypeError('fetchRetry：網址為空');
  const tries = Math.max(1, Number(o.tries) || 3);
  const backoff = o.backoff == null ? 1500 : o.backoff;
  const retryNotOk = o.retryNotOk !== false;
  const timeout = o.timeout || 30000;
  for (let i = 1; ; i++) {
    if (o.minGap) {
      const slot = Math.max(Date.now(), nextSlot);
      nextSlot = slot + o.minGap;
      if (slot > Date.now()) await sleep(slot - Date.now());
    }
    try {
      const r = await (o.fetch || globalThis.fetch)(u, { headers: o.headers || UA, signal: AbortSignal.timeout(timeout) });
      const v = o.map ? await o.map(r) : r;
      if (r.ok || !retryNotOk || i >= tries) return v;
    } catch (e) {
      if (i >= tries) throw e;
    }
    await sleep(backoff * i);
  }
}

module.exports = { until, panelReady, injected, sleep, UA, reporter, skip, launchOrSkip, fetchRetry };
