// =============================================================
// inventory.js — Inventario scaffale per scaffale (solo Admin)
// =============================================================
// Si apre da Impostazioni → Inventario. Flusso:
//  1. Scaffali: elenco per area e serie, con la data dell'ultimo inventario
//     (mai fatto / da rifare / recente) e le bozze in corso.
//  2. Conteggio: elenco guidato degli articoli attesi sullo scaffale. Un tocco conferma la
//     quantità attesa, oppure si scrive/aggiusta quella contata; la scansione del codice a
//     barre porta alla riga giusta (o propone di aggiungere un articolo non in elenco).
//     All'inizio si sceglie se vedere le quantità attese o contare alla cieca.
//     La bozza si salva da sola sul telefono: si può chiudere e riprendere in qualsiasi momento.
//  3. Riepilogo: confermati, corretti, aggiunti e non trovati. Gli articoli non contati
//     risultano a zero solo dopo conferma. Le giacenze cambiano soltanto qui, con un motivo.
//  4. Storico: inventari chiusi con le differenze, esportabili in Excel.
//
// Le correzioni sono registrate come rettifiche di inventario (tabelle inventari / inventario_righe):
// non sono depositi né prelievi e non alterano il Report né la vita utile dei ricambi.

import feedback from '../../shared/feedback.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import { closeOverlay, enableSheetDrag, loadLib, modalCloseMs, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { isAdmin } from '../../core/auth.js';
import { startCamera, stopCamera } from '../../shared/camera.js';
import {
  cacheProductsList,
  getCachedProductByBarcode,
  getProductByBarcode,
  getProductById,
  getProductLocations,
  listProducts,
  searchCachedProducts,
  setProductBarcodes,
} from '../../data/supabase-products.js';
import { isNetworkError } from '../../core/offline-queue.js';
import { toastError, toastInfo, toastSuccess, toastWarning } from '../../shared/toast.js';
import {
  closeInventory,
  GIORNI_INVENTARIO_VECCHIO,
  listExpectedForShelf,
  listInventories,
  listShelvesStatus,
  MOTIVI,
  normShelf,
  rowFromProduct,
} from '../../data/supabase-inventory.js';

const DRAFT_PREFIX = 'inventario-bozza:';
const CATEGORIE = { cuscinetti: 'Cuscinetto', cinghie: 'Cinghia', ricambi: 'Ricambio' };
const TIPO_LABEL = { confermato: 'Confermato', corretto: 'Corretto', aggiunto: 'Aggiunto', non_trovato: 'Non trovato' };

const BTN_STEP =
  'press-spring shrink-0 w-11 h-11 rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 flex items-center justify-center font-display font-bold text-lg leading-none';
// Come BTN_STEP ma senza hover: sul touch l'hover resta "appiccicato" dopo il tocco.
// L'effetto di pressione (scala) viene solo da :active (css press-spring) e sparisce al rilascio.
const BTN_STEP_OK = BTN_STEP.replace('hover:bg-graphite-700 ', 'inv-ok ');
const BTN_TOOL =
  'press-spring flex-1 min-h-[44px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 px-3 flex items-center justify-center gap-1.5 text-xs font-display font-semibold uppercase tracking-wide';
// Barra fissa del conteggio: tre pulsanti di pari larghezza (testo e icona centrati, mai a capo)
const BTN_BAR =
  'press-spring min-w-0 min-h-[44px] rounded-lg border border-graphite-700 bg-graphite-900 hover:bg-graphite-700 px-1.5 flex items-center justify-center gap-1.5 text-xs font-display font-semibold uppercase tracking-wide whitespace-nowrap transition-colors';
// Chip "aggiungi codice a barre" dentro la riga di un articolo che non ne ha
const BTN_CODE =
  'press-spring inline-flex items-center gap-1.5 min-h-[34px] rounded-full border border-amber-400/50 bg-amber-400/10 px-3 text-[11px] font-display font-semibold uppercase tracking-wide text-amber-300';
const ROW_BASE = 'inv-row rounded-xl border p-3 transition-colors';
const ROW_STATE = {
  todo: 'border-graphite-700 bg-graphite-800/40',
  ok: 'border-emerald-500/50 bg-emerald-500/10',
  diff: 'border-amber-400/60 bg-amber-400/10',
  zero: 'border-rose-500/50 bg-rose-500/10',
};

const st = {
  area: 'Magazzino',
  tab: 'scaffali', // 'scaffali' | 'storico'
  shelves: [],
  inventories: null,
  session: null, // { shelf, ciechi, startedAt, rows: [...] }
  onlyTodo: false,
  motivo: null,
  starting: false,
};
const els = {};

// ---------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------
const fmtDate = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const giorniFa = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Serie = lettere iniziali seguite da un numero (SA001 → SA). "Parete frontale" o "Cassa deposito" non hanno serie.
const serieDi = (nome) => (String(nome).match(/^([A-Za-zÀ-ÿ]{1,4})[\s.-]*\d/)?.[1] || '').toUpperCase();
const categoriaLabel = (c) => CATEGORIE[c] || String(c || '').replace(/_/g, ' ');
const e = escapeHtml;

