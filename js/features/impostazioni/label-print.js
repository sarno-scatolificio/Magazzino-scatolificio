// =============================================================
// label-print.js — Impostazioni › Stampa etichette
// =============================================================
// Flusso in 3 passi, pensato per essere veloce:
//  1. si spuntano gli articoli (l'elenco mostra TUTTO il magazzino; chi non ha codice a barre ha il tag "No codice a barre");
//  2. di norma basta "Crea PDF": ogni articolo spuntato diventa un'etichetta singola con codice a barre.
//     Per mettere più codici nella stessa etichetta si spuntano 2–4 articoli e si tocca "Unisci in 1 etichetta":
//     finiscono nella lista "Da stampare" come etichetta di gruppo (solo codici articolo). Si può ripetere quante volte si vuole:
//     un gruppo da 2, uno da 3, uno da 4 e le singole possono stare tutti nello stesso PDF;
//  3. "Crea PDF" stampa la lista "Da stampare" + gli articoli ancora spuntati come singole.
// Misure reali dell'etichetta, copie e opzioni restano salvate sul dispositivo.

import feedback from '../../shared/feedback.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy, syncSegIndicator } from '../../shared/ui-utils.js';
import { catIconHtml } from '../movimenti/movements.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { toastError, toastSuccess } from '../../shared/toast.js';
import { isAdmin } from '../../core/auth.js';
import { listProducts, getProductBarcodes } from '../../data/supabase.js';
import { generateLabelsPdf, getLabelSettings, saveLabelSettings, labelDescription, LABEL_LIMITS, GROUP_LIMITS } from '../../shared/label-pdf.js';

const CATS = [
  ['', 'Tutti'],
  ['cuscinetti', 'Cuscinetti'],
  ['cinghie', 'Cinghie'],
  ['pezzi_ricambio', 'Ricambi'],
];

const st = {
  overlay: null,
  products: [],
  byId: new Map(),
  selected: new Set(), // id spuntati, nell'ordine in cui sono stati spuntati
  queue: [], // lista "Da stampare": { key, kind: 'single' | 'group', ids: [] }
  q: '',
  cat: '',
  onlyNoBar: false, // filtro "Senza barre": solo gli articoli privi di codice a barre
  settings: null,
  loaded: false,
};
let initialized = false;
let queueSeq = 0;

const hasBarcode = (p) => getProductBarcodes(p).length > 0;
const cm = (mm) => String(Math.round(mm) / 10).replace('.', ',');
const toMm = (txt) => Number(String(txt).replace(',', '.')) * 10;
const plural = (n, one, many) => (n === 1 ? one : many);
const codeOf = (id) => st.byId.get(id)?.codice_articolo || '?';

const NOBAR_TAG = '<span class="lp-nobar font-display">No codice a barre</span>';
const SEG_BTN =
  'category-tab flex-1 min-w-0 rounded-md min-h-[40px] px-1 py-1.5 flex items-center justify-center text-center leading-tight text-[11px] font-display font-semibold uppercase tracking-wide';

