// =============================================================
// global-search.js — Ricerca articoli e scansione rapida nella testata.
// - Campo "Cerca articolo…": al tocco si apre un pannello sotto la testata (con velo);
//   i risultati compaiono mentre si scrive. Un tocco su un articolo apre la sua scheda;
//   in Movimenti ogni risultato ha anche Deposito / Prelievo, che aprono il cassetto
//   del movimento già con l'articolo scelto.
// - Pulsante fotocamera: cassetto con scansione immediata del codice; dopo la lettura
//   offre scheda e, in Movimenti, Deposito/Prelievo.
// Tasto indietro del telefono, Esc e tocco sul velo chiudono il pannello.
// =============================================================

import { listProducts, getProductByBarcode, getCachedProductByBarcode, searchCachedProducts } from '../data/supabase.js';
import { isNetworkError } from '../core/offline-queue.js';
import { startCamera, stopCamera } from './camera.js';
import { openOverlay, closeOverlay, enableSheetDrag, replayAnimation, modalCloseMs } from './ui-utils.js';
import { pushLayer, releaseLayer } from '../core/nav-history.js';
import { openDetail } from '../features/magazzino/products-detail.js';
import { searchInterventi, openInterventoDetail } from '../features/interventi/interventi.js';
import { lineaLabel, STATI } from '../features/interventi/interventi-data.js';
import { startMovement } from '../features/movimenti/scanner.js';
import { catIconHtml, observeMarquee } from '../features/movimenti/movements.js';
import { CATEGORY_LABELS, shelfLabel, escapeHtml } from '../features/magazzino/products-shared.js';
import { toastError } from './toast.js';
import feedback from './feedback.js';

const BADGE = {
  cuscinetti: 'bg-graphite-700 text-graphite-200',
  cinghie: 'bg-emerald-500/15 text-emerald-700',
  pezzi_ricambio: 'bg-amber-500/15 text-amber-300',
};
const SEARCH_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

const el = {};
let panelOpen = false;
let layer = null; // voce della cronologia (tasto indietro)
let seq = 0;
let debounce = null;
let results = [];
let resultsKind = 'articoli'; // 'articoli' | 'interventi'
let initialized = false;

const inInterventi = () => {
  const v = document.getElementById('view-interventi');
  return !!v && !v.classList.contains('hidden');
};

const STATO_BADGE = {
  da_effettuare: 'bg-[#eaedf4] text-amber-300',
  sospeso: 'bg-orange-100 text-orange-800',
  effettuato: 'bg-emerald-100 text-emerald-800',
};

/**
 * Nella sezione Interventi la barra in testata cerca negli interventi (non negli articoli) e la
 * fotocamera, che legge i codici degli articoli, non serve: si nasconde. Chiamata a ogni cambio di sezione.
 */
export function syncSearchContext(view) {
  const input = document.getElementById('hsearch-input');
  if (!input) return;
  const next = view
    ? (view === 'interventi' ? 'interventi' : view === 'products' ? 'products' : 'altro')
    : inInterventi() ? 'interventi' : inProducts() ? 'products' : 'altro';
  if (next !== ctx) {
    // Cambio di sezione: nel Magazzino la barra riprende il filtro dell'elenco, altrove riparte vuota
    input.value = next === 'products' ? (document.getElementById('product-search-input')?.value || '') : '';
    document.getElementById('hsearch-clear')?.classList.toggle('on', input.value !== '');
    ctx = next;
  }
  const on = next === 'interventi';
  // Una sola dicitura per gli articoli, in qualsiasi sezione e categoria
  const label = on ? 'Cerca interventi' : 'Cerca articoli';
  input.placeholder = `${label}…`;
  input.setAttribute('aria-label', label);
  const scan = document.getElementById('hsearch-scan-btn');
  if (scan) scan.style.display = on ? 'none' : '';
}

const inProducts = () => {
  const v = document.getElementById('view-products');
  return !!v && !v.classList.contains('hidden');
};

// Sezione a cui la barra è agganciata ('interventi' | 'products' | 'altro') e categoria aperta nel Magazzino
let ctx = '';

/** Nel Magazzino la barra in testata non apre il pannello: filtra direttamente l'elenco sotto. */
function filterProducts() {
  el.clear.classList.toggle('on', el.input.value !== '');
  const pi = document.getElementById('product-search-input');
  if (!pi) return;
  pi.value = el.input.value;
  pi.dispatchEvent(new Event('input', { bubbles: true }));
}

const inMovements = () => {
  const v = document.getElementById('view-scanner');
  return !!v && !v.classList.contains('hidden');
};

