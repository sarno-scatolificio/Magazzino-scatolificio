// =============================================================
// interventi-ricambi.js — Ricambi prelevati dal magazzino per un intervento già effettuato
// =============================================================
// - askRicambi(): domanda "Hai prelevato ricambi dal magazzino?" (Sì / No / Indietro)
// - pickRicambi(): foglio con UN'unica casella di ricerca che filtra cuscinetti, cinghie e ricambi
//   tecnici insieme (ogni risultato ha la targhetta della tipologia), scelta di quantità e scaffale
// - applyRicambi(): registra i prelievi (stessa funzione del Prelievo) e scala le giacenze
// Usato dal nuovo intervento "già effettuato" (interventi-new.js) e dal dettaglio (interventi-detail.js).

import { $ } from './interventi-shared.js';
import { CATEGORY_LABELS, escapeHtml, shelfLabel } from './products-shared.js';
import { CATEGORY_BADGE_CLASSES } from './scanner-shared.js';
import { adjustCachedProductQuantity, bumpProductsVersion, getProductLocations, listProducts, processTransaction, searchCachedProducts } from './supabase.js';
import { enqueueTransaction, isNetworkError } from './offline-queue.js';
import { closeOverlay, enableSheetDrag, modalCloseMs, openOverlay } from './ui-utils.js';
import { listPuntiSuggeriti, normPunto } from './punti-utilizzo.js';
import feedback from './feedback.js';
import { toastError, toastWarning } from './toast.js';

const els = {};
let sheet = null; // { resolve, items: [{ product, qty, locationId }], emptyLabel, emptyNote }
let searchSeq = 0;
let searchTimer = null;

