// =============================================================
// tools/check.mjs — Controlli automatici sul codice dell'app
// =============================================================
// Si lancia con `npm run check` (dalla cartella tools/) e gira da solo su GitHub a ogni push.
// Non serve il browser: legge i file e segnala gli errori che altrimenti si scoprirebbero solo
// usando l'app. Controlla:
//   1. ogni import punta a un file che esiste e a un nome che quel file esporta;
//   2. nessun nome usato senza essere definito (variabili dimenticate dopo uno spostamento di codice);
//   3. il service worker: i file dell'elenco esistono e nessun modulo usato dall'app manca all'elenco;
//   4. gli id letti con getElementById / $('...') esistono in index.html (o nei modelli HTML dei file JS).
// Esce con codice 1 se trova errori, così GitHub segna il controllo come fallito.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acorn = await (async () => {
  try { return await import('acorn'); }
  catch { return createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn'); } // solo per prove locali senza npm
})();

// Nomi che il browser o le librerie caricate da index.html mettono a disposizione
const GLOBALS = new Set(`Boolean Date Error Image Map Math Number Object Promise Set String URL URLSearchParams console createImageBitmap
document requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval window Array File Infinity fetch
localStorage sessionStorage undefined Event parseInt parseFloat crypto navigator Intl JSON RegExp Symbol WeakMap WeakSet Uint8Array
Uint8ClampedArray Float32Array ArrayBuffer Blob FileReader FormData AbortController Notification MutationObserver ResizeObserver
IntersectionObserver CustomEvent HTMLElement HTMLInputElement HTMLButtonElement Audio AudioContext webkitAudioContext performance
location history screen alert confirm prompt getComputedStyle matchMedia atob btoa encodeURIComponent decodeURIComponent encodeURI
decodeURI isNaN isFinite Reflect Proxy BigInt TextEncoder TextDecoder structuredClone queueMicrotask indexedDB caches self globalThis
XMLHttpRequest Response Request Headers Worker OffscreenCanvas ImageData DOMParser Node Element requestIdleCallback BarcodeDetector CSS
KeyboardEvent MouseEvent PointerEvent TouchEvent DOMException Path2D Option Range Selection Text SVGElement
XLSX JsBarcode Html5Qrcode lucide tailwind pdfjsLib jspdf jsPDF supabase`.split(/\s+/));

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// ---------- lettura dei moduli raggiungibili da index.html ----------
const html = read('index.html');
const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
const info = new Map(); // file -> { ast, exports:Set, stars:[], imports:[{src,names,line}] }

function parseModule(file) {
  const src = read(file);
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch (e) { err(`${file}: errore di sintassi — ${e.message}`); return null; }
  const ex = new Set(), stars = [], imps = [], dyn = [];
  const declNames = (p, add) => {
    if (!p) return;
    if (p.type === 'Identifier') add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => declNames(q.value || q.argument, add));
    else if (p.type === 'ArrayPattern') p.elements.forEach((e) => e && declNames(e, add));
    else if (p.type === 'AssignmentPattern') declNames(p.left, add);
    else if (p.type === 'RestElement') declNames(p.argument, add);
  };
  for (const n of ast.body) {
    if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) {
        if (n.declaration.id) ex.add(n.declaration.id.name);
        else n.declaration.declarations?.forEach((d) => declNames(d.id, (x) => ex.add(x)));
      }
      n.specifiers.forEach((s) => ex.add(s.exported.name));
      if (n.source) imps.push({ src: n.source.value, names: n.specifiers.map((s) => s.local.name), line: n.loc.start.line });
    } else if (n.type === 'ExportAllDeclaration') stars.push(n.source.value);
    else if (n.type === 'ExportDefaultDeclaration') ex.add('default');
    else if (n.type === 'ImportDeclaration') {
      imps.push({
        src: n.source.value, line: n.loc.start.line,
        names: n.specifiers.map((s) => (s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported.name)),
      });
    }
  }
  // import('./file.js') con percorso scritto per esteso
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') dyn.push(n.source.value);
    for (const k of Object.keys(n)) { if (k === 'type') continue; const v = n[k]; Array.isArray(v) ? v.forEach(walk) : v && typeof v.type === 'string' && walk(v); }
  })(ast);
  return { ast, src, exports: ex, stars, imports: imps, dynamic: dyn };
}

const resolveRel = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
const queue = [...entries];
while (queue.length) {
  const f = queue.shift();
  if (info.has(f)) continue;
  if (!exists(f)) { err(`index.html carica ${f}, ma il file non esiste`); continue; }
  const m = parseModule(f);
  if (!m) continue;
  info.set(f, m);
  for (const i of [...m.imports.map((x) => x.src), ...m.stars, ...m.dynamic]) {
    if (!i.startsWith('.')) continue;
    queue.push(resolveRel(f, i));
  }
}