export function initGlobalSearch() {
  if (initialized) return;
  initialized = true;
  el.header = document.querySelector('header.app-header');
  el.layer = document.getElementById('hsearch-layer');
  el.backdrop = document.getElementById('hsearch-backdrop');
  el.panel = document.getElementById('hsearch-panel');
  el.input = document.getElementById('hsearch-input');
  el.clear = document.getElementById('hsearch-clear');
  el.scanBtn = document.getElementById('hsearch-scan-btn');
  el.qsModal = document.getElementById('qs-modal');
  el.qsPanel = document.getElementById('qs-panel');
  el.qsCamera = document.getElementById('qs-camera-collapse');
  el.qsReader = document.getElementById('qs-reader');
  el.qsResult = document.getElementById('qs-result');
  if (!el.input || !el.panel) return;
  syncSearchContext();

  el.input.addEventListener('focus', () => {
    if (ctx !== 'products') openPanel();
  });
  el.input.addEventListener('input', onInput);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' && ctx === 'products') {
      e.preventDefault();
      el.input.blur(); // "Fine" sulla tastiera: l'elenco è già filtrato
      return;
    }
    if (e.key === 'Enter' && results[0]) {
      e.preventDefault();
      if (resultsKind === 'interventi') {
        const first = results[0];
        closePanel({ clear: true });
        setTimeout(() => openInterventoDetail(first), 140);
      } else pick(results[0], 'scheda');
    }
  });
  el.clear.addEventListener('click', () => {
    feedback.clearInput();
    el.input.value = '';
    onInput();
    el.input.focus({ preventScroll: true });
  });
  el.backdrop.addEventListener('click', () => closePanel());
  el.panel.addEventListener('click', onPanelClick);
  el.scanBtn?.addEventListener('click', () => {
    closePanel({ clear: ctx !== 'products' });
    openQuickScan();
  });
  window.visualViewport?.addEventListener('resize', fitPanel);

  enableSheetDrag(el.qsPanel, closeQuickScan);
  document.getElementById('qs-close-btn')?.addEventListener('click', closeQuickScan);
  el.qsModal.addEventListener('overlay-back', (e) => {
    e.preventDefault();
    closeQuickScan();
  });
  el.qsModal.addEventListener('overlay-cancel', () => stopCamera());
  el.qsResult.addEventListener('click', onQsResultClick);
}

/** Chiude e azzera la ricerca (logout). */
export function resetGlobalSearch() {
  ctx = ''; // logout: la barra si svuota anche se era agganciata al Magazzino
  const pi = document.getElementById('product-search-input');
  if (pi) pi.value = '';
  closePanel({ clear: true, silent: true });
  clearTimeout(debounce);
  seq += 1;
  if (el.qsModal?.dataset.modalOpen) closeQuickScan();
}

function openPanel() {
  if (panelOpen) return;
  panelOpen = true;
  el.layer.classList.add('hs-open');
  el.layer.setAttribute('aria-hidden', 'false');
  el.header.classList.add('hs-active');
  layer = pushLayer(() => {
    layer = null;
    closePanel({ fromBack: true });
  });
  fitPanel();
  if (el.input.value.trim()) runSearch(el.input.value.trim());
  else renderHint();
}

export function closePanel({ clear = false, fromBack = false, silent = false } = {}) {
  if (!el.input) return;
  if (panelOpen) {
    panelOpen = false;
    el.layer.classList.remove('hs-open');
    el.layer.setAttribute('aria-hidden', 'true');
    el.header.classList.remove('hs-active');
    if (layer && !fromBack) releaseLayer(layer);
    layer = null;
    if (!silent) feedback.overlayClose();
  }
  el.input.blur();
  if (clear && ctx !== 'products') {
    el.input.value = '';
    el.clear?.classList.remove('on');
    results = [];
  }
}

/** Il pannello non deve finire sotto la tastiera: altezza = spazio visibile sotto la testata. */
function fitPanel() {
  if (!panelOpen) return;
  if (el.input.closest('#search-dock')) {
    // Barra in basso: il pannello occupa lo spazio tra la testata e la barra (che può essere salita sopra la tastiera)
    // Il pannello è teso dalla testata alla barra (top/bottom in style.css): nessuna altezza massima da calcolare
    el.panel.style.maxHeight = '';
    return;
  }
  const top = el.header.getBoundingClientRect().bottom + 8;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  el.panel.style.maxHeight = `${Math.max(180, vh - top - 12)}px`;
}