function build() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[92] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-lg h-[92vh] sm:h-[85vh] bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center gap-3 px-5 pb-3 pt-1 sm:pt-4 border-b border-graphite-800 shrink-0">
        <span class="lp-head-ico"><i data-lucide="printer" class="w-5 h-5" stroke-width="2.2"></i></span>
        <div class="min-w-0 flex-1">
          <h3 class="font-display font-bold text-lg uppercase tracking-wide leading-tight">Stampa etichette</h3>
          <p class="text-xs text-graphite-400">Scegli gli articoli, poi crea il PDF</p>
        </div>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light">
          <i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i>
        </button>
      </div>

      <div class="px-5 pt-3 pb-2 shrink-0 space-y-2.5">
        <div class="relative">
          <i data-lucide="search" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-graphite-400 pointer-events-none"></i>
          <input data-role="q" type="text" autocomplete="off" placeholder="Cerca codice, descrizione, scaffale…"
            class="w-full rounded-xl bg-graphite-800 border border-graphite-700 pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-amber-400">
        </div>
        <div data-role="seg" class="seg flex w-full rounded-lg border border-graphite-700 bg-graphite-800 p-0.5" role="tablist">
          <span class="seg-indicator" aria-hidden="true"></span>
          ${CATS.map(([k, label]) => `<button type="button" role="tab" data-cat="${k}" class="${SEG_BTN}${k === '' ? ' category-tab-active' : ''}">${label}</button>`).join('')}
        </div>
        <div class="flex items-center justify-between gap-2">
          <button type="button" data-act="nobar" aria-pressed="false" class="lp-filter press-spring font-display"><i data-lucide="triangle-alert" class="w-3.5 h-3.5"></i><span data-role="nobar-label">Senza barre</span></button>
          <div class="flex gap-3 text-xs font-display font-semibold uppercase tracking-wide">
            <button type="button" data-act="all" class="text-amber-400 min-h-[36px]">Seleziona visibili</button>
            <button type="button" data-act="none" class="text-graphite-400 min-h-[36px]">Nessuno</button>
          </div>
        </div>
      </div>

      <div data-role="list" class="flex-1 overflow-y-auto px-5 pb-3 space-y-1.5"></div>

      <div class="border-t border-graphite-800 px-5 pt-3 pb-4 shrink-0 space-y-2.5">
        <div data-role="selbar" class="lp-selbar hidden space-y-2">
          <p data-role="seltext" class="text-xs font-display font-bold uppercase tracking-wide"></p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" data-act="add-single" class="lp-selbtn press-spring font-display">Aggiungi singole</button>
            <button type="button" data-act="add-group" class="lp-selbtn lp-selbtn--solid press-spring font-display"></button>
          </div>
        </div>

        <details data-role="queue-box" class="lp-queue hidden">
          <summary class="flex items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer select-none">
            <span data-role="queue-title" class="text-xs font-display font-bold uppercase tracking-wide">Da stampare</span>
            <i data-lucide="chevron-down" class="lp-chev w-4 h-4 text-graphite-400"></i>
          </summary>
          <div class="px-3 pb-3 space-y-1.5">
            <div data-role="queue-list" class="space-y-1.5 max-h-40 overflow-y-auto"></div>
            <button type="button" data-act="queue-clear" class="text-xs font-display font-semibold uppercase tracking-wide text-graphite-400 min-h-[32px]">Svuota lista</button>
          </div>
        </details>

        <details data-role="params" class="lp-queue">
          <summary class="flex items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer select-none">
            <span class="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wide"><i data-lucide="ruler" class="w-4 h-4 text-graphite-400"></i>Misure e opzioni</span>
            <span data-role="params-sum" class="text-xs font-mono text-graphite-400"></span>
          </summary>
          <div class="px-3.5 pb-3.5 space-y-3">
            <div data-role="preview" class="lp-prev-wrap"></div>
            <div class="grid grid-cols-3 gap-2">
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Larghezza (cm)</span>
                <input data-set="labelW" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Altezza (cm)</span>
                <input data-set="labelH" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Copie</span>
                <input data-set="copies" inputmode="numeric" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Sposta in basso (mm)</span>
                <input data-set="offsetY" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Sposta a destra (mm)</span>
                <input data-set="offsetX" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
            </div>
            <label class="flex items-center gap-2 text-sm"><input data-set="showDesc" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Descrizione sotto il nome dell'articolo</label>
            <label class="flex items-center gap-2 text-sm"><input data-set="cutBorder" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Linee tratteggiate per ritagliare</label>
            <p data-role="hint" class="text-xs text-graphite-400"></p>
          </div>
        </details>

        <button type="button" data-act="make" class="press-spring w-full rounded-xl min-h-[48px] font-display font-bold uppercase tracking-wide bg-amber-400 text-white shadow-edge disabled:opacity-40 flex items-center justify-center gap-2"><i data-lucide="printer" class="w-5 h-5"></i><span data-role="make-label">Crea PDF</span></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  st.overlay = overlay;
  const q = (sel) => overlay.querySelector(sel);

  overlay.addEventListener('click', (e) => e.target === overlay && closeOverlay(overlay));
  enableSheetDrag(q('.modal-panel'), () => closeOverlay(overlay));
  q('[data-act="close"]').addEventListener('click', () => closeOverlay(overlay));

  q('[data-role="q"]').addEventListener('input', (e) => {
    st.q = e.target.value.trim().toLowerCase();
    paintList();
  });
  q('[data-role="seg"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    feedback.filterChange();
    st.cat = b.dataset.cat;
    paintCats();
    paintList();
  });
  q('[data-act="nobar"]').addEventListener('click', () => {
    feedback.filterChange();
    st.onlyNoBar = !st.onlyNoBar;
    paintCats();
    paintList();
  });

  q('[data-act="all"]').addEventListener('click', () => {
    feedback.tap();
    visible().forEach((p) => st.selected.add(String(p.id)));
    syncChecks();
    paintAll();
  });
  q('[data-act="none"]').addEventListener('click', () => {
    feedback.tap();
    st.selected.clear();
    syncChecks();
    paintAll();
  });
  q('[data-role="list"]').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-id]');
    if (!cb) return;
    const id = String(cb.dataset.id); // gli id possono essere testo (UUID): mai Number()
    if (cb.checked) st.selected.add(id);
    else st.selected.delete(id);
    paintAll();
  });

  // Passo 2: dalla selezione alla lista "Da stampare"
  q('[data-act="add-single"]').addEventListener('click', () => {
    if (!st.selected.size) return;
    feedback.confirmAction();
    [...st.selected].forEach((id) => st.queue.push({ key: ++queueSeq, kind: 'single', ids: [id] }));
    afterAdd();
  });
  q('[data-act="add-group"]').addEventListener('click', () => {
    const n = st.selected.size;
    if (n < GROUP_LIMITS[0] || n > GROUP_LIMITS[1]) return;
    feedback.confirmAction();
    st.queue.push({ key: ++queueSeq, kind: 'group', ids: [...st.selected] });
    afterAdd();
  });
  q('[data-role="queue-list"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    feedback.tap();
    st.queue = st.queue.filter((it) => String(it.key) !== b.dataset.rm);
    paintAll();
  });
  q('[data-act="queue-clear"]').addEventListener('click', () => {
    feedback.tap();
    st.queue = [];
    paintAll();
  });

  overlay.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', readSettings));
  q('[data-act="make"]').addEventListener('click', makePdf);
  window.lucide?.createIcons();
}

