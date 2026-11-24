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
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
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
  ['__nobar', 'Senza barre'], // filtro speciale: solo gli articoli privi di codice a barre
];
const NOBAR = '__nobar';

const st = {
  overlay: null,
  products: [],
  byId: new Map(),
  selected: new Set(), // id spuntati, nell'ordine in cui sono stati spuntati
  queue: [], // lista "Da stampare": { key, kind: 'single' | 'group', ids: [] }
  q: '',
  cat: '',
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

const NOBAR_TAG =
  '<span class="inline-block rounded px-1.5 py-px text-[10px] font-display font-bold uppercase tracking-wide bg-red-100 text-red-700 border border-red-300">No codice a barre</span>';

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
        <input data-role="q" type="text" autocomplete="off" placeholder="Cerca codice, descrizione, scaffale…"
          class="w-full rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 py-2.5 text-sm outline-none focus:border-amber-400">
        <div data-role="cats" class="flex gap-1.5 overflow-x-auto"></div>
        <div class="flex items-center justify-between gap-2">
          <p data-role="count" class="text-xs text-graphite-400"></p>
          <div class="flex gap-3 text-xs font-display font-semibold uppercase tracking-wide">
            <button type="button" data-act="all" class="text-amber-400 min-h-[32px]">Seleziona visibili</button>
            <button type="button" data-act="none" class="text-graphite-400 min-h-[32px]">Nessuno</button>
          </div>
        </div>
      </div>

      <div data-role="list" class="flex-1 overflow-y-auto px-5 pb-3 space-y-1.5"></div>

      <div class="border-t border-graphite-800 px-5 pt-3 pb-4 shrink-0 space-y-2.5">
        <div data-role="selbar" class="hidden rounded-lg border border-amber-400/40 bg-graphite-800 p-2.5 space-y-2">
          <p data-role="seltext" class="text-xs font-display font-semibold uppercase tracking-wide text-graphite-300"></p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" data-act="add-single" class="press-spring rounded-lg border border-graphite-700 bg-graphite-900 min-h-[40px] px-2 text-xs font-display font-semibold uppercase tracking-wide text-graphite-200">Aggiungi singole</button>
            <button type="button" data-act="add-group" class="press-spring rounded-lg border border-amber-400 bg-graphite-900 min-h-[40px] px-2 text-xs font-display font-semibold uppercase tracking-wide text-amber-400 disabled:opacity-40 disabled:border-graphite-700 disabled:text-graphite-400"></button>
          </div>
        </div>

        <details data-role="queue-box" class="hidden rounded-lg border border-graphite-700 bg-graphite-800">
          <summary class="px-3.5 py-2.5 text-xs font-display font-semibold uppercase tracking-wide cursor-pointer select-none"><span data-role="queue-title">Da stampare</span></summary>
          <div class="px-3 pb-3 space-y-1.5">
            <div data-role="queue-list" class="space-y-1.5 max-h-40 overflow-y-auto"></div>
            <button type="button" data-act="queue-clear" class="text-xs font-display font-semibold uppercase tracking-wide text-graphite-400 min-h-[32px]">Svuota lista</button>
          </div>
        </details>

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
            <label class="flex items-center gap-2 text-sm"><input data-set="cutBorder" type="checkbox" class="w-4 h-4 accent-[var(--accent)]"> Linee tratteggiate per ritagliare</label>
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
  set('showDesc').checked = s.showDesc;
  set('cutBorder').checked = s.cutBorder;
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
  });
  paintSettings(); // riporta nei campi i valori corretti dentro i limiti
  paintAll();
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

/** Numero di etichette (prima delle copie) che il PDF conterrebbe adesso: lista "Da stampare" + selezione come singole */
const pendingCount = () => st.queue.length + st.selected.size;

function paintList() {
  const list = st.overlay.querySelector('[data-role="list"]');
  const rows = visible();
  if (!rows.length) {
    list.innerHTML = '<p class="text-sm text-graphite-400 text-center py-10">Nessun articolo trovato.</p>';
    paintAll();
    return;
  }
  list.innerHTML = rows
    .map((p) => {
      const desc = labelDescription(p);
      return `
      <label class="flex items-center gap-3 rounded-lg border border-graphite-700 bg-graphite-800 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" data-id="${p.id}" ${st.selected.has(String(p.id)) ? 'checked' : ''} class="w-5 h-5 shrink-0 accent-[var(--accent)]">
        <span class="min-w-0">
          <span class="block font-mono font-bold text-sm truncate">${escapeHtml(p.codice_articolo)}</span>
          ${hasBarcode(p) ? '' : `<span class="block my-0.5">${NOBAR_TAG}</span>`}
          <span class="block text-xs text-graphite-400 truncate">${escapeHtml(desc || '—')}</span>
        </span>
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

  q('[data-role="count"]').textContent = `${n} selezionat${plural(n, 'o', 'i')} · ${shown} articoli`;

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
      const label =
        it.kind === 'group'
          ? `<span class="text-[10px] font-display font-bold uppercase tracking-wide text-amber-400">Gruppo ${it.ids.length}</span> ${it.ids.map((id) => escapeHtml(codeOf(id))).join(' · ')}`
          : `${escapeHtml(codeOf(it.ids[0]))} ${st.byId.get(it.ids[0]) && !hasBarcode(st.byId.get(it.ids[0])) ? NOBAR_TAG : ''}`;
      return `<div class="flex items-center gap-2 rounded-md bg-graphite-900 border border-graphite-700 px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate font-mono text-xs font-bold">${label}</span>
        <button type="button" data-rm="${it.key}" aria-label="Rimuovi" class="shrink-0 w-7 h-7 rounded-md text-graphite-400 text-lg leading-none">×</button>
      </div>`;
    })
    .join('');

  // Pulsante finale
  const total = pendingCount();
  const labels = total * (st.settings?.copies || 1);
  const btn = q('[data-act="make"]');
  btn.disabled = total === 0;
  if (!btn.dataset.busy) btn.textContent = total ? `Crea PDF (${labels} etichett${plural(labels, 'a', 'e')})` : 'Crea PDF';
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