// ---------------------------------------------------------------
// DOMANDA: hai prelevato ricambi?
// ---------------------------------------------------------------
/** @returns {Promise<'si'|'no'|null>} null = indietro (tocco fuori, Esc, tasto indietro): nulla viene salvato */
export function askRicambi() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
    const card = document.createElement('div');
    card.className = 'modal-panel modal-panel-card w-full sm:max-w-sm bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl p-5';
    card.innerHTML = `
      <div data-sheet-drag class="sheet-grabber sm:hidden -mt-5 mb-1"><span class="sheet-grabber-pill"></span></div>
      <p data-sheet-drag class="font-display font-bold text-lg leading-snug">Ricambi dal magazzino</p>
      <p data-sheet-drag class="text-sm text-graphite-400 leading-relaxed mt-1.5">Per effettuare questo intervento hai prelevato dei ricambi dal magazzino?</p>
      <div class="flex gap-3 mt-5">
        <button type="button" data-answer="no" class="flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide text-graphite-300 border border-graphite-700 hover:bg-graphite-800 transition-colors">No</button>
        <button type="button" data-answer="si" class="flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide text-white bg-amber-400 hover:bg-amber-300 transition-colors">Sì</button>
      </div>
      <button type="button" data-answer="back" class="w-full mt-2 rounded-lg py-2.5 text-xs font-display font-semibold uppercase tracking-wide text-graphite-500 hover:text-graphite-300 transition-colors">Indietro</button>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    openOverlay(overlay);

    let settled = false;
    function settle(result, silent = false) {
      if (settled) return;
      settled = true;
      if (!silent) (result ? feedback.confirmAction : feedback.cancelAction)();
      document.removeEventListener('keydown', onKeyDown);
      closeOverlay(overlay);
      setTimeout(() => overlay.remove(), modalCloseMs() + 60);
      resolve(result);
    }
    const onKeyDown = (e) => e.key === 'Escape' && settle(null);
    card.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => settle(b.dataset.answer === 'back' ? null : b.dataset.answer)));
    overlay.addEventListener('click', (e) => e.target === overlay && settle(null));
    overlay.addEventListener('overlay-cancel', () => settle(null, true));
    enableSheetDrag(card, () => settle(null));
    document.addEventListener('keydown', onKeyDown);
  });
}

// ---------------------------------------------------------------
// FOGLIO RICAMBI
// ---------------------------------------------------------------
export function initRicambiSheet() {
  els.modal = $('int-parts-modal');
  els.context = $('int-parts-context');
  els.search = $('int-parts-search');
  els.results = $('int-parts-results');
  els.selected = $('int-parts-selected');
  els.count = $('int-parts-count');
  els.empty = $('int-parts-empty');
  els.note = $('int-parts-note');
  els.save = $('int-parts-save');
  els.footer = $('int-parts-footer');

  $('int-parts-close').addEventListener('click', () => finish(null));
  els.modal.addEventListener('click', (e) => e.target === els.modal && finish(null));
  els.modal.addEventListener('overlay-cancel', () => finish(null)); // tasto indietro del telefono
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => finish(null));

  // Un'unica casella: filtra tutte le categorie insieme
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const term = els.search.value.trim();
    if (!term) {
      searchSeq += 1;
      els.results.classList.add('hidden');
      return;
    }
    searchTimer = setTimeout(() => runSearch(term), 250);
  });
  els.save.addEventListener('click', confirmSheet);

  // Mentre si scrive (tastiera aperta) l'avviso e il pulsante di conferma spariscono: altrimenti salirebbero
  // insieme alla tastiera e toglierebbero spazio ai risultati. Tornano appena il campo perde il focus.
  els.search.addEventListener('focus', () => els.footer.classList.add('hidden'));
  els.search.addEventListener('blur', () => els.footer.classList.remove('hidden'));
  els.search.addEventListener('keydown', (e) => e.key === 'Enter' && els.search.blur()); // "Fine" sulla tastiera
  // Toccare un risultato non deve togliere il focus al campo prima del tocco (il layout cambierebbe e il tocco andrebbe a vuoto)
  els.results.addEventListener('mousedown', (e) => e.preventDefault());
}

/**
 * Apre il foglio e risolve con l'elenco scelto: [{ product, quantita, locationId }] (anche vuoto),
 * oppure null se si chiude senza confermare.
 */
export function pickRicambi({ context = '', emptyLabel = 'Continua senza ricambi', emptyNote = '', linea = null, macchina = null, titolo = '' } = {}) {
  return new Promise((resolve) => {
    if (sheet) finish(null);
    // linea, macchina e titolo dell'intervento servono ai cuscinetti per proporre il punto di utilizzo
    sheet = { resolve, items: [], emptyLabel, emptyNote, linea, macchina, titolo };
    els.search.value = '';
    els.footer.classList.remove('hidden');
    els.results.classList.add('hidden');
    els.results.innerHTML = '';
    els.context.textContent = context;
    paintSelected();
    openOverlay(els.modal);
  });
}

function finish(result) {
  if (!sheet) return;
  const { resolve } = sheet;
  sheet = null;
  searchSeq += 1;
  clearTimeout(searchTimer);
  closeOverlay(els.modal);
  resolve(result);
}

async function runSearch(term) {
  const mine = ++searchSeq;
  els.results.classList.remove('hidden');
  els.results.innerHTML = '<p class="text-center text-xs text-graphite-500 py-4">Ricerca…</p>';
  let results = [];
  let offline = false;
  try {
    results = await listProducts({ search: term }); // nessuna categoria: cuscinetti, cinghie e ricambi tecnici insieme
  } catch (err) {
    if (!isNetworkError(err)) console.error(err);
    results = searchCachedProducts(term);
    offline = true;
  }
  if (mine !== searchSeq || !sheet) return; // risposta obsoleta
  paintResults(results, offline);
}

/** Descrizione dell'articolo: descrizione, altrimenti il punto di utilizzo standard (mai uguale al codice) */
const descOf = (p) => {
  const d = (p.descrizione || '').trim() || (p.punto_utilizzo_standard || '').trim();
  return d && d !== p.codice_articolo ? d : '';
};

/** Righe di dettaglio: scaffale/i, macchina, linea (e punto di utilizzo se c'è anche la descrizione) */
const detailsOf = (p) => {
  const parts = [];
  const shelf = shelfLabel(p);
  parts.push(shelf ? `Scaffale ${shelf}` : 'Senza scaffale');
  if (p.macchina) parts.push(p.macchina);
  if (p.linea) parts.push(p.linea);
  if ((p.descrizione || '').trim() && (p.punto_utilizzo_standard || '').trim() && p.punto_utilizzo_standard.trim() !== p.descrizione.trim()) parts.push(p.punto_utilizzo_standard.trim());
  return parts.join(' · ');
};

const badgeOf = (p) => {
  const cls = CATEGORY_BADGE_CLASSES[p.categoria] || 'bg-graphite-700 text-graphite-200';
  const label = CATEGORY_LABELS[p.categoria] || p.categoria || '';
  return `<span class="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full ui-label font-display font-semibold uppercase tracking-wide ${cls}">${escapeHtml(label)}</span>`;
};

function paintResults(results, offline) {
  els.results.innerHTML = '';
  if (offline && results.length) {
    const n = document.createElement('p');
    n.className = 'px-3.5 pt-2.5 ui-note text-amber-300';
    n.textContent = 'Offline: risultati dall\'ultima sincronizzazione.';
    els.results.appendChild(n);
  }
  if (!results.length) {
    els.results.innerHTML = '<p class="text-center text-xs text-graphite-500 py-4">Nessun articolo trovato.</p>';
    return;
  }
  results.slice(0, 30).forEach((p) => {
    const added = sheet.items.some((it) => it.product.id === p.id);
    const stock = Number(p.quantita_disponibile) || 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.disabled = added || stock <= 0;
    row.className = 'custom-select-option w-full text-left px-3.5 py-2.5 text-sm flex items-start justify-between gap-2 border-t border-graphite-700 first:border-t-0 disabled:opacity-50';
    const desc = descOf(p);
    row.innerHTML = `
      <span class="min-w-0 flex-1">
        <span class="block font-mono font-semibold text-graphite-100 break-all">${escapeHtml(p.codice_articolo)}</span>
        ${desc ? `<span class="block text-xs text-graphite-300 leading-snug">${escapeHtml(desc)}</span>` : ''}
        <span class="block ui-note text-graphite-500 leading-snug">${escapeHtml(detailsOf(p))}</span>
      </span>
      <span class="shrink-0 flex flex-col items-end gap-1">
        ${badgeOf(p)}
        <span class="ui-note font-mono ${stock <= 0 ? 'text-rose-700' : 'text-graphite-500'}">${added ? 'Aggiunto' : stock <= 0 ? 'Esaurito' : `Giacenza ${stock}`}</span>
      </span>`;
    row.addEventListener('click', () => addItem(p));
    els.results.appendChild(row);
  });
}

// Parole che possono seguire l'azione nel titolo ("sostituzione DELLA cinghia", "revisione DEL motore")
const PAROLE_VUOTE = new Set(['di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una', 'su', 'sul', 'sulla', 'sui', 'sulle', 'al', 'alla', 'allo', 'ai', 'alle', 'a', 'in', 'nel', 'nella']);

/**
 * Punto di utilizzo ricavato dal titolo dell'intervento: via la prima parola (l'azione: "revisione",
 * "sostituzione", "sostituire"…) e le parole vuote che la seguono; il resto resta com'è, nome della macchina
 * compreso. "Revisione trasmissione banco OHC" → "trasmissione banco OHC". Se nel titolo c'è solo l'azione
 * non propone nulla. È solo una proposta: nel foglio si può sempre correggere.
 */
export function puntoDaTitolo(titolo) {
  const words = String(titolo || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return '';
  let i = 1; // la prima parola è l'azione
  while (i < words.length - 1 && PAROLE_VUOTE.has(normPunto(words[i].replace(/'/g, ' ')))) i += 1;
  words[i] = words[i].replace(/^(dell|dall|nell|sull|all|l|un)['’]/i, ''); // "dell'albero" → "albero"
  return words
    .slice(i)
    .join(' ')
    .replace(/^[\s.,;:\-–]+|[\s.,;:\-–]+$/g, '');
}

function addItem(product) {
  if (!sheet || sheet.items.some((it) => it.product.id === product.id)) return;
  const locs = getProductLocations(product);
  sheet.items.push({
    product,
    qty: 1,
    locationId: locs.length > 1 ? null : locs[0]?.id ?? null,
    punto: product.categoria === 'cuscinetti' ? puntoDaTitolo(sheet.titolo) : '', // solo cuscinetti: proposto dal titolo, modificabile
    puntoTouched: false,
    puntiSuggeriti: [],
  });
  feedback.presetPick();
  els.search.value = '';
  els.search.blur(); // chiude la tastiera e fa tornare il pulsante di conferma
  els.results.classList.add('hidden');
  searchSeq += 1;
  paintSelected();
}

// ---- ricambi scelti ----
/** Giacenza su cui confrontare la quantità: dello scaffale scelto se ce n'è più d'uno, altrimenti dell'articolo */
function stockFor(it) {
  const locs = getProductLocations(it.product);
  if (locs.length > 1) {
    const chosen = locs.find((l) => l.id === it.locationId);
    return chosen ? Number(chosen.quantita) || 0 : null; // null = scaffale da scegliere
  }
  return Number(it.product.quantita_disponibile) || 0;
}

function afterInfo(it) {
  const stock = stockFor(it);
  if (stock === null) return { text: 'Scegli lo scaffale', warn: false };
  const after = stock - it.qty;
  return after < 0 ? { text: `Non basta: disponibili ${stock}`, warn: true } : { text: `Giacenza dopo: ↓ ${after} (−${it.qty})`, warn: false };
}

function paintSelected() {
  const items = sheet?.items || [];
  els.selected.innerHTML = '';
  els.empty.classList.toggle('hidden', items.length > 0);
  els.count.textContent = items.length ? `(${items.length})` : '';
  items.forEach((it, idx) => els.selected.appendChild(buildCard(it, idx)));
  paintFooter();
  window.lucide?.createIcons();
}

function paintFooter() {
  const n = sheet?.items.length || 0;
  els.save.querySelector('[data-label]').textContent = n ? `Conferma ricambi (${n})` : sheet?.emptyLabel || 'Continua senza ricambi';
  els.note.textContent = sheet?.emptyNote || '';
  els.note.classList.toggle('hidden', n > 0 || !sheet?.emptyNote);
}

function buildCard(it, idx) {
  const p = it.product;
  const locs = getProductLocations(p);
  const multiple = locs.length > 1;
  const desc = descOf(p);
  const card = document.createElement('div');
  card.className = 'card-plate rounded-xl p-3.5';
  card.dataset.idx = String(idx);
  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-mono font-semibold text-sm text-graphite-100 break-all">${escapeHtml(p.codice_articolo)}</span>
          ${badgeOf(p)}
        </div>
        ${desc ? `<p class="text-xs text-graphite-300 leading-snug mt-1">${escapeHtml(desc)}</p>` : ''}
        <p class="ui-note text-graphite-500 leading-snug mt-0.5">${escapeHtml(detailsOf(p))}</p>
      </div>
      <button type="button" data-remove aria-label="Togli il ricambio" class="press-spring shrink-0 w-10 h-10 -mt-1.5 -mr-1.5 rounded-lg text-graphite-400 hover:text-rose-700 flex items-center justify-center transition-colors"><i data-lucide="trash-2" class="w-5 h-5" stroke-width="2"></i></button>
    </div>
    ${multiple ? '<p class="text-xs font-display font-semibold uppercase tracking-wide text-graphite-400 mt-3 mb-1.5">Da quale scaffale?</p><div data-shelves class="grid grid-cols-2 gap-2"></div>' : ''}
    ${p.categoria === 'cuscinetti' ? `
    <div data-punto-box class="mt-3">
      <label class="block text-xs font-display font-semibold uppercase tracking-wide text-graphite-400 mb-1.5">Punto di utilizzo</label>
      <input data-punto type="text" maxlength="120" autocomplete="off" placeholder="Dove viene montato" class="w-full rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 py-2.5 text-sm focus:border-amber-400 outline-none transition-colors" />
      <div data-punto-chips class="flex flex-wrap gap-2 mt-2"></div>
    </div>` : ''}
    <div class="mt-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <button type="button" data-step="-1" aria-label="Meno" class="press-spring w-11 h-11 rounded-lg border border-graphite-700 bg-graphite-800 text-graphite-100 text-xl font-semibold flex items-center justify-center">−</button>
        <span data-qty class="font-mono text-lg font-semibold text-graphite-100 min-w-[2rem] text-center"></span>
        <button type="button" data-step="1" aria-label="Più" class="press-spring w-11 h-11 rounded-lg border border-graphite-700 bg-graphite-800 text-graphite-100 text-xl font-semibold flex items-center justify-center">+</button>
      </div>
      <p data-after class="ui-note text-right"></p>
    </div>`;

  if (multiple) {
    const wrap = card.querySelector('[data-shelves]');
    locs.forEach((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.locationId = l.id;
      b.disabled = (Number(l.quantita) || 0) <= 0; // scaffale vuoto: niente da prelevare
      b.className = 'scan-linea-btn press-spring min-h-[44px] rounded-lg border px-3 py-1.5 font-display font-semibold tracking-wide text-sm bg-graphite-900 text-graphite-200 border-graphite-700 flex flex-col items-center justify-center leading-tight disabled:opacity-40';
      const name = document.createElement('span');
      name.className = 'uppercase max-w-full truncate';
      name.textContent = l.locazione || 'Senza scaffale'; // testo, mai HTML
      const qty = document.createElement('span');
      qty.className = 'font-mono text-xs font-normal opacity-80';
      qty.textContent = `${l.quantita} pz`;
      b.append(name, qty);
      b.addEventListener('click', () => {
        feedback.focusTap();
        it.locationId = l.id;
        refreshCard(card, it);
      });
      wrap.appendChild(b);
    });
  }
  if (p.categoria === 'cuscinetti') wirePunto(card, it);
  card.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      feedback.focusTap();
      it.qty = Math.max(1, it.qty + Number(b.dataset.step));
      refreshCard(card, it);
    })
  );
  card.querySelector('[data-remove]').addEventListener('click', () => {
    if (!sheet) return;
    feedback.tap();
    sheet.items = sheet.items.filter((x) => x !== it);
    paintSelected();
  });
  refreshCard(card, it);
  return card;
}