// ---------- 1. import / export ----------
function allExports(f, seen = new Set()) {
  if (seen.has(f)) return new Set();
  seen.add(f);
  const m = info.get(f);
  if (!m) return new Set();
  const s = new Set(m.exports);
  for (const st of m.stars) allExports(resolveRel(f, st), seen).forEach((x) => s.add(x));
  return s;
}
for (const [f, m] of info) {
  for (const im of m.imports) {
    if (!im.src.startsWith('.')) continue;
    const target = resolveRel(f, im.src);
    if (!exists(target)) { err(`${f}:${im.line} importa ${im.src}, ma il file non esiste`); continue; }
    if (!info.has(target)) continue; // già segnalato (errore di sintassi)
    const ex = allExports(target);
    for (const n of im.names) if (n !== '*' && !ex.has(n)) err(`${f}:${im.line} importa «${n}» da ${target}, che non lo esporta`);
  }
}

// ---------- 2. nomi non definiti ----------
function undeclared(m) {
  const declared = new Set(); const used = new Map();
  const dp = (p) => { if (!p) return; switch (p.type) {
    case 'Identifier': declared.add(p.name); break;
    case 'ObjectPattern': p.properties.forEach((x) => dp(x.type === 'RestElement' ? x.argument : x.value)); break;
    case 'ArrayPattern': p.elements.forEach(dp); break;
    case 'AssignmentPattern': dp(p.left); break;
    case 'RestElement': dp(p.argument); break; } };
  (function walk(n, parent, key) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': declared.add(n.local.name); return;
      case 'MetaProperty': return;
      case 'FunctionDeclaration': if (n.id) declared.add(n.id.name); // eslint-disable-line no-fallthrough
      case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (n.type === 'FunctionExpression' && n.id) declared.add(n.id.name);
        n.params.forEach(dp); break;
      case 'ClassDeclaration': case 'ClassExpression': if (n.id) declared.add(n.id.name); break;
      case 'VariableDeclarator': dp(n.id); break;
      case 'CatchClause': dp(n.param); break;
      case 'Identifier':
        if (parent) {
          if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
          if (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) return;
          if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return;
          if (/^(Labeled|Break|Continue)/.test(parent.type) && key === 'label') return;
          if (parent.type === 'ExportSpecifier') return;
        }
        if (!used.has(n.name)) used.set(n.name, n.loc.start.line);
        return;
    }
    for (const k of Object.keys(n)) { if (['type', 'start', 'end', 'loc'].includes(k)) continue; const v = n[k];
      Array.isArray(v) ? v.forEach((c) => walk(c, n, k)) : v && typeof v.type === 'string' && walk(v, n, k); }
  })(m.ast, null, null);
  return [...used].filter(([name]) => !declared.has(name) && !GLOBALS.has(name));
}
for (const [f, m] of info) for (const [name, line] of undeclared(m)) err(`${f}:${line} usa «${name}», che non è definito in questo file (manca un import?)`);

// ---------- 3. service worker ----------
const sw = read('service-worker.js');
const block = sw.slice(sw.indexOf('const APP_SHELL = ['), sw.indexOf('];', sw.indexOf('const APP_SHELL = [')));
const shell = new Set([...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));
for (const f of shell) if (!exists(f)) err(`service-worker.js: «${f}» è nell'elenco ma il file non esiste`);
for (const f of info.keys()) if (!shell.has(f)) err(`service-worker.js: il modulo «${f}» è usato dall'app ma manca nell'elenco dei file in cache (offline non funzionerebbe)`);
for (const f of ['style.css', 'tailwind.config.js', 'manifest.json']) if (exists(f) && !shell.has(f)) err(`service-worker.js: manca «${f}» nell'elenco`);
if (!/CACHE_NAME\s*=\s*'[^']+'/.test(sw)) err('service-worker.js: non trovo CACHE_NAME');

// ---------- 4. id del DOM ----------
const known = new Set([...html.matchAll(/\bid="([^"$]+)"/g)].map((m) => m[1]));
for (const m of info.values()) for (const x of m.src.matchAll(/\bid=\\?"([^"\\$]+)\\?"/g)) known.add(x[1]); // id creati da modelli HTML nei file JS
for (const [f, m] of info) {
  for (const x of m.src.matchAll(/(?:getElementById|\$)\(\s*'([^'$]+)'\s*\)/g)) {
    if (!known.has(x[1])) warn(`${f}: cerca l'elemento con id «${x[1]}», che non esiste in index.html`);
  }
}

// ---------- esito ----------
const files = info.size;
if (warnings.length) { console.log(`\nAvvisi (${warnings.length}) — da controllare, non bloccano:`); [...new Set(warnings)].forEach((w) => console.log('  ! ' + w)); }
if (errors.length) { console.log(`\nERRORI (${errors.length}):`); errors.forEach((e) => console.log('  ✗ ' + e)); console.log('\nControllo FALLITO.'); process.exit(1); }
console.log(`\n✓ Controllo superato: ${files} moduli, import/export, nomi, service worker e id a posto.`);