/** Dopo aver aggiunto alla lista: la selezione si svuota e la lista "Da stampare" si apre */
function afterAdd() {
  st.selected.clear();
  syncChecks();
  const box = st.overlay.querySelector('[data-role="queue-box"]');
  box.open = true;
  paintAll();
}

/** Riporta lo stato delle caselle sull'elenco già disegnato (senza ridisegnarlo: lo scorrimento resta dov'è) */
function syncChecks() {
  st.overlay.querySelectorAll('[data-role="list"] [data-id]').forEach((cb) => {
    cb.checked = st.selected.has(String(cb.dataset.id));
  });
}

function paintSettings() {
  const s = st.settings;
  const set = (k) => st.overlay.querySelector(`[data-set="${k}"]`);
  set('labelW').value = cm(s.labelW);
  set('labelH').value = cm(s.labelH);
  set('copies').value = String(s.copies);
  set('offsetY').value = String(s.offsetY).replace('.', ',');
  set('offsetX').value = String(s.offsetX).replace('.', ',');
  set('showDesc').checked = s.showDesc;
  set('cutBorder').checked = s.cutBorder;
  const [w0, w1] = LABEL_LIMITS.labelW;
  const [h0, h1] = LABEL_LIMITS.labelH;
  st.overlay.querySelector('[data-role="hint"]').textContent =
    `Misure reali di ogni etichetta: larghezza da ${cm(w0)} a ${cm(w1)} cm, altezza da ${cm(h0)} a ${cm(h1)} cm. Foglio A5 verticale. Per avere le misure esatte stampa al 100% ("dimensioni reali"), senza "adatta alla pagina". Se la stampante taglia l'alto del foglio, aumenta "Sposta in basso" (per esempio 5–10 mm).`;
}

function readSettings() {
  const get = (k) => st.overlay.querySelector(`[data-set="${k}"]`);
  st.settings = saveLabelSettings({
    labelW: toMm(get('labelW').value),
    labelH: toMm(get('labelH').value),
    copies: Number(get('copies').value),
    offsetY: Number(String(get('offsetY').value).replace(',', '.')),
    offsetX: Number(String(get('offsetX').value).replace(',', '.')),
    showDesc: get('showDesc').checked,
    cutBorder: get('cutBorder').checked,
  });
  paintSettings(); // riporta nei campi i valori corretti dentro i limiti
  paintAll();
}

function paintCats() {
  const seg = st.overlay.querySelector('[data-role="seg"]');
  seg.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.cat === st.cat));
  syncSegIndicator(seg);
  const nb = st.overlay.querySelector('[data-act="nobar"]');
  nb.setAttribute('aria-pressed', String(st.onlyNoBar));
  const total = st.products.filter((p) => !hasBarcode(p)).length;
  st.overlay.querySelector('[data-role="nobar-label"]').textContent = st.loaded ? `Senza barre · ${total}` : 'Senza barre';
}

