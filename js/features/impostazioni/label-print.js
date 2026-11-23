// =============================================================
// label-print.js — Impostazioni › Stampa etichette
// =============================================================
// Si scelgono uno o più articoli e si crea un PDF A5 con i loro codici a barre (più etichette per pagina, attaccate l'una all'altra).
// Le misure dell'etichetta (larghezza, altezza in cm), le copie e le opzioni si possono cambiare e restano
// salvate sul telefono. Per ogni articolo si stampa il codice a barre principale.

import feedback from '../../shared/feedback.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { toastError, toastSuccess } from '../../shared/toast.js';
import { isAdmin } from '../../core/auth.js';
import { listProducts, getProductBarcodes } from '../../data/supabase.js';
import { generateLabelsPdf, getLabelSettings, saveLabelSettings, labelDescription, LABEL_LIMITS } from '../../shared/label-pdf.js';

const MAX_ROWS = 3000; // righe disegnate alla volta (un elenco di tutto il magazzino ci sta largamente)

const CATS = [
  ['', 'Tutti'],
  ['cuscinetti', 'Cuscinetti'],
  ['cinghie', 'Cinghie'],
  ['pezzi_ricambio', 'Ricambi'],
  ['__nobar', 'Senza barre'], // filtro speciale: solo gli articoli privi di codice a barre
];
const NOBAR = '__nobar';

const st = { overlay: null, products: [], selected: new Set(), grouped: new Set(), q: '', cat: '', settings: null, loaded: false };
let initialized = false;

const hasBarcode = (p) => getProductBarcodes(p).length > 0;
const cm = (mm) => String(Math.round(mm) / 10).replace('.', ',');
const toMm = (txt) => Number(String(txt).replace(',', '.')) * 10;

