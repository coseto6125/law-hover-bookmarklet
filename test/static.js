/* 靜態檢查：找出「用到但沒定義」的識別子
 *
 * 背景：重構時誤刪 lyLink / lyUrlFor，語法檢查（vm.Script）完全抓不到，
 * 只有真實瀏覽器跑到那一行才會爆「lyLink is not defined」，
 * 而且是在 catch 內被吞成「查不到沿革」，極難察覺。
 * 這支測試在 AST 層級比對，讓這類問題在建置階段就失敗。
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '\n      → ' + e : '')); }
};

// 瀏覽器與標準內建物件
const GLOBALS = new Set([
  'window','document','location','navigator','screen','console','history',
  'fetch','Promise','Response','Request','Blob','URL','FormData','Headers',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'Object','Array','String','Number','Boolean','Math','JSON','Date','RegExp','Error',
  'Map','Set','WeakMap','WeakSet','Symbol','Proxy','Reflect','BigInt',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'encodeURI','decodeURI','escape','unescape','atob','btoa',
  'Uint8Array','Int8Array','Uint16Array','Uint32Array','Float32Array','Float64Array',
  'ArrayBuffer','DataView','TextDecoder','TextEncoder','DecompressionStream',
  'Node','NodeFilter','Element','HTMLElement','DOMParser','XMLHttpRequest',
  'MouseEvent','Event','CustomEvent','MutationObserver','IntersectionObserver',
  'getComputedStyle','matchMedia','alert','confirm','prompt','undefined','NaN','Infinity',
  'arguments','this','globalThis','structuredClone','queueMicrotask','CSS','Image',
]);

function analyse(file, srcText) {
  const src = srcText !== undefined ? srcText : fs.readFileSync(path.join(root, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script' });

  // 收集所有宣告（函式、var、參數、catch 參數、具名函式運算式）
  const declared = new Set();
  const addPattern = p => {
    if (!p) return;
    if (p.type === 'Identifier') declared.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(x => addPattern(x.value || x.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(addPattern);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  walk.full(ast, node => {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      if (node.id) declared.add(node.id.name);
      node.params.forEach(addPattern);
    } else if (node.type === 'ArrowFunctionExpression') {
      node.params.forEach(addPattern);
    } else if (node.type === 'VariableDeclarator') {
      addPattern(node.id);
    } else if (node.type === 'CatchClause') {
      addPattern(node.param);
    } else if (node.type === 'ClassDeclaration' && node.id) {
      declared.add(node.id.name);
    } else if (node.type === 'LabeledStatement') {
      declared.add(node.label.name);
    }
  });

  // 收集所有「被讀取」的識別子（排除屬性名、物件字面值的 key、label）
  const used = new Map();
  walk.ancestor(ast, {
    Identifier(node, _st, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;
      if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
      if (parent.type === 'MethodDefinition' && parent.key === node) return;
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' ||
          parent.type === 'ContinueStatement') return;
      if (!used.has(node.name)) used.set(node.name, node.start);
    },
  });

  const missing = [];
  for (const [name, pos] of used) {
    if (declared.has(name) || GLOBALS.has(name)) continue;
    const line = src.slice(0, pos).split('\n').length;
    missing.push(name + '（第 ' + line + ' 行）');
  }
  return { missing, declared: declared.size, used: used.size };
}

console.log('\n\x1b[1m未定義識別子檢查\x1b[0m');
for (const f of ['src/lawhover.js']) {
  const r = analyse(f);
  ok(f + '：無未定義識別子（宣告 ' + r.declared + '、使用 ' + r.used + '）',
     r.missing.length === 0, r.missing.join(', '));
}

console.log('\n\x1b[1m建置產物同樣檢查\x1b[0m');
{
  const zlib = require('zlib');
  const raw = fs.readFileSync(path.join(root, 'dist/lawhover.bookmarklet.txt'), 'utf8');
  const loader = decodeURIComponent(raw.slice('javascript:'.length));
  const b64 = (loader.match(/atob\("([A-Za-z0-9\-_=]+)"/) || [])[1];
  if (!b64) { ok('可取出建置產物', false, '未找到內嵌內容'); }
  else {
    const code = zlib.gunzipSync(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString();
    const r = analyse('dist（解壓後）', code);
    ok('壓縮後仍無未定義識別子', r.missing.length === 0, r.missing.join(', '));
  }
}

console.log('\n' + (fail === 0
  ? `\x1b[32m靜態檢查全部通過：${pass} 項\x1b[0m`
  : `\x1b[31m通過 ${pass}，失敗 ${fail}\x1b[0m`));
process.exit(fail === 0 ? 0 : 1);