function makeOverlay(z, panelClass, inner) {
  const overlay = document.createElement('div');
  overlay.className = `modal-overlay hidden fixed inset-0 z-[${z}] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4`;
  overlay.innerHTML = `<div class="modal-panel w-full ${panelClass} bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col">${inner}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

const skeletonHtml = '<div class="space-y-2"><div class="skeleton h-16 w-full"></div><div class="skeleton h-16 w-full"></div><div class="skeleton h-16 w-full"></div></div>';
const noticeHtml = (msg) => `<p class="text-sm text-graphite-400 text-center py-10">${e(msg)}</p>`;

// ---------------------------------------------------------------
// Bozza sul telefono
// ---------------------------------------------------------------
const draftKey = (nome) => DRAFT_PREFIX + normShelf(nome);

function readDraft(nome) {
  try {
    const raw = localStorage.getItem(draftKey(nome));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && Array.isArray(d.rows) && d.shelf ? d : null;
  } catch {
    return null;
  }
}
let saveTimer = null;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDraft, 250);
}
function flushDraft() {
  clearTimeout(saveTimer);
  if (!st.session) return;
  try {
    localStorage.setItem(draftKey(st.session.shelf), JSON.stringify(st.session));
  } catch {
    /* memoria piena o non disponibile: si continua senza bozza */
  }
}
function clearDraft(nome) {
  try {
    localStorage.removeItem(draftKey(nome));
  } catch {
    /* niente da fare */
  }
}
const contati = (rows) => rows.filter((r) => r.contato !== null).length;

/** Tutti gli inventari in corso salvati sul telefono (uno per scaffale) */
function allDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(key));
        if (d && Array.isArray(d.rows) && d.shelf) out.push({ key, shelf: d.shelf });
      } catch {
        /* bozza illeggibile: non si conta */
      }
    }
  } catch {
    /* memoria locale non disponibile */
  }
  return out;
}

/** Cancella i conteggi di uno o tutti gli inventari in corso (solo sul telefono: il database non viene toccato) */
async function discardDrafts(list, { title, message, confirmLabel }) {
  const ok = await confirmDialog({ title, message, confirmLabel, cancelLabel: 'No, tienili', danger: true });
  if (!ok) return false;
  clearTimeout(saveTimer);
  list.forEach((d) => {
    try {
      localStorage.removeItem(d.key);
    } catch {
      /* niente da fare */
    }
  });
  feedback.confirmAction();
  toastSuccess(list.length === 1 ? `Inventario ${list[0].shelf} annullato.` : `${list.length} inventari annullati.`, 3500);
  return true;
}

// ---------------------------------------------------------------
// Finestra di scelta (più opzioni)
// ---------------------------------------------------------------
function chooseDialog({ title, message, options }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className =
      'modal-overlay hidden fixed inset-0 z-[96] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
    const card = document.createElement('div');
    card.className = 'modal-panel modal-panel-card w-full sm:max-w-sm bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl p-5';
    card.innerHTML = `
      <div data-sheet-drag class="sheet-grabber sm:hidden -mt-5 mb-1"><span class="sheet-grabber-pill"></span></div>
      <p data-sheet-drag data-role="title" class="font-display font-bold text-lg leading-snug"></p>
      <p data-sheet-drag data-role="message" class="text-sm text-graphite-400 leading-relaxed mt-1.5"></p>
      <div data-role="opts" class="mt-4 space-y-2"></div>`;
    card.querySelector('[data-role="title"]').textContent = title;
    card.querySelector('[data-role="message"]').textContent = message || '';
    const box = card.querySelector('[data-role="opts"]');

    let settled = false;
    const settle = (value, silent = false) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      if (!silent) closeOverlay(overlay);
      setTimeout(() => overlay.remove(), modalCloseMs() + 60);
      resolve(value);
    };
    const onKey = (ev) => ev.key === 'Escape' && settle(null);

    options.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      const tone =
        o.kind === 'primary'
          ? 'bg-amber-400 hover:bg-amber-300 text-white border-transparent'
          : o.kind === 'danger'
            ? 'bg-rose-500 hover:bg-rose-400 text-white border-transparent'
            : 'border-graphite-700 hover:bg-graphite-800 text-graphite-200';
      b.className = `press-spring w-full rounded-lg border py-3 px-4 text-left transition-colors ${tone}`;
      const label = document.createElement('span');
      label.className = 'block font-display font-semibold uppercase tracking-wide text-sm';
      label.textContent = o.label;
      b.appendChild(label);
      if (o.hint) {
        const hint = document.createElement('span');
        hint.className = `block text-xs mt-0.5 normal-case tracking-normal font-normal ${o.kind ? 'opacity-90' : 'text-graphite-400'}`;
        hint.textContent = o.hint;
        b.appendChild(hint);
      }
      b.addEventListener('click', () => settle(o.value));
      box.appendChild(b);
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (ev) => ev.target === overlay && settle(null));
    overlay.addEventListener('overlay-cancel', () => settle(null, true)); // tasto indietro: la modale si chiude da sola
    enableSheetDrag(card, () => settle(null));
    document.addEventListener('keydown', onKey);
    openOverlay(overlay);
  });
}

// ---------------------------------------------------------------
// 1) ELENCO SCAFFALI + STORICO
// ---------------------------------------------------------------
function buildHome() {
  els.home = makeOverlay(
    92,
    'sm:max-w-lg h-[92vh] sm:h-[85vh]',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <h3 class="font-display font-bold text-lg uppercase tracking-wide">Inventario</h3>
      <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light">
        <i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i>
      </button>
    </div>
    <div class="px-5 pt-3 shrink-0 flex gap-2" data-role="tabs">
      <button type="button" data-tab="scaffali" class="flex-1 min-h-[44px] rounded-lg border px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors">Scaffali</button>
      <button type="button" data-tab="storico" class="flex-1 min-h-[44px] rounded-lg border px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors">Storico</button>
    </div>
    <div data-role="body" class="flex-1 overflow-y-auto px-5 py-3"></div>`
  );
  els.homeBody = els.home.querySelector('[data-role="body"]');
  const panel = els.home.querySelector('.modal-panel');
  els.home.addEventListener('click', (ev) => ev.target === els.home && closeOverlay(els.home));
  enableSheetDrag(panel, () => closeOverlay(els.home));
  els.home.querySelector('[data-act="close"]').addEventListener('click', () => closeOverlay(els.home));

  els.home.querySelector('[data-role="tabs"]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (!b || b.dataset.tab === st.tab) return;
    feedback.modeSelect();
    st.tab = b.dataset.tab;
    paintTabs();
    if (st.tab === 'storico') loadStorico();
    else paintHome();
  });

  els.homeBody.addEventListener('click', (ev) => {
    const area = ev.target.closest('[data-area]');
    if (area) {
      feedback.filterChange();
      st.area = area.dataset.area;
      paintHome();
      return;
    }
    const shelf = ev.target.closest('[data-i]');
    if (shelf && st.tab === 'scaffali') {
      startShelf(st.shelves[Number(shelf.dataset.i)], shelf);
      return;
    }
    const inv = ev.target.closest('[data-inv]');
    if (inv) {
      feedback.tap();
      const detail = els.homeBody.querySelector(`[data-detail="${inv.dataset.inv}"]`);
      detail?.classList.toggle('hidden');
      inv.querySelector('[data-chevron]')?.classList.toggle('rotate-180');
      return;
    }
    if (ev.target.closest('[data-act="discard-all"]')) {
      const bozze = allDrafts();
      discardDrafts(bozze, {
        title: bozze.length === 1 ? 'Annullare l\'inventario in corso?' : `Annullare i ${bozze.length} inventari in corso?`,
        message: 'Tutti i conteggi fatti finora vanno persi. Le giacenze non cambiano: non è stato registrato nulla.',
        confirmLabel: 'Annulla inventari',
      }).then((done) => done && paintHome());
      return;
    }
    if (ev.target.closest('[data-act="export"]')) exportExcel(ev.target.closest('[data-act="export"]'));
    if (ev.target.closest('[data-act="reload"]')) (st.tab === 'storico' ? loadStorico() : loadShelves());
  });
}

function paintTabs() {
  els.home.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === st.tab;
    b.className = `flex-1 min-h-[44px] rounded-lg border px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors ${
      on ? 'bg-amber-400 border-amber-400 text-white' : 'border-graphite-700 text-graphite-400 hover:bg-graphite-800'
    }`;
  });
}

async function openHome() {
  if (!isAdmin()) return;
  st.tab = 'scaffali';
  st.inventories = null;
  paintTabs();
  openOverlay(els.home);
  await loadShelves();
}

async function loadShelves() {
  els.homeBody.innerHTML = skeletonHtml;
  try {
    st.shelves = await listShelvesStatus();
    if (!st.shelves.some((s) => s.area === st.area) && st.shelves.length) st.area = st.shelves[0].area;
    if (st.tab === 'scaffali') paintHome();
  } catch (err) {
    console.error(err);
    if (st.tab !== 'scaffali') return;
    els.homeBody.innerHTML = `${noticeHtml(isNetworkError(err) ? 'Serve la connessione per vedere gli scaffali.' : 'Non è stato possibile leggere gli scaffali.')}
      <button type="button" data-act="reload" class="${BTN_TOOL} w-full">Riprova</button>`;
  }
}

function statoScaffale(s) {
  if (!s.ultimo) return { txt: 'Mai inventariato', cls: 'text-rose-700' };
  const g = giorniFa(s.ultimo);
  const quando = g <= 0 ? 'oggi' : g === 1 ? 'ieri' : `${g} giorni fa`;
  const base = `Inventariato il ${fmtDate(s.ultimo)} (${quando})`;
  return g > GIORNI_INVENTARIO_VECCHIO ? { txt: `${base} · da rifare`, cls: 'text-amber-300' } : { txt: base, cls: 'text-emerald-700' };
}