/** Tutti gli articoli del magazzino (anche senza codice a barre) che rispettano ricerca e categoria */
function visible() {
  return st.products.filter((p) => {
    if (st.onlyNoBar && hasBarcode(p)) return false;
    if (st.cat && p.categoria !== st.cat) return false;
    if (!st.q) return true;
    const hay = [p.codice_articolo, labelDescription(p), p.locazione, p.macchina, ...getProductBarcodes(p).map((b) => b.codice_barre)]
      .join(' ')
      .toLowerCase();
    return st.q.split(/\s+/).every((t) => hay.includes(t));
  });
}

/** Numero di etichette (prima delle copie) che il PDF conterrebbe adesso: lista "Da stampare" + selezione come singole */
const pendingCount = () => st.queue.length + st.selected.size;

function paintList() {
  const list = st.overlay.querySelector('[data-role="list"]');
  const rows = visible();
  if (!rows.length) {
    list.innerHTML = `<div class="flex flex-col items-center gap-2 py-12 text-center text-graphite-400">
      <i data-lucide="${st.onlyNoBar ? 'circle-check' : 'search-x'}" class="w-8 h-8"></i>
      <p class="text-sm">${st.onlyNoBar ? 'Tutti gli articoli hanno un codice a barre.' : 'Nessun articolo trovato.'}</p></div>`;
    window.lucide?.createIcons();
    paintAll();
    return;
  }
  list.innerHTML = rows
    .map((p) => {
      const desc = labelDescription(p);
      return `
      <label class="lp-row">
        <input type="checkbox" data-id="${p.id}" ${st.selected.has(String(p.id)) ? 'checked' : ''} class="sr-only">
        <span class="shrink-0">${catIconHtml(p.categoria)}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-mono font-bold text-sm truncate">${escapeHtml(p.codice_articolo)}</span>
          ${hasBarcode(p) ? '' : `<span class="block my-0.5">${NOBAR_TAG}</span>`}
          <span class="block text-xs text-graphite-400 truncate">${escapeHtml(desc || '—')}</span>
        </span>
        <span class="lp-check" aria-hidden="true"></span>
      </label>`;
    })
    .join('');
  paintAll();
}

/** Aggiorna tutto ciò che dipende da selezione, lista "Da stampare" e copie (non ridisegna l'elenco articoli) */
function paintAll() {
  const q = (sel) => st.overlay.querySelector(sel);
  const n = st.selected.size;
  const shown = visible().length;

  q('[data-act="all"]').textContent = `Seleziona visibili (${shown})`;

  // Barra della selezione: compare appena c'è qualcosa di spuntato
  q('[data-role="selbar"]').classList.toggle('hidden', n === 0);
  const noBarSel = [...st.selected].filter((id) => st.byId.get(id) && !hasBarcode(st.byId.get(id))).length;
  q('[data-role="seltext"]').textContent = `${n} selezionat${plural(n, 'o', 'i')}${noBarSel ? ` · ${noBarSel} senza codice a barre` : ''}`;
  const g = q('[data-act="add-group"]');
  const okGroup = n >= GROUP_LIMITS[0] && n <= GROUP_LIMITS[1];
  g.disabled = !okGroup;
  g.textContent = okGroup ? `Unisci in 1 etichetta (${n})` : `Unisci (scegline ${GROUP_LIMITS[0]}–${GROUP_LIMITS[1]})`;

  // Lista "Da stampare"
  const box = q('[data-role="queue-box"]');
  box.classList.toggle('hidden', st.queue.length === 0);
  q('[data-role="queue-title"]').textContent = `Da stampare: ${st.queue.length} etichett${plural(st.queue.length, 'a', 'e')}`;
  q('[data-role="queue-list"]').innerHTML = st.queue
    .map((it) => {
      const p0 = st.byId.get(it.ids[0]);
      const label =
        it.kind === 'group'
          ? `<span class="lp-gtag font-display">Gruppo ${it.ids.length}</span><span class="truncate">${it.ids.map((id) => escapeHtml(codeOf(id))).join(' · ')}</span>`
          : `<span class="shrink-0">${catIconHtml(p0?.categoria)}</span><span class="truncate">${escapeHtml(codeOf(it.ids[0]))}</span>${p0 && !hasBarcode(p0) ? NOBAR_TAG : ''}`;
      return `<div class="lp-qrow">
        <span class="min-w-0 flex-1 flex items-center gap-2 font-mono text-xs font-bold">${label}</span>
        <button type="button" data-rm="${it.key}" aria-label="Rimuovi" class="shrink-0 w-8 h-8 rounded-md text-graphite-400 text-xl leading-none">×</button>
      </div>`;
    })
    .join('');

  // Pulsante finale
  const total = pendingCount();
  const labels = total * (st.settings?.copies || 1);
  const btn = q('[data-act="make"]');
  btn.disabled = total === 0;
  if (!btn.dataset.busy) btn.querySelector('[data-role="make-label"]').textContent = total ? `Crea PDF · ${labels} etichett${plural(labels, 'a', 'e')}` : 'Crea PDF';
  const sm = st.settings;
  if (sm) q('[data-role="params-sum"]').textContent = `${cm(sm.labelW)} × ${cm(sm.labelH)} cm · ${sm.copies}×`;
  paintPreview();
  window.lucide?.createIcons();
}