function build() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[92] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-lg h-[92vh] sm:h-[85vh] bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <h3 class="font-display font-bold text-lg uppercase tracking-wide">Stampa etichette</h3>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light">
          <i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i>
        </button>
      </div>
      <div class="px-5 pt-3 pb-2 shrink-0 space-y-2">
        <input data-role="q" type="text" autocomplete="off" placeholder="Cerca codice, descrizione, scaffale…" class="w-full rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 py-2.5 text-sm focus:border-amber-400 outline-none transition-colors">
        <div data-role="cats" class="flex gap-1.5 overflow-x-auto"></div>
        <div class="flex items-center justify-between gap-2">
          <p data-role="count" class="text-xs text-graphite-400"></p>
          <div class="flex gap-3 text-xs font-display font-semibold uppercase tracking-wide">
            <button type="button" data-act="all" class="text-amber-400 min-h-[32px]">Seleziona visibili</button>
            <button type="button" data-act="none" class="text-graphite-400 min-h-[32px]">Nessuno</button>
          </div>
        </div>
        <div data-role="grp-bulk" class="hidden flex items-center gap-2 text-[11px] font-display font-semibold uppercase tracking-wide">
          <span class="text-graphite-400">Selezionati:</span>
          <button type="button" data-act="grp-on" class="rounded-lg border border-graphite-700 bg-graphite-800 px-2.5 min-h-[32px] text-amber-400">In gruppo (senza barre)</button>
          <button type="button" data-act="grp-off" class="rounded-lg border border-graphite-700 bg-graphite-800 px-2.5 min-h-[32px] text-graphite-300">Con barre</button>
        </div>
      </div>
      <div data-role="list" class="flex-1 overflow-y-auto px-5 pb-3 space-y-1.5"></div>
      <div class="border-t border-graphite-800 px-5 pt-3 pb-4 shrink-0 space-y-3">
        <details data-role="params" class="rounded-lg border border-graphite-700 bg-graphite-800">
          <summary class="px-3.5 py-2.5 text-xs font-display font-semibold uppercase tracking-wide cursor-pointer select-none">Misure e opzioni</summary>
          <div class="px-3.5 pb-3 space-y-3">
            <div class="grid grid-cols-3 gap-2">
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Larghezza (cm)</span>
                <input data-set="labelW" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Altezza (cm)</span>
                <input data-set="labelH" inputmode="decimal" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
              <label class="block"><span class="ui-label uppercase tracking-wide text-graphite-500">Copie</span>
                <input data-set="copies" inputmode="numeric" type="text" class="mt-1 w-full rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none"></label>
            </div>
            <label class="flex items-center gap-2 text-sm"><input data-set="showDesc" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Descrizione sotto il nome dell'articolo</label>
            <label class="flex items-center gap-2 text-sm"><input data-set="cutBorder" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Linee tratteggiate per ritagliare (condivise tra etichette)</label>
            <label class="flex items-center gap-2 text-sm"><input data-set="multi" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Più codici in una etichetta (solo codice articolo, senza barre)</label>
            <label data-role="multi-row" class="flex items-center justify-between gap-2 text-sm">Codici per etichetta
              <select data-set="multiCount" class="rounded-lg bg-graphite-900 border border-graphite-700 px-2.5 py-2 font-mono text-sm focus:border-amber-400 outline-none">
                <option value="2">2 (uno sopra l'altro)</option>
                <option value="3">3 (tre righe)</option>
                <option value="4">4 (2 righe × 2 colonne)</option>
              </select></label>
            <p data-role="hint" class="text-xs text-graphite-400"></p>
          </div>
        </details>
        <button type="button" data-act="make" class="press-spring w-full rounded-lg py-3 font-display font-semibold uppercase tracking-wide bg-amber-400 text-white shadow-edge disabled:opacity-40">Crea PDF</button>
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
  q('[data-role="cats"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    feedback.filterChange();
    st.cat = b.dataset.cat;
    paintCats();
    paintList();
  });
  q('[data-act="all"]').addEventListener('click', () => {
    feedback.tap();
    visible().forEach((p) => st.selected.add(String(p.id)));
    paintList();
  });
  const bulk = (on) => {
    feedback.tap();
    st.selected.forEach((id) => (on ? st.grouped.add(id) : st.grouped.delete(id)));
    paintList();
  };
  q('[data-act="grp-on"]').addEventListener('click', () => bulk(true));
  q('[data-act="grp-off"]').addEventListener('click', () => bulk(false));
  // Interruttore per riga: "Barre" (etichetta classica) ↔ "Gruppo" (insieme ad altri, solo codice articolo)
  q('[data-role="list"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-grp]');
    if (!b) return;
    e.preventDefault();
    feedback.tap();
    const id = String(b.dataset.grp);
    if (st.grouped.has(id)) st.grouped.delete(id);
    else st.grouped.add(id);
    paintGrpBtn(b, st.grouped.has(id));
    paintCount();
  });
  q('[data-act="none"]').addEventListener('click', () => {
    feedback.tap();
    st.selected.clear();
    paintList();
  });
  q('[data-role="list"]').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-id]');
    if (!cb) return;
    const id = String(cb.dataset.id); // gli id possono essere testo (UUID): Number() li trasformerebbe in NaN
    if (cb.checked) st.selected.add(id);
    else st.selected.delete(id);
    paintCount();
  });
  q('[data-act="make"]').addEventListener('click', makePdf);

  // Misure e opzioni: si salvano a ogni modifica
  overlay.querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener('change', readSettings);
  });
  window.lucide?.createIcons();
}