function paintHome() {
  if (st.tab !== 'scaffali') return;
  const areas = [...new Set(st.shelves.map((s) => s.area))];
  // Prima le serie (SA, SB…), poi gli scaffali senza serie
  const list = st.shelves
    .filter((s) => s.area === st.area)
    .sort(
      (a, b) =>
        (serieDi(a.nome) === '') - (serieDi(b.nome) === '') ||
        a.nome.localeCompare(b.nome, 'it', { numeric: true, sensitivity: 'base' })
    );
  const mai = list.filter((s) => !s.ultimo).length;
  const vecchi = list.filter((s) => s.ultimo && giorniFa(s.ultimo) > GIORNI_INVENTARIO_VECCHIO).length;

  const areaBtns = areas
    .map(
      (a) =>
        `<button type="button" data-area="${e(a)}" class="flex-1 min-h-[44px] rounded-lg border px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors ${
          a === st.area ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-graphite-700 text-graphite-400 hover:bg-graphite-800'
        }">${e(a)}</button>`
    )
    .join('');

  const bozze = allDrafts();
  let html = bozze.length
    ? `<button type="button" data-act="discard-all" class="${BTN_TOOL} w-full mb-3 !text-rose-700 !border-rose-500/50"><i data-lucide="trash-2" class="w-4 h-4"></i>Annulla ${bozze.length === 1 ? "l'inventario in corso" : `i ${bozze.length} inventari in corso`}</button>`
    : '';
  html += areas.length > 1 ? `<div class="flex gap-2 mb-3">${areaBtns}</div>` : '';
  if (!list.length) {
    els.homeBody.innerHTML = html + noticeHtml('Nessuno scaffale registrato. Si creano da Impostazioni → Gestione scaffali.');
    return;
  }
  html += `<p class="text-xs text-graphite-400 mb-1">${plural(list.length, 'scaffale', 'scaffali')} · ${mai} mai inventariati · ${vecchi} da rifare (oltre ${GIORNI_INVENTARIO_VECCHIO} giorni)</p>`;

  let serie = null;
  list.forEach((s) => {
    const idx = st.shelves.indexOf(s);
    const sr = serieDi(s.nome);
    if (sr !== serie) {
      serie = sr;
      html += `<p class="text-[11px] font-display font-semibold uppercase tracking-wider text-graphite-500 mt-4 mb-1.5">${sr ? `Serie ${e(sr)}` : 'Altri scaffali'}</p>`;
    }
    const stato = statoScaffale(s);
    const draft = readDraft(s.nome);
    const badge = draft
      ? `<span class="shrink-0 text-[11px] font-display font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 bg-amber-400/15 text-amber-300 border border-amber-400/40">In corso ${contati(draft.rows)}/${draft.rows.length}</span>`
      : '<i data-lucide="chevron-right" class="w-4 h-4 text-graphite-500 shrink-0"></i>';
    html += `<button type="button" data-i="${idx}" class="press-spring w-full text-left rounded-lg border border-graphite-700 bg-graphite-800/40 hover:bg-graphite-800 px-3.5 py-3 mb-2 flex items-center gap-3 transition-colors">
      <span class="min-w-0 flex-1">
        <span class="block font-display font-bold leading-tight">${e(s.nome)}</span>
        <span class="block text-xs text-graphite-400 mt-0.5">${plural(s.articoli, 'articolo', 'articoli')}</span>
        <span class="block text-xs mt-0.5 ${stato.cls}">${e(stato.txt)}</span>
      </span>${badge}</button>`;
  });
  els.homeBody.innerHTML = html;
  window.lucide?.createIcons();
}

// ---- Storico
async function loadStorico() {
  els.homeBody.innerHTML = skeletonHtml;
  try {
    st.inventories = await listInventories(100);
    if (st.tab === 'storico') paintStorico();
  } catch (err) {
    console.error(err);
    if (st.tab !== 'storico') return;
    els.homeBody.innerHTML = `${noticeHtml(isNetworkError(err) ? 'Serve la connessione per vedere lo storico.' : 'Non è stato possibile leggere lo storico.')}
      <button type="button" data-act="reload" class="${BTN_TOOL} w-full">Riprova</button>`;
  }
}

function paintStorico() {
  const list = st.inventories || [];
  if (!list.length) {
    els.homeBody.innerHTML = noticeHtml('Nessun inventario ancora registrato.');
    return;
  }
  let html = `<div class="flex items-center justify-between gap-3 mb-3">
    <p class="text-xs text-graphite-400">${plural(list.length, 'inventario', 'inventari')} (gli ultimi 100)</p>
    <button type="button" data-act="export" class="${BTN_TOOL} flex-none"><i data-lucide="download" class="w-4 h-4"></i>Excel</button>
  </div>`;
  list.forEach((inv, i) => {
    const righe = (inv.inventario_righe || []).filter((r) => r.differenza !== 0);
    righe.sort((a, b) => a.codice_articolo.localeCompare(b.codice_articolo, 'it', { numeric: true, sensitivity: 'base' }));
    const dettaglio = righe.length
      ? righe
          .map(
            (r) => `<div class="flex items-start justify-between gap-3 text-xs">
              <span class="min-w-0"><span class="font-display font-semibold">${e(r.codice_articolo)}</span>${r.descrizione ? `<span class="text-graphite-400"> · ${e(r.descrizione)}</span>` : ''}</span>
              <span class="shrink-0 text-graphite-300">${r.atteso} → <strong>${r.contato}</strong> <span class="text-graphite-500">(${e(TIPO_LABEL[r.tipo] || r.tipo)})</span></span>
            </div>`
          )
          .join('')
      : '<p class="text-xs text-graphite-400">Nessuna differenza: tutte le quantità erano giuste.</p>';
    html += `<div class="rounded-xl border border-graphite-700 bg-graphite-800/40 mb-2">
      <button type="button" data-inv="${i}" class="w-full text-left px-3.5 py-3 flex items-start gap-3">
        <span class="min-w-0 flex-1">
          <span class="block font-display font-bold leading-tight">${e(inv.locazione)}</span>
          <span class="block text-xs text-graphite-400 mt-0.5">${fmtDateTime(inv.created_at)}${inv.user_name ? ` · ${e(inv.user_name)}` : ''}</span>
          <span class="block text-xs mt-1">${plural(inv.articoli_totali, 'articolo', 'articoli')} · ${
            inv.con_differenza
              ? `<strong class="text-amber-300">${plural(inv.con_differenza, 'differenza', 'differenze')}</strong>`
              : '<span class="text-emerald-700">nessuna differenza</span>'
          }${inv.ciechi ? ' · alla cieca' : ''}</span>
          ${inv.motivo ? `<span class="inline-block mt-1.5 text-[11px] font-display font-semibold rounded-full px-2.5 py-0.5 bg-graphite-700/60 text-graphite-300">${e(inv.motivo)}</span>` : ''}
        </span>
        <i data-lucide="chevron-down" data-chevron class="w-4 h-4 text-graphite-500 shrink-0 mt-1 transition-transform"></i>
      </button>
      <div data-detail="${i}" class="hidden border-t border-graphite-800 px-3.5 py-2.5 space-y-1.5">${dettaglio}</div>
    </div>`;
  });
  els.homeBody.innerHTML = html;
  window.lucide?.createIcons();
}

async function exportExcel(btn) {
  const list = st.inventories || [];
  if (!list.length) {
    toastInfo('Nessun inventario da esportare.');
    return;
  }
  setButtonBusy(btn, true, 'Preparo…');
  try {
    await loadLib('xlsx');
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    const riepilogo = list.map((i) => ({
      'Chiusura': fmtDateTime(i.created_at),
      Scaffale: i.locazione,
      'Eseguito da': i.user_name || '',
      Modalità: i.ciechi ? 'Alla cieca' : 'Quantità attese visibili',
      Articoli: i.articoli_totali,
      'Con differenza': i.con_differenza,
      Motivo: i.motivo || '',
    }));
    const righe = [];
    list.forEach((i) =>
      (i.inventario_righe || []).forEach((r) =>
        righe.push({
          Chiusura: fmtDateTime(i.created_at),
          Scaffale: i.locazione,
          Codice: r.codice_articolo,
          Descrizione: r.descrizione || '',
          Categoria: categoriaLabel(r.categoria),
          Atteso: r.atteso,
          Contato: r.contato,
          Differenza: r.differenza,
          Esito: TIPO_LABEL[r.tipo] || r.tipo,
        })
      )
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo), 'Inventari');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(righe), 'Righe');
    XLSX.writeFile(wb, `inventari_${new Date().toISOString().slice(0, 10)}.xlsx`);
    feedback.confirmAction();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Esportazione non riuscita.');
  } finally {
    setButtonBusy(btn, false);
  }
}