/** Anteprima indicativa dell'etichetta in scala (stesse proporzioni della misura impostata) con il primo articolo da stampare */
function paintPreview() {
  const box = st.overlay?.querySelector('[data-role="preview"]');
  if (!box || !st.settings) return;
  const { labelW: W, labelH: H, showDesc } = st.settings;
  const first = st.queue[0] || (st.selected.size ? { kind: 'single', ids: [[...st.selected][0]] } : null);
  const p = first && st.byId.get(first.ids[0]);
  const cqw = (mm) => `${((mm / W) * 100).toFixed(2)}cqw`; // millimetri reali → unità del riquadro (si scala con la larghezza)
  const ptMm = (pt) => pt * 0.3528;
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let inner = '';
  if (first?.kind === 'group') {
    const codes = first.ids.map(codeOf);
    const cols = codes.length === 4 ? 2 : 1;
    const rows = Math.ceil(codes.length / cols);
    const ch = H / rows;
    const pt = clampN(ch * 0.9, 9, 22);
    inner = codes
      .map((c, i) => {
        const x = (i % cols) * (W / cols);
        const y = Math.floor(i / cols) * ch;
        return `<b style="position:absolute;left:${cqw(x)};top:${cqw(y)};width:${cqw(W / cols)};height:${cqw(ch)};display:flex;align-items:center;justify-content:center;font-size:${cqw(ptMm(pt))}">${escapeHtml(c)}</b>`;
      })
      .join('');
    for (let r = 1; r < rows; r += 1) inner += `<i class="lp-pg" style="left:0;right:0;top:${cqw(r * ch)};height:1px"></i>`;
    if (cols === 2) inner += `<i class="lp-pg" style="top:0;bottom:0;left:${cqw(W / 2)};width:1px"></i>`;
  } else {
    const code = p ? p.codice_articolo : 'CODICE ARTICOLO';
    const desc = showDesc ? (p ? labelDescription(p) : 'Descrizione articolo') : '';
    const bar = p ? hasBarcode(p) : true;
    const barH = Math.min(14, Math.max(6, H * 0.2));
    const barW = Math.min(W - 4, Math.max(28, W * 0.55));
    const area = H - 3.2 - (bar ? barH + 1.4 : 0);
    const npt = clampN(area * 0.62, 9, 26);
    const seed = String(p ? getProductBarcodes(p)[0]?.codice_barre || '' : '123456');
    let h = 7; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let x = 0, on = true, rects = '';
    for (let i = 0; i < 44; i += 1) { h = (h * 1103515245 + 12345) >>> 0; const w = 1 + ((h >>> 16) % 3); if (on) rects += `<rect x="${x}" width="${w}" height="10"/>`; x += w; on = !on; }
    inner = `<div style="position:absolute;left:0;right:0;top:${cqw(1.6)};height:${cqw(area)};display:flex;flex-direction:column;justify-content:center;padding:0 ${cqw(2)}">
        <b style="font-size:${cqw(ptMm(npt))}">${escapeHtml(code)}</b>
        ${desc ? `<b style="font-weight:700;font-size:${cqw(ptMm(npt * 0.88))}">${escapeHtml(desc)}</b>` : ''}
      </div>
      ${bar ? `<svg viewBox="0 0 ${x} 10" preserveAspectRatio="none" style="position:absolute;left:50%;transform:translateX(-50%);bottom:${cqw(1.6)};width:${cqw(barW)};height:${cqw(barH)}" fill="#0d1117">${rects}</svg>` : ''}`;
  }
  box.innerHTML = `<div class="lp-prev" style="aspect-ratio:${W} / ${H};max-width:${clampN(W * 3.4, 140, 300)}px" aria-label="Anteprima indicativa">${inner}</div>
    <p class="mt-2 text-[11px] text-graphite-400 text-center">Anteprima indicativa${first ? '' : ' (esempio)'}</p>`;
}