/** Campo "Punto di utilizzo" di un cuscinetto: proposta dal titolo + punti già usati per lo stesso cuscinetto su quella linea e macchina */
function wirePunto(card, it) {
  const input = card.querySelector('[data-punto]');
  const chips = card.querySelector('[data-punto-chips]');
  input.value = it.punto || '';

  const paintChips = () => {
    const typed = normPunto(input.value);
    chips.replaceChildren(
      ...it.puntiSuggeriti
        .filter((x) => normPunto(x.punto) !== typed)
        .slice(0, 4)
        .map((x) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'int-chip';
          b.textContent = x.punto; // testo, mai HTML
          b.addEventListener('click', () => {
            feedback.presetPick();
            it.punto = x.punto;
            it.puntoTouched = true;
            input.value = x.punto;
            paintChips();
          });
          return b;
        })
    );
  };

  input.addEventListener('input', () => {
    it.punto = input.value;
    it.puntoTouched = true;
    paintChips();
  });
  // Con la tastiera aperta l'avviso e il pulsante di conferma spariscono, come nella ricerca
  input.addEventListener('focus', () => els.footer.classList.add('hidden'));
  input.addEventListener('blur', () => els.footer.classList.remove('hidden'));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());

  // Punti già usati per questo cuscinetto su questa linea e macchina (se non c'è rete restano solo la proposta e la scrittura a mano)
  if (it.puntiCaricati) {
    paintChips();
    return;
  }
  it.puntiCaricati = true;
  listPuntiSuggeriti({ productId: it.product.id, linea: sheet?.linea, macchinario: sheet?.macchina })
    .then((list) => {
      it.puntiSuggeriti = list;
      // Se la proposta dal titolo è lo stesso punto già usato, si adotta la grafia già in uso (così il confronto della vita utile non si spezza)
      const same = it.punto && list.find((x) => normPunto(x.punto) === normPunto(it.punto));
      if (same && !it.puntoTouched) {
        it.punto = same.punto;
        if (input.isConnected) input.value = same.punto;
      }
      if (input.isConnected) paintChips();
    })
    .catch(() => {});
}