// ---------------------------------------------------------------
// 2) AVVIO DI UN INVENTARIO
// ---------------------------------------------------------------
async function startShelf(shelf, btnEl) {
  if (!shelf || st.starting) return;
  st.starting = true;
  btnEl?.classList.add('opacity-60', 'pointer-events-none');
  try {
    const draft = readDraft(shelf.nome);
    if (draft) {
      const choice = await chooseDialog({
        title: `Inventario ${shelf.nome} in corso`,
        message: `Hai già contato ${contati(draft.rows)} articoli su ${draft.rows.length}. Vuoi riprendere da dove eri rimasto?`,
        options: [
          { label: 'Riprendi', value: 'resume', kind: 'primary' },
          { label: 'Ricomincia da capo', value: 'reset', hint: 'Il conteggio già fatto va perso.' },
          { label: 'Annulla inventario', value: 'discard', kind: 'danger', hint: 'Cancella i conteggi fatti e non ne inizia un altro.' },
          { label: 'Chiudi', value: null },
        ],
      });
      if (!choice) return;
      if (choice === 'resume') {
        st.session = draft;
        openCount();
        return;
      }
      if (choice === 'discard') {
        const done = await discardDrafts([{ key: draftKey(shelf.nome), shelf: shelf.nome }], {
          title: `Annullare l'inventario ${shelf.nome}?`,
          message: `I ${contati(draft.rows)} articoli già contati vanno persi. La giacenza non cambia.`,
          confirmLabel: 'Annulla inventario',
        });
        if (done) paintHome();
        return;
      }
      clearDraft(shelf.nome);
    }

    const mode = await chooseDialog({
      title: `Inventario ${shelf.nome}`,
      message: `Articoli registrati su questo scaffale: ${shelf.articoli}. Come vuoi contare?`,
      options: [
        { label: 'Con le quantità attese', value: 'visibili', kind: 'primary', hint: 'Più veloce: confermi con un tocco quelle giuste e correggi solo le differenze.' },
        { label: 'Alla cieca', value: 'ciechi', hint: 'Le quantità attese restano nascoste: conteggio più rigoroso, ma più lento.' },
        { label: 'Annulla', value: null },
      ],
    });
    if (!mode) return;

    toastInfo('Carico gli articoli dello scaffale…', 1800);
    let rows;
    try {
      rows = await listExpectedForShelf(shelf.nome);
    } catch (err) {
      console.error(err);
      feedback.errorAction();
      toastError(isNetworkError(err) ? 'Serve la connessione per avviare un nuovo inventario.' : 'Non è stato possibile leggere gli articoli dello scaffale.');
      return;
    }
    st.session = { shelf: shelf.nome, ciechi: mode === 'ciechi', startedAt: Date.now(), rows };
    flushDraft();
    openCount();
  } finally {
    st.starting = false;
    btnEl?.classList.remove('opacity-60', 'pointer-events-none');
  }
}

// ---------------------------------------------------------------
// 3) CONTEGGIO
// ---------------------------------------------------------------
function buildCount() {
  els.count = makeOverlay(
    93,
    'sm:max-w-lg h-[94vh] sm:h-[90vh]',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center gap-2 px-4 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <button type="button" data-act="back" aria-label="Indietro" class="modal-close modal-close--on-light">
        <i data-lucide="chevron-left" class="w-6 h-6" stroke-width="2.5"></i>
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-display font-semibold uppercase tracking-wider text-graphite-500">Inventario</p>
        <h3 data-role="shelf" class="font-display font-bold text-lg leading-tight truncate"></h3>
      </div>
      <button type="button" data-act="discard" aria-label="Annulla inventario" title="Annulla inventario" class="modal-close modal-close--on-light !text-rose-700">
        <i data-lucide="trash-2" class="w-5 h-5" stroke-width="2"></i>
      </button>
      <span data-role="progress" class="shrink-0 font-display font-bold text-sm rounded-full px-3 py-1 bg-graphite-800 border border-graphite-700"></span>
    </div>
    <div class="inv-bar bg-graphite-800 px-4 pt-3 pb-3 shrink-0 space-y-2">
      <div class="grid grid-cols-3 gap-2">
        <button type="button" data-act="scan" class="${BTN_BAR}"><i data-lucide="scan-barcode" class="w-4 h-4 shrink-0"></i>Scansiona</button>
        <button type="button" data-act="add" class="${BTN_BAR}"><i data-lucide="plus" class="w-4 h-4 shrink-0"></i>Aggiungi</button>
        <button type="button" data-act="todo" aria-pressed="false" class="${BTN_BAR}"><i data-lucide="list-checks" class="w-4 h-4 shrink-0"></i>Da contare</button>
      </div>
      <div data-role="cam" class="hidden">
        <div id="inv-reader" class="w-full h-52 rounded-lg overflow-hidden bg-black"></div>
        <p class="text-xs text-graphite-400 mt-1.5 text-center">Inquadra il codice a barre: si apre la riga dell'articolo.</p>
      </div>
    </div>
    <div data-role="rows" class="flex-1 overflow-y-auto px-4 pt-3.5 pb-3 space-y-2"></div>
    <div class="px-4 pt-3 pb-5 border-t border-graphite-800 shrink-0">
      <button type="button" data-act="finish" class="press-spring w-full rounded-lg py-3 bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide transition-colors">Concludi inventario</button>
    </div>`
  );
  els.rows = els.count.querySelector('[data-role="rows"]');
  els.cam = els.count.querySelector('[data-role="cam"]');
  els.progress = els.count.querySelector('[data-role="progress"]');
  els.todoBtn = els.count.querySelector('[data-act="todo"]');

  const panel = els.count.querySelector('.modal-panel');
  enableSheetDrag(panel, closeCount);
  els.count.addEventListener('overlay-cancel', cleanupCount); // tasto indietro del telefono
  els.count.querySelector('[data-act="back"]').addEventListener('click', closeCount);
  els.count.querySelector('[data-act="scan"]').addEventListener('click', toggleCamera);
  els.count.querySelector('[data-act="discard"]').addEventListener('click', discardCurrent);
  els.count.querySelector('[data-act="add"]').addEventListener('click', openAddSheet);
  els.count.querySelector('[data-act="finish"]').addEventListener('click', openSummary);
  els.todoBtn.addEventListener('click', () => {
    feedback.filterChange();
    st.onlyTodo = !st.onlyTodo;
    paintRows();
  });

  els.rows.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-row]');
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const i = Number(row.dataset.row);
    const r = st.session.rows[i];
    if (act === 'ok') {
      feedback.tap();
      ev.target.closest('[data-act]')?.blur(); // niente stato "premuto" residuo dopo il rilascio
      // Toggle: primo tocco conferma la quantità attesa, secondo tocco annulla (torna "da contare")
      setContato(i, r.contato === r.atteso ? null : r.atteso);
    } else if (act === 'barcode') {
      openBarcodeSheet(i);
    } else if (act === 'zero') {
      feedback.tap();
      setContato(i, 0);
    } else if (act === 'inc' || act === 'dec') {
      feedback.qtyTick(0);
      const base = r.contato ?? (st.session.ciechi || r.aggiunto ? 0 : r.atteso);
      setContato(i, Math.max(0, base + (act === 'inc' ? 1 : -1)));
    }
  });
  els.rows.addEventListener('input', (ev) => {
    const input = ev.target.closest('[data-input]');
    if (!input) return;
    const i = Number(input.closest('[data-row]').dataset.row);
    const txt = input.value.trim();
    if (txt === '') return setContato(i, null, true);
    const n = parseInt(txt, 10);
    if (Number.isFinite(n) && n >= 0) setContato(i, n, true);
  });
  els.rows.addEventListener('keydown', (ev) => ev.key === 'Enter' && ev.target.matches('[data-input]') && ev.target.blur());
}

function openCount() {
  st.onlyTodo = false;
  els.count.querySelector('[data-role="shelf"]').textContent = st.session.shelf;
  setCameraVisible(false);
  paintRows();
  openOverlay(els.count);
  // L'elenco parte sempre dall'alto: il primo articolo resta visibile (lo scorrimento di un inventario precedente non si porta dietro)
  els.rows.scrollTop = 0;
  requestAnimationFrame(() => {
    els.rows.scrollTop = 0;
  });
}

function cleanupCount() {
  setCameraVisible(false);
  flushDraft();
  if (st.tab === 'scaffali' && els.home.dataset.modalOpen) paintHome(); // la bozza compare nell'elenco
}

/** Annulla l'inventario aperto: cancella i conteggi fatti e torna all'elenco scaffali */
async function discardCurrent() {
  if (!st.session) return;
  feedback.tap();
  const shelf = st.session.shelf;
  const fatti = contati(st.session.rows);
  const done = await discardDrafts([{ key: draftKey(shelf), shelf }], {
    title: `Annullare l'inventario ${shelf}?`,
    message: fatti ? `I ${fatti} articoli già contati vanno persi. La giacenza non cambia.` : 'Non è stato registrato nulla: la giacenza non cambia.',
    confirmLabel: 'Annulla inventario',
  });
  if (!done || !st.session) return;
  st.session = null; // dopo la cancellazione nulla deve riscrivere la bozza
  setCameraVisible(false);
  closeOverlay(els.count);
  if (els.home.dataset.modalOpen && st.tab === 'scaffali') paintHome();
}