function onInput() {
  if (ctx === 'products') {
    filterProducts();
    return;
  }
  const term = el.input.value.trim();
  el.clear.classList.toggle('on', el.input.value !== '');
  clearTimeout(debounce);
  if (!term) {
    seq += 1;
    results = [];
    renderHint();
    return;
  }
  debounce = setTimeout(() => runSearch(term), 220);
}

function renderHint() {
  el.panel.innerHTML = inInterventi()
    ? `<div class="hs-hint">${SEARCH_SVG}<p>Cerca negli interventi per descrizione,<br>macchina, linea, esito o nome.</p></div>`
    : `<div class="hs-hint">${SEARCH_SVG}<p>Digita il codice dell'articolo<br>oppure scansionalo con la fotocamera.</p></div>`;
}

async function runSearch(term) {
  const mySeq = ++seq;
  if (!el.panel.querySelector('.hs-row')) {
    el.panel.innerHTML =
      '<div class="hs-skel space-y-3"><div class="skeleton h-10 w-full"></div><div class="skeleton h-10 w-4/5"></div><div class="skeleton h-10 w-3/5"></div></div>';
  }
  if (inInterventi()) {
    let found = [];
    try {
      found = await searchInterventi(term);
    } catch (err) {
      console.error(err);
    }
    if (mySeq !== seq || !panelOpen) return;
    resultsKind = 'interventi';
    results = found.slice(0, 40);
    renderInterventiResults();
    return;
  }
  resultsKind = 'articoli';
  let list = [];
  let offline = false;
  try {
    list = await listProducts({ search: term });
  } catch (err) {
    if (!isNetworkError(err)) console.error(err);
    list = searchCachedProducts(term);
    offline = true;
  }
  if (mySeq !== seq || !panelOpen) return; // risposta superata da una digitazione più recente
  results = list.slice(0, 30);
  renderResults(offline);
}

function renderResults(offline) {
  if (!results.length) {
    el.panel.innerHTML = `<div class="hs-hint">${SEARCH_SVG}<p>Nessun articolo trovato.</p></div>`;
    return;
  }
  const withActions = inMovements();
  const rows = results
    .map((p, i) => {
      const sub = [shelfLabel(p), p.macchina].filter(Boolean).join(' · ');
      const code = escapeHtml(p.codice_articolo);
      // A sinistra l'icona della categoria (la stessa degli ultimi movimenti); il codice, se è troppo lungo, scorre da solo
      // avanti e indietro come là. In Movimenti a destra due pulsanti: scatolo con + (deposito) e scatolo con − (prelievo).
      return `
        <div class="hs-row" style="--i:${Math.min(i, 7)}">
          <button type="button" class="hs-main" data-i="${i}" data-act="scheda">
            ${catIconHtml(p.categoria)}
            <span class="hs-text">
              <span class="hs-code mv-title" title="${code}"><span class="mv-title-in">${code}</span></span>
              ${sub ? `<span class="hs-sub">${escapeHtml(sub)}</span>` : ''}
            </span>
          </button>
          ${
            withActions
              ? `<div class="hs-actions">
                  <button type="button" class="hs-ico hs-ico--dep" data-i="${i}" data-act="deposito" aria-label="Deposito ${code}" title="Deposito"><i data-lucide="package-plus" stroke-width="1.7"></i></button>
                  <button type="button" class="hs-ico hs-ico--pre" data-i="${i}" data-act="prelievo" aria-label="Prelievo ${code}" title="Prelievo"><i data-lucide="package-minus" stroke-width="1.7"></i></button>
                </div>`
              : ''
          }
        </div>`;
    })
    .join('');
  el.panel.innerHTML = (offline ? '<p class="hs-note">Offline: risultati dall\'ultima sincronizzazione.</p>' : '') + rows;
  window.lucide?.createIcons();
  el.panel.querySelectorAll('.mv-title').forEach(observeMarquee);
}

function renderInterventiResults() {
  if (!results.length) {
    el.panel.innerHTML = `<div class="hs-hint">${SEARCH_SVG}<p>Nessun intervento trovato.</p></div>`;
    return;
  }
  el.panel.innerHTML = results
    .map((r, i) => {
      const sub = [lineaLabel(r.linea), r.macchina].filter(Boolean).join(' · ');
      return `
        <div class="hs-row" style="--i:${Math.min(i, 7)}">
          <button type="button" class="hs-main" data-i="${i}" data-act="intervento">
            <span class="hs-text">
              <span class="hs-code hs-code--text">${escapeHtml(r.descrizione)}</span>
              <span class="hs-sub">${escapeHtml(sub)}</span>
            </span>
            <span class="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full ui-label font-display font-semibold uppercase tracking-wide ${STATO_BADGE[r.stato] || ''}">${escapeHtml(STATI[r.stato] || r.stato)}</span>
          </button>
        </div>`;
    })
    .join('');
}

function onPanelClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const item = results[Number(btn.dataset.i)];
  if (!item) return;
  if (resultsKind === 'interventi') {
    closePanel({ clear: true });
    setTimeout(() => openInterventoDetail(item), 140);
    return;
  }
  pick(item, btn.dataset.act);
}

/** Azione scelta su un articolo: 'scheda' | 'deposito' | 'prelievo'. */
function pick(product, act) {
  closePanel({ clear: true });
  // Un attimo per far chiudere il pannello prima che si apra il cassetto: nessuna sovrapposizione.
  setTimeout(() => runAction(product, act), 140);
}

function runAction(product, act) {
  if (act === 'deposito' || act === 'prelievo') startMovement(product, act);
  else openDetail(product);
}

/* ------------------------------------------------------------ scansione rapida */

let lastCode = null;
let lastCodeAt = 0;
let qsProduct = null;

function openQuickScan() {
  qsProduct = null;
  el.qsResult.classList.add('hidden');
  el.qsResult.innerHTML = '';
  openOverlay(el.qsModal);
  startQsCamera();
}

function startQsCamera() {
  el.qsResult.classList.add('hidden');
  el.qsCamera.classList.add('expanded');
  startCamera('qs-reader', onQsCode, {
    focusHintEl: document.getElementById('qs-focus-hint'),
    switchBtnEl: document.getElementById('qs-switch-btn'),
    torchBtnEl: document.getElementById('qs-torch-btn'),
    errorHint: 'Usa il campo di ricerca in alto.',
  }).then((started) => {
    if (started === false) el.qsCamera.classList.remove('expanded');
  });
}

function closeQuickScan() {
  stopCamera();
  closeOverlay(el.qsModal);
}

async function onQsCode(code) {
  const now = Date.now();
  if (code === lastCode && now - lastCodeAt < 2500) return;
  lastCode = code;
  lastCodeAt = now;
  try {
    let product;
    try {
      product = await getProductByBarcode(code);
    } catch (netErr) {
      product = getCachedProductByBarcode(code);
      if (!product) throw netErr;
    }
    if (!product) {
      feedback.scanNotFound();
      replayAnimation(el.qsReader, 'reader-flash-fail');
      toastError(`Nessun articolo trovato per il codice "${code}".`);
      return;
    }
    feedback.scanFound();
    replayAnimation(el.qsReader, 'reader-flash-ok');
    showQsResult(product);
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    replayAnimation(el.qsReader, 'reader-flash-fail');
    toastError('Errore nella ricerca articolo.');
  }
}

function showQsResult(product) {
  qsProduct = product;
  stopCamera();
  el.qsCamera.classList.remove('expanded');
  const sub = [shelfLabel(product), product.macchina].filter(Boolean).join(' · ');
  const badge = BADGE[product.categoria] || 'bg-graphite-700 text-graphite-200';
  const label = CATEGORY_LABELS[product.categoria] || product.categoria;
  el.qsResult.innerHTML = `
    <div class="qs-found">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="hs-code text-lg">${escapeHtml(product.codice_articolo)}</p>
          ${sub ? `<p class="hs-sub mt-0.5">${escapeHtml(sub)}</p>` : ''}
        </div>
        <span class="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full ui-label font-display font-semibold uppercase tracking-wide ${badge}">${escapeHtml(label)}</span>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        ${
          inMovements()
            ? `<div class="flex gap-2">
                <button type="button" class="hs-btn hs-btn--lg hs-btn--dep font-display" data-qs="deposito">Deposito</button>
                <button type="button" class="hs-btn hs-btn--lg hs-btn--pre font-display" data-qs="prelievo">Prelievo</button>
              </div>`
            : ''
        }
        <button type="button" class="hs-btn hs-btn--lg hs-btn--info font-display" data-qs="scheda">Scheda articolo</button>
        <button type="button" class="qs-link" data-qs="again">Scansiona un altro codice</button>
      </div>
    </div>`;
  el.qsResult.classList.remove('hidden');
}

function onQsResultClick(e) {
  const btn = e.target.closest('[data-qs]');
  if (!btn || !qsProduct) return;
  const act = btn.dataset.qs;
  if (act === 'again') {
    lastCode = null;
    startQsCamera();
    return;
  }
  const product = qsProduct;
  closeOverlay(el.qsModal);
  setTimeout(() => runAction(product, act), Math.round(modalCloseMs() * 0.55));
}