function paintSettings() {
  const s = st.settings;
  const set = (k) => st.overlay.querySelector(`[data-set="${k}"]`);
  set('labelW').value = cm(s.labelW);
  set('labelH').value = cm(s.labelH);
  set('copies').value = String(s.copies);
  set('showDesc').checked = s.showDesc;
  set('cutBorder').checked = s.cutBorder;
  set('multi').checked = s.multi;
  set('multiCount').value = String(s.multiCount);
  st.overlay.querySelector('[data-role="multi-row"]').classList.toggle('hidden', !s.multi);
  st.overlay.querySelector('[data-role="grp-bulk"]').classList.toggle('hidden', !s.multi);
  const [w0, w1] = LABEL_LIMITS.labelW;
  const [h0, h1] = LABEL_LIMITS.labelH;
  st.overlay.querySelector('[data-role="hint"]').textContent =
    `Misure reali di ogni etichetta: larghezza da ${cm(w0)} a ${cm(w1)} cm, altezza da ${cm(h0)} a ${cm(h1)} cm. Foglio A5 verticale. Per avere le misure esatte stampa al 100% ("dimensioni reali"), senza "adatta alla pagina".`;
}

function readSettings() {
  const get = (k) => st.overlay.querySelector(`[data-set="${k}"]`);
  st.settings = saveLabelSettings({
    labelW: toMm(get('labelW').value),
    labelH: toMm(get('labelH').value),
    copies: Number(get('copies').value),
    showDesc: get('showDesc').checked,
    cutBorder: get('cutBorder').checked,
    multi: get('multi').checked,
    multiCount: Number(get('multiCount').value),
  });
  paintSettings(); // riporta nei campi i valori corretti dentro i limiti
  if (st.loaded) paintList(); // mostra o nasconde l'interruttore Barre/Gruppo su ogni riga
  paintCount();
}

function paintCats() {
  st.overlay.querySelector('[data-role="cats"]').innerHTML = CATS.map(
    ([k, label]) =>
      `<button type="button" data-cat="${k}" class="shrink-0 min-h-[36px] rounded-lg border px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors ${
        st.cat === k ? 'bg-amber-400 border-amber-400 text-white' : 'bg-graphite-800 border-graphite-700 text-graphite-300'
      }">${label}</button>`
  ).join('');
}

/** Tutti gli articoli del magazzino (anche senza codice a barre) che rispettano ricerca e categoria */
function visible() {
  return st.products.filter((p) => {
    if (st.cat === NOBAR) {
      if (hasBarcode(p)) return false;
    } else if (st.cat && p.categoria !== st.cat) return false;
    if (!st.q) return true;
    const hay = [p.codice_articolo, labelDescription(p), p.locazione, p.macchina, ...getProductBarcodes(p).map((b) => b.codice_barre)]
      .join(' ')
      .toLowerCase();
    return st.q.split(/\s+/).every((t) => hay.includes(t));
  });
}

const GRP_BASE = 'ml-auto shrink-0 rounded-md border px-2 py-1 text-[11px] font-display font-bold uppercase tracking-wide';
function paintGrpBtn(btn, on) {
  btn.textContent = on ? 'Gruppo' : 'Barre';
  btn.className = `${GRP_BASE} ${on ? 'bg-amber-400 border-amber-400 text-white' : 'bg-graphite-800 border-graphite-700 text-graphite-300'}`;
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Va in un\'etichetta con altri codici, solo codice articolo' : 'Etichetta classica con codice a barre';
}

function paintCount() {
  const n = st.selected.size;
  const shown = visible().length;
  const noBar = st.products.filter((p) => st.selected.has(String(p.id)) && !hasBarcode(p) && !(st.settings.multi && st.grouped.has(String(p.id)))).length;
  st.overlay.querySelector('[data-role="count"]').textContent =
    `${n} selezionat${n === 1 ? 'o' : 'i'} · ${shown} articoli${noBar ? ` · ${noBar} senza codice a barre` : ''}`;
  const btn = st.overlay.querySelector('[data-act="make"]');
  btn.disabled = n === 0;
  const grp = st.settings.multi ? [...st.selected].filter((id) => st.grouped.has(id)).length : 0;
  const labels = n - grp + Math.ceil(grp / st.settings.multiCount);
  if (!btn.dataset.busy) btn.textContent = n ? `Crea PDF (${labels * st.settings.copies} etichett${labels * st.settings.copies === 1 ? 'a' : 'e'})` : 'Crea PDF';
}