function closeCount() {
  cleanupCount();
  closeOverlay(els.count);
}

function stateOf(r) {
  if (r.contato === null) return 'todo';
  if (r.aggiunto) return r.contato > 0 ? 'diff' : 'todo';
  if (r.contato === r.atteso) return 'ok';
  return r.contato === 0 ? 'zero' : 'diff';
}

function rowHtml(r, i) {
  const visibile = !st.session.ciechi && !r.aggiunto;
  return `<div data-row="${i}" class="${ROW_BASE} ${ROW_STATE[stateOf(r)]}">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="font-display font-bold leading-tight break-words">${e(r.codice)}</p>
        ${r.descr ? `<p class="text-xs text-graphite-400 mt-0.5 break-words">${e(r.descr)}</p>` : ''}
        ${r.barcodes.length ? '' : `<button type="button" data-act="barcode" class="${BTN_CODE} mt-2"><i data-lucide="scan-barcode" class="w-4 h-4"></i>Aggiungi codice a barre</button>`}
      </div>
      <span class="shrink-0 text-[10px] uppercase tracking-wider font-display font-semibold rounded-full px-2 py-0.5 bg-graphite-700/60 text-graphite-300">${e(categoriaLabel(r.categoria))}${r.aggiunto ? ' · aggiunto' : ''}</span>
    </div>
    <div class="mt-2.5 flex items-center gap-2">
      ${
        visibile
          ? `<span class="mr-auto text-xs text-graphite-400">Atteso <strong class="text-graphite-200">${r.atteso}</strong> <span data-delta class="font-display font-bold"></span></span>`
          : '<span class="mr-auto"></span>'
      }
      ${visibile ? `<button type="button" data-act="ok" aria-label="Quantità giusta" aria-pressed="${r.contato === r.atteso}" class="${BTN_STEP_OK} text-emerald-700"><i data-lucide="check" class="w-5 h-5" stroke-width="3"></i></button>` : ''}
      <button type="button" data-act="dec" aria-label="Meno" class="${BTN_STEP}">−</button>
      <input data-input data-no-clear type="number" inputmode="numeric" min="0" step="1" value="${r.contato ?? ''}" placeholder="${visibile ? r.atteso : '–'}"
        class="w-16 h-11 rounded-lg bg-graphite-800 border border-graphite-700 text-center font-display font-bold text-base focus:border-amber-400 outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" data-act="inc" aria-label="Più" class="${BTN_STEP}">+</button>
      <button type="button" data-act="zero" aria-label="Non c'è" class="${BTN_STEP} text-rose-700">0</button>
    </div>
  </div>`;
}

function paintRows() {
  const rows = st.session.rows;
  els.todoBtn.setAttribute('aria-pressed', String(st.onlyTodo));
  els.todoBtn.classList.toggle('!border-amber-400', st.onlyTodo);
  els.todoBtn.classList.toggle('!bg-amber-400/15', st.onlyTodo);
  els.todoBtn.classList.toggle('!text-amber-300', st.onlyTodo);
  const html = rows.map((r, i) => (st.onlyTodo && r.contato !== null ? '' : rowHtml(r, i))).join('');
  els.rows.innerHTML = html || noticeHtml(rows.length ? 'Hai contato tutti gli articoli.' : 'Nessun articolo registrato su questo scaffale: aggiungi quelli che trovi con Scansiona o Aggiungi.');
  rows.forEach((_, i) => paintDelta(i));
  window.lucide?.createIcons();
  paintProgress();
}

function rowEl(i) {
  return els.rows.querySelector(`[data-row="${i}"]`);
}

function paintDelta(i) {
  const r = st.session.rows[i];
  const delta = rowEl(i)?.querySelector('[data-delta]');
  if (!delta) return;
  if (r.contato === null || r.contato === r.atteso) {
    delta.textContent = '';
    return;
  }
  const d = r.contato - r.atteso;
  delta.textContent = d > 0 ? `+${d}` : `−${Math.abs(d)}`;
  delta.className = `font-display font-bold ${d > 0 ? 'text-amber-300' : 'text-rose-700'}`;
}

function paintProgress() {
  const rows = st.session.rows;
  els.progress.textContent = `${contati(rows)}/${rows.length}`;
}

/** Aggiorna una riga senza ridisegnare l'elenco (lo scorrimento e la tastiera restano com'erano) */
function setContato(i, value, fromInput = false) {
  const r = st.session.rows[i];
  r.contato = value;
  const el = rowEl(i);
  if (el) {
    el.className = `${ROW_BASE} ${ROW_STATE[stateOf(r)]}`;
    const input = el.querySelector('[data-input]');
    if (!fromInput && input) input.value = value ?? '';
    el.querySelector('[data-act="ok"]')?.setAttribute('aria-pressed', String(value === r.atteso));
    paintDelta(i);
  }
  paintProgress();
  saveDraft();
}

function focusRow(i) {
  let el = rowEl(i);
  if (!el) {
    st.onlyTodo = false;
    paintRows();
    el = rowEl(i);
  }
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('ring-2', 'ring-amber-400');
  setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1600);
  const input = el.querySelector('[data-input]');
  input?.focus({ preventScroll: true });
  input?.select();
}

// ---- Scansione
let lastScan = { code: '', at: 0 };
let scanBusy = false;

function setCameraVisible(on) {
  els.cam.classList.toggle('hidden', !on);
  if (!on) stopCamera().catch(() => {});
}