/** Etichette da stampare nell'ordine: prima la lista "Da stampare", poi gli articoli ancora spuntati (singole) */
function buildSpecs() {
  const single = (id) => {
    const p = st.byId.get(id);
    return p ? { kind: 'single', barcode: getProductBarcodes(p)[0]?.codice_barre || '', code: p.codice_articolo, description: labelDescription(p) } : null;
  };
  const specs = [];
  for (const it of st.queue) {
    if (it.kind === 'group') specs.push({ kind: 'group', codes: it.ids.map(codeOf) });
    else specs.push(single(it.ids[0]));
  }
  for (const id of st.selected) specs.push(single(id));
  return specs.filter(Boolean);
}

async function makePdf() {
  readSettings();
  const specs = buildSpecs();
  if (!specs.length) {
    toastError('Scegli almeno un articolo.');
    return;
  }
  const noBar = specs.filter((s) => s.kind === 'single' && !s.barcode).length;
  const btn = st.overlay.querySelector('[data-act="make"]');
  setButtonBusy(btn, true, 'Creo il PDF…');
  try {
    const { labels, pages } = await generateLabelsPdf(specs, st.settings);
    feedback.confirmAction();
    toastSuccess(
      `PDF creato: ${labels} etichett${plural(labels, 'a', 'e')} su ${pages} pagin${plural(pages, 'a', 'e')} A5.` +
        (noBar ? ` ${noBar} articol${plural(noBar, 'o', 'i')} senza codice a barre: stampat${plural(noBar, 'o', 'i')} solo con il testo.` : '')
    );
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile creare il PDF.');
  } finally {
    setButtonBusy(btn, false);
    paintAll();
  }
}

async function open() {
  if (!st.overlay) build();
  feedback.tap();
  // Ogni apertura riparte pulita: nessuna selezione né lista residua
  st.selected.clear();
  st.queue = [];
  st.q = '';
  st.cat = '';
  st.onlyNoBar = false;
  st.overlay.querySelector('[data-role="q"]').value = '';
  st.settings = getLabelSettings();
  paintSettings();
  paintCats();
  paintAll();
  openOverlay(st.overlay);
  const list = st.overlay.querySelector('[data-role="list"]');
  if (!st.loaded) list.innerHTML = '<div class="space-y-2"><div class="skeleton h-14 w-full"></div><div class="skeleton h-14 w-full"></div><div class="skeleton h-14 w-full"></div></div>';
  try {
    st.products = await listProducts({ allPages: true }); // tutto il magazzino, anche gli articoli senza codice a barre
    st.byId = new Map(st.products.map((p) => [String(p.id), p]));
    st.loaded = true;
    paintCats();
    paintList();
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="text-sm text-graphite-400 text-center py-10">Impossibile caricare gli articoli. Controlla la connessione.</p>';
  }
}

export function initLabelPrint() {
  if (initialized) return;
  initialized = true;
  // La voce si affianca a "Gestione scaffali" (stessa grafica, solo Admin)
  const ref = document.getElementById('inventory-manage-btn') || document.getElementById('shelves-manage-btn');
  if (!ref) return;
  const btn = ref.cloneNode(true);
  btn.id = 'label-print-btn';
  const icon = btn.querySelector('svg, i');
  if (icon) {
    const fresh = document.createElement('i');
    fresh.setAttribute('data-lucide', 'printer');
    fresh.setAttribute('stroke-width', '2');
    fresh.className = 'w-[18px] h-[18px]';
    icon.replaceWith(fresh);
  }
  const title = btn.querySelector('.set-title');
  if (title) title.textContent = 'Stampa etichette';
  btn.classList.toggle('hidden', !isAdmin());
  btn.addEventListener('click', open);
  ref.insertAdjacentElement('afterend', btn);
  window.lucide?.createIcons();
}