function paintList() {
  const list = st.overlay.querySelector('[data-role="list"]');
  const rows = visible();
  if (!rows.length) {
    list.innerHTML = '<p class="text-sm text-graphite-400 text-center py-10">Nessun articolo trovato.</p>';
    paintCount();
    return;
  }
  list.innerHTML =
    rows
      .slice(0, MAX_ROWS)
      .map((p) => {
        const desc = labelDescription(p);
        return `
      <label class="flex items-center gap-3 rounded-lg border border-graphite-700 bg-graphite-800 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" data-id="${p.id}" ${st.selected.has(String(p.id)) ? 'checked' : ''} class="w-5 h-5 shrink-0 accent-[var(--accent)]">
        <span class="min-w-0">
          <span class="block font-mono font-bold text-sm truncate">${escapeHtml(p.codice_articolo)}</span>
          ${hasBarcode(p) ? '' : '<span class="inline-block my-0.5 rounded px-1.5 py-px text-[10px] font-display font-bold uppercase tracking-wide bg-red-100 text-red-700 border border-red-300">No codice a barre</span>'}
          <span class="block text-xs text-graphite-400 truncate">${escapeHtml(desc || '—')}</span>
        </span>
        ${st.settings.multi ? `<button type="button" data-grp="${p.id}" class="${GRP_BASE} ${st.grouped.has(String(p.id)) ? 'bg-amber-400 border-amber-400 text-white' : 'bg-graphite-800 border-graphite-700 text-graphite-300'}" aria-pressed="${st.grouped.has(String(p.id))}">${st.grouped.has(String(p.id)) ? 'Gruppo' : 'Barre'}</button>` : ''}
      </label>`;
      })
      .join('') +
    (rows.length > MAX_ROWS ? `<p class="text-xs text-graphite-400 text-center py-3">Altri ${rows.length - MAX_ROWS} articoli: restringi la ricerca.</p>` : '');
  paintCount();
}

async function makePdf() {
  readSettings();
  const items = st.products
    .filter((p) => st.selected.has(String(p.id)))
    .map((p) => ({
      barcode: getProductBarcodes(p)[0]?.codice_barre || '',
      code: p.codice_articolo,
      description: labelDescription(p),
      group: st.settings.multi && st.grouped.has(String(p.id)),
    }));
  const noBar = items.filter((i) => !i.barcode && !i.group).length; // gli articoli "in gruppo" non stampano comunque le barre
  const btn = st.overlay.querySelector('[data-act="make"]');
  setButtonBusy(btn, true, 'Creo il PDF…');
  try {
    const { labels, pages } = await generateLabelsPdf(items, st.settings);
    feedback.confirmAction();
    toastSuccess(
      `PDF creato: ${labels} etichett${labels === 1 ? 'a' : 'e'} su ${pages} pagin${pages === 1 ? 'a' : 'e'} A5.` +
        (noBar ? ` ${noBar} articol${noBar === 1 ? 'o' : 'i'} senza codice a barre: stampat${noBar === 1 ? 'o' : 'i'} solo con il testo.` : '')
    );
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile creare il PDF.');
  } finally {
    setButtonBusy(btn, false);
    paintCount();
  }
}

async function open() {
  if (!st.overlay) build();
  feedback.tap();
  st.settings = getLabelSettings();
  paintSettings();
  paintCats();
  openOverlay(st.overlay);
  const list = st.overlay.querySelector('[data-role="list"]');
  if (!st.loaded) list.innerHTML = '<div class="space-y-2"><div class="skeleton h-14 w-full"></div><div class="skeleton h-14 w-full"></div><div class="skeleton h-14 w-full"></div></div>';
  try {
    st.products = await listProducts({ allPages: true }); // tutto il magazzino, anche gli articoli senza codice a barre
    st.selected = new Set([...st.selected].filter((id) => st.products.some((p) => String(p.id) === id)));
    st.loaded = true;
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