async function toggleCamera() {
  feedback.tap();
  if (!els.cam.classList.contains('hidden')) {
    setCameraVisible(false);
    return;
  }
  els.cam.classList.remove('hidden');
  const ok = await startCamera('inv-reader', onScan, {});
  if (ok === false) {
    setCameraVisible(false);
    toastError('Fotocamera non disponibile. Controlla i permessi del browser.');
  }
}

async function onScan(code) {
  const c = String(code || '').trim();
  if (!c || scanBusy || !st.session) return;
  const now = Date.now();
  if (c === lastScan.code && now - lastScan.at < 2500) return;
  lastScan = { code: c, at: now };

  const rows = st.session.rows;
  const idx = rows.findIndex((r) => r.barcodes.some((b) => b.toLowerCase() === c.toLowerCase()));
  if (idx >= 0) {
    feedback.scanFound();
    focusRow(idx);
    return;
  }
  scanBusy = true;
  try {
    let product = getCachedProductByBarcode(c);
    if (!product) {
      try {
        product = await getProductByBarcode(c);
      } catch (err) {
        console.error(err);
      }
    }
    if (!product) {
      feedback.scanNotFound();
      if (!rows.some((r) => !r.barcodes.length)) {
        toastWarning('Codice non riconosciuto.');
        return;
      }
      // Codice nuovo: si può assegnare a un articolo dello scaffale che non ha ancora un codice a barre
      const choice = await chooseDialog({
        title: 'Codice non riconosciuto',
        message: `Il codice ${c} non è associato a nessun articolo. Vuoi assegnarlo a un articolo senza codice a barre?`,
        options: [
          { label: 'Assegna a un articolo', value: 'assign', kind: 'primary' },
          { label: 'Ignora', value: null },
        ],
      });
      if (choice === 'assign') openAssignPicker(c);
      return;
    }
    feedback.scanFound();
    await addProductToSession(product);
  } finally {
    scanBusy = false;
  }
}

/** Articolo trovato ma non in elenco: si aggiunge allo scaffale solo dopo conferma */
async function addProductToSession(product) {
  const rows = st.session.rows;
  const existing = rows.findIndex((r) => r.id === product.id);
  if (existing >= 0) {
    focusRow(existing);
    return;
  }
  const altri = getProductLocations(product)
    .filter((l) => l.locazione && normShelf(l.locazione) !== normShelf(st.session.shelf))
    .map((l) => l.locazione);
  const ok = await confirmDialog({
    title: 'Articolo non in elenco',
    message: `${product.codice_articolo} non risulta su ${st.session.shelf}${altri.length ? ` (è registrato su ${altri.join(', ')})` : ''}. Vuoi aggiungerlo a questo scaffale?`,
    confirmLabel: 'Aggiungi',
    cancelLabel: 'No',
  });
  if (!ok) return;
  rows.unshift(rowFromProduct(product));
  st.onlyTodo = false;
  paintRows();
  saveDraft();
  feedback.confirmAction();
  focusRow(0);
}

// ---- Codici a barre nuovi per articoli che non ne hanno
/** Salva il codice come principale dell'articolo della riga i. Lancia un Error con messaggio leggibile se non è possibile. */
async function saveBarcode(i, code) {
  const r = st.session.rows[i];
  const c = String(code || '').trim();
  if (!c) throw new Error('Scrivi o scansiona il codice.');
  const usatoQui = st.session.rows.find((x, k) => k !== i && x.barcodes.some((b) => b.toLowerCase() === c.toLowerCase()));
  if (usatoQui) throw new Error(`Codice già associato a ${usatoQui.codice}.`);
  let altro = null;
  try {
    altro = await getProductByBarcode(c);
  } catch {
    /* senza rete il controllo lo fa il database al salvataggio */
  }
  if (altro && altro.id !== r.id) throw new Error(`Codice già associato a ${altro.codice_articolo}.`);
  try {
    await setProductBarcodes(r.id, { primary: c, primaryMaker: null, extras: [] });
  } catch (err) {
    console.error(err);
    if (isNetworkError(err)) throw new Error('Serve la connessione per salvare il codice a barre.');
    const msg = String(err?.message || '').toLowerCase();
    throw new Error(msg.includes('duplicate') || msg.includes('già') ? 'Codice già usato da un altro articolo.' : 'Codice non salvato: riprova.');
  }
  r.barcodes = [c];
  try {
    cacheProductsList([await getProductById(r.id)]); // la scansione futura lo riconosce subito, anche offline
  } catch {
    /* la cache si aggiorna alla prossima lettura */
  }
  const el = rowEl(i);
  if (el) {
    el.outerHTML = rowHtml(r, i); // solo questa riga: scorrimento e tastiera restano com'erano
    paintDelta(i);
    window.lucide?.createIcons();
  }
  saveDraft();
  feedback.confirmAction();
  toastSuccess(`Codice a barre assegnato a ${r.codice}.`, 3000);
}

/** Finestra per scrivere o scansionare il codice da assegnare a un articolo senza codice a barre */
function openBarcodeSheet(i) {
  const r = st.session.rows[i];
  feedback.tap();
  setCameraVisible(false); // una sola fotocamera alla volta
  const overlay = makeOverlay(
    97,
    'sm:max-w-md',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <h3 class="font-display font-bold text-lg uppercase tracking-wide">Codice a barre</h3>
      <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
    </div>
    <div class="px-5 pt-3 shrink-0 space-y-3">
      <p class="text-sm"><span class="font-display font-bold">${e(r.codice)}</span>${r.descr ? `<span class="text-graphite-400"> · ${e(r.descr)}</span>` : ''}</p>
      <div class="flex gap-2">
        <input data-role="code" data-no-clear type="text" autocomplete="off" autocapitalize="off" placeholder="Scrivi o scansiona il codice"
          class="min-w-0 flex-1 h-11 rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 text-sm focus:border-amber-400 outline-none transition-colors" />
        <button type="button" data-act="scan" aria-label="Scansiona" class="${BTN_STEP}"><i data-lucide="scan-barcode" class="w-5 h-5"></i></button>
      </div>
      <div data-role="cam" class="hidden">
        <div id="inv-bc-reader" class="w-full h-48 rounded-lg overflow-hidden bg-black"></div>
      </div>
      <p data-role="err" class="hidden text-xs text-rose-700"></p>
    </div>
    <div class="px-5 pt-3 pb-5 shrink-0">
      <button type="button" data-act="save" class="press-spring w-full rounded-lg py-3 bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide transition-colors">Salva codice</button>
    </div>`
  );
  const input = overlay.querySelector('[data-role="code"]');
  const cam = overlay.querySelector('[data-role="cam"]');
  const err = overlay.querySelector('[data-role="err"]');
  const saveBtn = overlay.querySelector('[data-act="save"]');
  const showErr = (msg) => {
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
  };
  const stopCam = () => {
    cam.classList.add('hidden');
    stopCamera().catch(() => {});
  };
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stopCam();
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  const close = () => {
    cleanup();
    closeOverlay(overlay);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.addEventListener('overlay-cancel', cleanup); // tasto indietro del telefono
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag(overlay.querySelector('.modal-panel'), close);
  input.addEventListener('input', () => showErr(''));

  overlay.querySelector('[data-act="scan"]').addEventListener('click', async () => {
    feedback.tap();
    if (!cam.classList.contains('hidden')) {
      stopCam();
      return;
    }
    cam.classList.remove('hidden');
    const ok = await startCamera(
      'inv-bc-reader',
      (code) => {
        input.value = String(code || '').trim();
        showErr('');
        feedback.scanFound();
        stopCam();
      },
      {}
    );
    if (ok === false) {
      stopCam();
      toastError('Fotocamera non disponibile. Controlla i permessi del browser.');
    }
  });

  const save = async () => {
    showErr('');
    setButtonBusy(saveBtn, true, 'Salvataggio…');
    try {
      await saveBarcode(i, input.value);
      close();
    } catch (ex) {
      feedback.errorAction();
      showErr(ex.message);
    } finally {
      setButtonBusy(saveBtn, false);
    }
  };
  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (ev) => ev.key === 'Enter' && save());

  openOverlay(overlay);
  window.lucide?.createIcons();
}

/** Scelta dell'articolo (tra quelli dello scaffale senza codice a barre) a cui assegnare un codice appena scansionato */
function openAssignPicker(code) {
  const overlay = makeOverlay(
    96,
    'sm:max-w-md max-h-[85vh]',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <h3 class="font-display font-bold text-lg uppercase tracking-wide">Assegna il codice</h3>
      <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
    </div>
    <p class="px-5 pt-3 text-xs text-graphite-400 shrink-0">Codice <strong class="text-graphite-200">${e(code)}</strong> · scegli l'articolo senza codice a barre.</p>
    <div data-role="list" class="flex-1 overflow-y-auto px-5 py-3 space-y-2"></div>`
  );
  const list = overlay.querySelector('[data-role="list"]');
  const close = () => {
    closeOverlay(overlay);
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag(overlay.querySelector('.modal-panel'), close);

  const candidates = st.session.rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.barcodes.length);
  list.innerHTML = candidates
    .map(
      ({ r, i }) => `<button type="button" data-i="${i}" class="press-spring w-full text-left rounded-lg border border-graphite-700 bg-graphite-800/40 hover:bg-graphite-800 px-3.5 py-2.5 transition-colors">
        <span class="block font-display font-bold leading-tight">${e(r.codice)}</span>
        <span class="block text-xs text-graphite-400 mt-0.5">${e(categoriaLabel(r.categoria))}${r.descr ? ` · ${e(r.descr)}` : ''}</span>
      </button>`
    )
    .join('');
  list.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-i]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      await saveBarcode(Number(b.dataset.i), code);
      close();
    } catch (ex) {
      feedback.errorAction();
      toastError(ex.message, 4500);
      b.disabled = false;
    }
  });
  openOverlay(overlay);
  window.lucide?.createIcons();
}