/** Aggiorna quantità, giacenza dopo e scaffale scelto senza ridisegnare la scheda (lo scorrimento non salta) */
function refreshCard(card, it) {
  card.querySelector('[data-qty]').textContent = it.qty;
  const info = afterInfo(it);
  const after = card.querySelector('[data-after]');
  after.textContent = info.text;
  after.classList.toggle('text-rose-700', info.warn);
  after.classList.toggle('text-graphite-500', !info.warn);
  card.querySelectorAll('[data-location-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.locationId === it.locationId)));
}

function confirmSheet() {
  if (!sheet) return;
  const cards = [...els.selected.children];
  for (const [i, it] of sheet.items.entries()) {
    if (it.product.categoria === 'cuscinetti' && !String(it.punto || '').trim()) {
      feedback.errorAction();
      cards[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      cards[i]?.querySelector('[data-punto-box]')?.classList.add('field-missing');
      setTimeout(() => cards[i]?.querySelector('[data-punto-box]')?.classList.remove('field-missing'), 1800);
      toastError(`Indica il punto di utilizzo di ${it.product.codice_articolo}.`);
      return;
    }
    const stock = stockFor(it);
    if (stock === null || it.qty > stock) {
      feedback.errorAction();
      cards[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      cards[i]?.classList.add('field-missing');
      setTimeout(() => cards[i]?.classList.remove('field-missing'), 1800);
      toastError(stock === null ? `Scegli lo scaffale di ${it.product.codice_articolo}.` : `Giacenza insufficiente per ${it.product.codice_articolo}: disponibili ${stock}.`);
      return;
    }
  }
  finish(
    sheet.items.map((it) => ({
      product: it.product,
      quantita: it.qty,
      locationId: it.locationId,
      punto: it.product.categoria === 'cuscinetti' ? String(it.punto || '').trim().replace(/\s+/g, ' ') : null,
    }))
  );
}

// ---------------------------------------------------------------
// REGISTRAZIONE DEI PRELIEVI
// ---------------------------------------------------------------
const toStored = (sel) => {
  const p = sel.product;
  const locs = getProductLocations(p);
  const loc = locs.length > 1 ? locs.find((l) => l.id === sel.locationId) : locs[0];
  return {
    product_id: p.id,
    codice: p.codice_articolo,
    categoria: p.categoria,
    descrizione: descOf(p) || null,
    quantita: sel.quantita,
    locazione: loc?.locazione || null,
    ...(sel.punto ? { punto: sel.punto } : {}), // solo cuscinetti: dove è stato montato
  };
};

/**
 * Registra un prelievo per ogni ricambio scelto (stessa funzione del Prelievo da scanner: scala la giacenza
 * e scrive il movimento, con linea e nota "Intervento: …"). Non lancia mai errori: ritorna
 * { done: [ricambi registrati], failed: [{ sel, message }] }.
 */
export async function applyRicambi(selections, { linea, macchina, descrizione }) {
  const done = [];
  const failed = [];
  const lowStock = [];
  for (const sel of selections) {
    const p = sel.product;
    const params = {
      productId: p.id,
      tipo: 'prelievo',
      quantita: sel.quantita,
      // Cuscinetti: il punto indicato nel foglio (serve alla vita utile). Cinghie e ricambi: il punto standard dell'articolo, come nel Prelievo
      puntoUtilizzo: (p.categoria === 'cuscinetti' && sel.punto) || (p.punto_utilizzo_standard || '').trim() || null,
      linea,
      macchinario: p.categoria === 'cuscinetti' ? macchina : null, // il macchinario si registra solo per i cuscinetti, come nel Prelievo
      locationId: sel.locationId,
      note: `Intervento: ${descrizione}`.slice(0, 200),
    };
    try {
      const result = await processTransaction(params);
      done.push(toStored(sel));
      if (result?.sotto_scorta) lowStock.push(p.codice_articolo);
    } catch (err) {
      if (isNetworkError(err) && enqueueTransaction({ ...params, codice_articolo: p.codice_articolo })) {
        // Senza rete: il prelievo va in coda e si sincronizza da solo alla riconnessione
        adjustCachedProductQuantity(p.id, -sel.quantita, sel.locationId);
        done.push(toStored(sel));
        continue;
      }
      console.error(err);
      failed.push({ sel, message: err?.message?.includes('Giacenza insufficiente') ? 'giacenza insufficiente' : 'registrazione non riuscita' });
    }
  }
  if (done.length) bumpProductsVersion(); // la lista del Magazzino si aggiorna al rientro
  if (lowStock.length) {
    setTimeout(() => feedback.lowStockAlert(), 350);
    toastWarning(`⚠️ Scorta minima raggiunta: ${lowStock.join(', ')}.`, 6000);
  }
  return { done, failed };
}