// ---- Aggiungi a mano (ricerca)
function openAddSheet() {
  feedback.tap();
  const overlay = makeOverlay(
    96,
    'sm:max-w-md max-h-[85vh]',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <h3 class="font-display font-bold text-lg uppercase tracking-wide">Aggiungi articolo</h3>
      <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
    </div>
    <div class="px-5 pt-3 shrink-0">
      <input data-role="q" type="text" autocomplete="off" placeholder="Codice, descrizione o codice a barre"
        class="w-full rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 py-2.5 text-sm focus:border-amber-400 outline-none transition-colors" />
    </div>
    <div data-role="res" class="flex-1 overflow-y-auto px-5 py-3 space-y-2"></div>`
  );
  const q = overlay.querySelector('[data-role="q"]');
  const res = overlay.querySelector('[data-role="res"]');
  res.innerHTML = noticeHtml('Scrivi almeno 2 caratteri.');
  let found = [];
  let timer = null;
  let seq = 0;

  const close = () => {
    closeOverlay(overlay);
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag(overlay.querySelector('.modal-panel'), close);

  const paint = () => {
    if (!found.length) {
      res.innerHTML = noticeHtml('Nessun articolo trovato.');
      return;
    }
    res.innerHTML = found
      .slice(0, 20)
      .map((p, i) => {
        const gia = st.session.rows.some((r) => r.id === p.id);
        const locs = getProductLocations(p).map((l) => l.locazione).filter(Boolean).join(', ');
        return `<button type="button" data-i="${i}" class="press-spring w-full text-left rounded-lg border border-graphite-700 bg-graphite-800/40 hover:bg-graphite-800 px-3.5 py-2.5 transition-colors">
          <span class="block font-display font-bold leading-tight">${e(p.codice_articolo)}${gia ? ' <span class="text-xs font-normal text-graphite-400">· già in elenco</span>' : ''}</span>
          <span class="block text-xs text-graphite-400 mt-0.5">${e(categoriaLabel(p.categoria))}${locs ? ` · ${e(locs)}` : ''}</span>
        </button>`;
      })
      .join('');
  };
  res.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-i]');
    if (!b) return;
    const p = found[Number(b.dataset.i)];
    close();
    setTimeout(() => addProductToSession(p), modalCloseMs() * 0.6);
  });

  q.addEventListener('input', () => {
    clearTimeout(timer);
    const term = q.value.trim();
    if (term.length < 2) {
      found = [];
      res.innerHTML = noticeHtml('Scrivi almeno 2 caratteri.');
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      found = searchCachedProducts(term); // subito dalla memoria del telefono…
      paint();
      try {
        const online = await listProducts({ search: term }); // …poi dall'anagrafica completa
        if (mine === seq) {
          found = online;
          paint();
        }
      } catch {
        /* senza rete restano i risultati della memoria */
      }
    }, 250);
  });

  openOverlay(overlay);
  window.lucide?.createIcons();
  setTimeout(() => q.focus(), modalCloseMs() * 0.8);
}

// ---------------------------------------------------------------
// 4) RIEPILOGO E CHIUSURA
// ---------------------------------------------------------------
function buildSummary() {
  els.summary = makeOverlay(
    94,
    'sm:max-w-lg h-[94vh] sm:h-[90vh]',
    `
    <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
    <div data-sheet-drag class="flex items-center gap-2 px-4 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
      <button type="button" data-act="back" aria-label="Indietro" class="modal-close modal-close--on-light">
        <i data-lucide="chevron-left" class="w-6 h-6" stroke-width="2.5"></i>
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-display font-semibold uppercase tracking-wider text-graphite-500">Riepilogo inventario</p>
        <h3 data-role="shelf" class="font-display font-bold text-lg leading-tight truncate"></h3>
      </div>
    </div>
    <div data-role="body" class="flex-1 overflow-y-auto px-4 py-3"></div>
    <div class="px-4 pt-3 pb-5 border-t border-graphite-800 shrink-0">
      <button type="button" data-act="apply" class="press-spring w-full rounded-lg py-3 bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide transition-colors"></button>
    </div>`
  );
  els.summaryBody = els.summary.querySelector('[data-role="body"]');
  els.applyBtn = els.summary.querySelector('[data-act="apply"]');
  enableSheetDrag(els.summary.querySelector('.modal-panel'), () => closeOverlay(els.summary));
  els.summary.querySelector('[data-act="back"]').addEventListener('click', () => closeOverlay(els.summary));
  els.applyBtn.addEventListener('click', applyInventory);
  els.summaryBody.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-motivo]');
    if (!chip) return;
    feedback.presetPick();
    st.motivo = chip.dataset.motivo;
    els.summaryBody.querySelectorAll('[data-motivo]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.motivo === st.motivo)));
  });
}

/** Esito di ogni riga: gli articoli non contati risultano a zero (dopo la conferma finale) */
function computeOutcome() {
  const out = { confermati: [], corretti: [], aggiunti: [], nonTrovati: [], nonContati: 0, scartati: 0 };
  for (const r of st.session.rows) {
    if (r.aggiunto) {
      if (!r.contato) out.scartati += 1;
      else out.aggiunti.push({ r, contato: r.contato });
      continue;
    }
    const nonContato = r.contato === null;
    const contato = nonContato ? 0 : r.contato;
    if (nonContato && r.atteso > 0) out.nonContati += 1;
    if (contato === r.atteso) out.confermati.push({ r, contato });
    else if (contato === 0) out.nonTrovati.push({ r, contato, nonContato });
    else out.corretti.push({ r, contato });
  }
  out.differenze = out.corretti.length + out.aggiunti.length + out.nonTrovati.length;
  return out;
}

function openSummary() {
  feedback.tap();
  setCameraVisible(false);
  flushDraft();
  st.motivo = null;
  const o = computeOutcome();
  els.summary.querySelector('[data-role="shelf"]').textContent = st.session.shelf;

  const tile = (n, label, cls) =>
    `<div class="rounded-xl border p-3 text-center ${cls}"><p class="font-display font-bold text-2xl leading-none">${n}</p><p class="text-[11px] uppercase tracking-wider font-display font-semibold mt-1">${label}</p></div>`;
  const section = (title, items, cls) =>
    items.length
      ? `<p class="text-[11px] font-display font-semibold uppercase tracking-wider text-graphite-500 mt-4 mb-1.5">${title}</p>
         <div class="space-y-1.5">${items
           .map(({ r, contato, nonContato }) => {
             const d = contato - r.atteso;
             return `<div class="flex items-start justify-between gap-3 rounded-lg border border-graphite-700 bg-graphite-800/40 px-3 py-2">
               <span class="min-w-0"><span class="block font-display font-bold text-sm leading-tight">${e(r.codice)}</span>${r.descr ? `<span class="block text-xs text-graphite-400 break-words">${e(r.descr)}</span>` : ''}${nonContato ? '<span class="block text-[11px] text-rose-700">non contato</span>' : ''}</span>
               <span class="shrink-0 text-sm text-right"><span class="text-graphite-400">${r.atteso} →</span> <strong>${contato}</strong><span class="block text-xs font-display font-bold ${cls}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span></span>
             </div>`;
           })
           .join('')}</div>`
      : '';

  let html = `<div class="grid grid-cols-2 gap-2">
      ${tile(o.confermati.length, 'Confermati', 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700')}
      ${tile(o.corretti.length, 'Corretti', 'border-amber-400/60 bg-amber-400/10 text-amber-300')}
      ${tile(o.aggiunti.length, 'Aggiunti', 'border-graphite-700 bg-graphite-800/40 text-graphite-200')}
      ${tile(o.nonTrovati.length, 'Non trovati', 'border-rose-500/50 bg-rose-500/10 text-rose-700')}
    </div>`;
  if (o.nonContati > 0) {
    html += `<p class="mt-3 text-xs rounded-lg px-3 py-2 bg-amber-400/10 text-amber-300 border border-amber-400/30">${plural(o.nonContati, 'articolo non è stato contato', 'articoli non sono stati contati')}: ${o.nonContati === 1 ? 'verrà registrato' : 'verranno registrati'} a quantità zero. Se non è giusto, torna indietro e conta anche ${o.nonContati === 1 ? 'questo articolo' : 'questi articoli'}.</p>`;
  }
  if (o.scartati > 0) {
    html += `<p class="mt-2 text-xs text-graphite-400">${plural(o.scartati, 'articolo aggiunto senza quantità è stato ignorato', 'articoli aggiunti senza quantità sono stati ignorati')}.</p>`;
  }
  html += section('Corretti', o.corretti, 'text-amber-300');
  html += section('Aggiunti allo scaffale', o.aggiunti, 'text-amber-300');
  html += section('Non trovati (a zero)', o.nonTrovati, 'text-rose-700');

  if (o.differenze > 0) {
    html += `<div data-role="motivo-box" class="mt-5 rounded-xl transition-colors">
      <p class="text-[11px] font-display font-semibold uppercase tracking-wider text-graphite-500 mb-1.5">Motivo delle differenze</p>
      <div class="flex flex-wrap gap-2">${MOTIVI.map((m) => `<button type="button" data-motivo="${e(m)}" aria-pressed="false" class="int-chip">${e(m)}</button>`).join('')}</div>
    </div>`;
  } else {
    html += '<p class="mt-5 text-sm text-emerald-700 text-center">Nessuna differenza: tutte le quantità erano giuste.</p>';
  }
  els.summaryBody.innerHTML = html;
  els.applyBtn.textContent = o.differenze > 0 ? 'Applica le correzioni e chiudi' : 'Chiudi inventario';
  window.lucide?.createIcons();
  openOverlay(els.summary);
}

async function applyInventory() {
  const o = computeOutcome();
  if (o.differenze > 0 && !st.motivo) {
    feedback.errorAction();
    const box = els.summaryBody.querySelector('[data-role="motivo-box"]');
    box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box?.classList.add('field-missing');
    setTimeout(() => box?.classList.remove('field-missing'), 1800);
    toastWarning('Scegli il motivo delle differenze.');
    return;
  }
  const righe = [...o.confermati, ...o.corretti, ...o.aggiunti, ...o.nonTrovati].map(({ r, contato }) => ({ product_id: r.id, contato }));
  if (!righe.length) {
    toastWarning('Non c\'è nessun articolo da registrare.');
    return;
  }
  if (o.nonContati > 0) {
    const ok = await confirmDialog({
      title: 'Articoli non contati',
      message: `${plural(o.nonContati, 'articolo non contato verrà registrato', 'articoli non contati verranno registrati')} a quantità zero su ${st.session.shelf}. Continuare?`,
      confirmLabel: 'Azzera e chiudi',
      cancelLabel: 'Torna indietro',
      danger: true,
    });
    if (!ok) return;
  }

  const shelf = st.session.shelf;
  setButtonBusy(els.applyBtn, true, 'Registrazione…');
  try {
    await closeInventory({
      locazione: shelf,
      ciechi: st.session.ciechi,
      motivo: o.differenze > 0 ? st.motivo : null,
      iniziatoAt: st.session.startedAt,
      righe,
    });
    clearDraft(shelf);
    st.session = null;
    st.inventories = null;
    feedback.confirmAction();
    toastSuccess(`Inventario ${shelf} registrato${o.differenze > 0 ? `: ${plural(o.differenze, 'differenza corretta', 'differenze corrette')}` : ''}.`, 4500);
    closeOverlay(els.summary);
    setCameraVisible(false);
    closeOverlay(els.count);
    if (els.home.dataset.modalOpen) loadShelves();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(
      isNetworkError(err)
        ? 'Nessuna connessione: il conteggio è salvato sul telefono, riprova quando la rete è attiva.'
        : `Inventario non registrato: ${err?.message || 'errore sconosciuto'}`,
      6000
    );
  } finally {
    setButtonBusy(els.applyBtn, false);
  }
}

// ---------------------------------------------------------------
// Avvio: finestre e voce nelle Impostazioni
// ---------------------------------------------------------------
let initialized = false;

export function initInventory() {
  if (initialized) return;
  initialized = true;
  buildHome();
  buildCount();
  buildSummary();

  // La voce "Inventario" si affianca a "Gestione scaffali" (stessa grafica, solo Admin)
  const ref = document.getElementById('shelves-manage-btn');
  if (!ref) return;
  const btn = ref.cloneNode(true);
  btn.id = 'inventory-manage-btn';
  // L'icona dell'originale è già stata disegnata: si sostituisce con una nuova
  const icon = btn.querySelector('svg, i');
  if (icon) {
    const fresh = document.createElement('i');
    fresh.setAttribute('data-lucide', 'clipboard-check');
    fresh.setAttribute('stroke-width', '2');
    fresh.className = 'w-[18px] h-[18px]';
    icon.replaceWith(fresh);
  }
  // Il testo della voce sta in .set-title (nuove Impostazioni raggruppate)
  const title = btn.querySelector('.set-title');
  if (title) title.textContent = 'Inventario';
  btn.classList.toggle('hidden', !isAdmin());
  btn.addEventListener('click', openHome);
  ref.insertAdjacentElement('afterend', btn);
  window.lucide?.createIcons();
}
