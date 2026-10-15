// =============================================================
// scanner-result.js — Codice rilevato, scheda dell'articolo, quantità e campi del prelievo
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { els, ss } from './scanner-shared.js';
import feedback from '../../shared/feedback.js';
import { fillMacchinari, refreshPuntiSuggeriti, renderMacchinariOptions } from './scanner-punti.js';
import { getCachedProductByBarcode, getProductByBarcode, getProductLocations, machineOnLinea } from '../../data/supabase.js';
import { hideFindMethods } from './scanner-camera.js';
import { replayAnimation } from '../../shared/ui-utils.js';
import { toastError, toastWarning } from '../../shared/toast.js';

export async function handleDetectedCode(code) {
  // Debounce: evita letture duplicate ravvicinate dello stesso codice.
  const debounceMs = 2500;
  const now = Date.now();
  if (code === ss.lastCode && now - ss.lastCodeAt < debounceMs) return;
  ss.lastCode = code;
  ss.lastCodeAt = now;

  if (!ss.currentMode) {
    feedback.scanNoMode();
    toastWarning('Seleziona prima DEPOSITO o PRELIEVO.');
    return;
  }

  showResultSkeleton();
  try {
    let product;
    let fromCache = false;
    try {
      product = await getProductByBarcode(code);
    } catch (networkErr) {
      product = getCachedProductByBarcode(code);
      fromCache = !!product;
      if (!fromCache) throw networkErr;
    }

    if (!product) {
      hideResultSkeleton();
      feedback.scanNotFound();
      replayAnimation(els.reader, 'reader-flash-fail');
      toastError(`Nessun articolo trovato per il codice "${code}".`);
      return;
    }
    feedback.scanFound();
    replayAnimation(els.reader, 'reader-flash-ok');
    onProductMatched(product, { fromCache });
  } catch (err) {
    console.error(err);
    hideResultSkeleton();
    feedback.errorAction();
    replayAnimation(els.reader, 'reader-flash-fail');
    toastError('Errore nella ricerca articolo.');
  }
}

/** Un articolo è stato individuato (fotocamera o ricerca per codice): chiude
 *  subito l'interfaccia di ricerca e passa alla selezione di quantità/
 *  dettagli. Punto unico condiviso da entrambi i modi di trovare un
 *  articolo, cosí si comportano sempre allo stesso modo. */
export function onProductMatched(product, { fromCache = false } = {}) {
  document.activeElement?.blur(); // chiude la tastiera se il campo ricerca codice aveva il focus
  if (fromCache) toastWarning('Offline: dati dell\'articolo dall\'ultima sincronizzazione, potrebbero non essere aggiornati.', 4000);
  ss.currentProduct = product;
  hideFindMethods();
  renderResult(product);
}

function showResultSkeleton() {
  els.resultCard.classList.add('hidden');
  els.resultSkeleton.classList.remove('hidden');
}
function hideResultSkeleton() {
  els.resultSkeleton.classList.add('hidden');
}

/** Aggiorna sia il valore nascosto (quello letto da confirmTransaction) sia
 *  quello mostrato all'operatore, con un minimo di 1. Niente tastiera:
 *  la quantità si cambia solo con i due pulsanti +/-. */
function setQty(value) {
  const qty = Math.max(1, Math.round(value) || 1);
  els.qtyInput.value = qty;
  els.qtyValue.textContent = qty;
  updateAfterPreview();
}

/** Anteprima "Giacenza dopo": mostra subito l'effetto dell'operazione sulla
 *  giacenza (freccia su/giù) e avvisa in rosso se un prelievo supera quanto c'è. */
function updateAfterPreview() {
  if (!els.afterBox || !ss.currentProduct) return;
  const locs = getProductLocations(ss.currentProduct);
  const multiple = locs.length > 1;
  const isDeposit = ss.currentMode === 'deposito';
  if (multiple && !ss.currentLocationId) {
    // Articolo su più scaffali: finché non si sceglie lo scaffale non c'è una giacenza da confrontare
    els.afterBox.classList.remove('scan-after-warn');
    els.afterLabel.textContent = 'Scegli lo scaffale';
    els.afterValue.textContent = '—';
    return;
  }
  // Su più scaffali conta la quantità dello scaffale scelto, altrimenti la giacenza dell'articolo
  const chosen = multiple ? locs.find((l) => l.id === ss.currentLocationId) : null;
  const stock = Number(chosen ? chosen.quantita : ss.currentProduct.quantita_disponibile) || 0;
  const qty = parseInt(els.qtyInput.value, 10) || 1;
  const after = isDeposit ? stock + qty : stock - qty;
  const insufficient = !isDeposit && after < 0;
  els.afterBox.classList.toggle('scan-after-warn', insufficient);
  if (insufficient) {
    els.afterLabel.textContent = chosen ? 'Non basta su questo scaffale' : 'Non basta la giacenza';
    els.afterValue.textContent = `disponibili ${stock}`;
  } else {
    els.afterLabel.textContent = chosen ? `Scaffale ${chosen.locazione || 'senza nome'} dopo` : 'Giacenza dopo';
    els.afterValue.textContent = `${isDeposit ? '↑' : '↓'} ${after} (${isDeposit ? '+' : '−'}${qty})`;
  }
}
function stepQty(delta) {
  feedback.focusTap();
  setQty(parseInt(els.qtyInput.value, 10) + delta);
}

// ---- Pressione prolungata sui pulsanti +/− della quantità -------------------
// Un tocco = ±1. Tenendo premuto, dopo una breve attesa parte la ripetizione
// a velocità costante, con un tick aptico+sonoro a ogni scatto:
// - da 1 a 5: un numero alla volta, uno scatto ogni HOLD_FINE_MS
// - da 5 in su: salti di 5 (5 → 10 → 15 → 20 …), uno scatto ogni HOLD_COARSE_MS
// - da 30 in su: stessi salti di 5 ma più veloci, uno scatto ogni HOLD_FAST_MS
// In discesa è speculare (… 35 → 30 → 25 → 20 → 15 → 10 → 5, poi 4 → 3 → 2 → 1).
const HOLD_DELAY_MS = 400; // attesa prima che parta la ripetizione (evita scatti involontari su un tocco lungo)
const HOLD_FINE_MS = 300; // intervallo tra gli scatti da ±1
const HOLD_COARSE_MS = 500; // intervallo tra gli scatti da ±5
const HOLD_FAST_MS = 200; // intervallo tra gli scatti da ±5 oltre la soglia veloce
const HOLD_FAST_FROM = 30; // da questo valore in su gli scatti da 5 accelerano
const HOLD_JUMP = 5;

/** Passo del prossimo scatto: ±1 sotto la soglia, ±5 (agganciato ai multipli di 5) sopra. */
function nextHoldValue(cur, dir) {
  const fine = dir > 0 ? cur < HOLD_JUMP : cur <= HOLD_JUMP;
  if (fine) return { value: cur + dir, coarse: false };
  const value = dir > 0 ? (Math.floor(cur / HOLD_JUMP) + 1) * HOLD_JUMP : (Math.ceil(cur / HOLD_JUMP) - 1) * HOLD_JUMP;
  return { value, coarse: true };
}

/** Attesa prima del prossimo scatto, in base al valore da cui si parte. */
function holdInterval(cur, dir) {
  if (!nextHoldValue(cur, dir).coarse) return HOLD_FINE_MS;
  const fast = dir > 0 ? cur >= HOLD_FAST_FROM : cur > HOLD_FAST_FROM;
  return fast ? HOLD_FAST_MS : HOLD_COARSE_MS;
}

export function bindHoldRepeat(btn, dir) {
  let timer = null;
  btn.dataset.noHaptic = '1'; // il feedback lo danno già gli scatti (stepQty / qtyTick)

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  function tick() {
    const cur = parseInt(els.qtyInput.value, 10) || 1;
    const { value, coarse } = nextHoldValue(cur, dir);
    const clamped = Math.max(1, value);
    if (clamped === cur) {
      stop(); // già al minimo: inutile continuare a ripetere
      return;
    }
    setQty(clamped);
    feedback.qtyTick(coarse ? 1 : 0);
    timer = setTimeout(tick, holdInterval(clamped, dir));
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      // non essenziale: senza cattura il rilascio fuori dal pulsante è comunque gestito da pointerleave
    }
    stepQty(dir); // il primo scatto è immediato, come un normale tocco
    timer = setTimeout(tick, HOLD_DELAY_MS);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  // Tasto lungo su touch = menu contestuale/selezione: va evitato, altrimenti interrompe la ripetizione
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // Tastiera / tecnologie assistive: Invio o Spazio generano un click senza pointer (detail 0)
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) stepQty(dir);
  });
}

function renderResult(product) {
  hideResultSkeleton();
  els.resultCard.classList.remove('hidden');
  replayAnimation(els.resultCard, 'result-pop');
  // Cinghie: in alto in grassetto la descrizione, sotto (più piccolo) il codice. Negli altri
  // casi, o se la descrizione manca, c'è solo il codice: mai lo stesso testo due volte.
  const descrizione = (product.punto_utilizzo_standard || '').trim();
  const descrizioneInTitolo = product.categoria === 'cinghie' && descrizione && descrizione !== product.codice_articolo;
  els.productName.textContent = descrizioneInTitolo ? descrizione : product.codice_articolo;
  els.productCode.textContent = descrizioneInTitolo ? product.codice_articolo : '';
  els.productCode.classList.toggle('hidden', !descrizioneInTitolo);
  els.productStock.textContent = product.quantita_disponibile;
  const locNames = getProductLocations(product).map((l) => l.locazione).filter(Boolean);
  els.productLoc.textContent = locNames.length ? locNames.join(', ') : '—';
  renderShelfChoices(product);
  els.puntoInput.value = product.punto_utilizzo_standard || '';
  setupPrelievoFields(product);
  setQty(1);

  els.confirmBtn.textContent = ss.currentMode === 'deposito' ? 'Conferma deposito' : 'Conferma prelievo';
  // Il colore del pulsante segue la modalità (variabili di data-mode sul pannello)
  els.confirmBtn.className = 'btn-mode press-spring flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide';
  updateAfterPreview();
}

/**
 * Articolo su più scaffali: mostra un pulsante per scaffale (con la sua quantità) e obbliga a sceglierne
 * uno prima di confermare, senza preselezione. Con un solo scaffale non c'è nulla da scegliere:
 * il movimento va su quello. Nel prelievo gli scaffali vuoti non sono selezionabili.
 */
function renderShelfChoices(product) {
  const locs = getProductLocations(product);
  const multiple = locs.length > 1;
  ss.currentLocationId = multiple ? null : locs[0]?.id ?? null;
  els.shelfWrap.classList.toggle('hidden', !multiple);
  els.shelfGroup.innerHTML = '';
  if (!multiple) return;

  const isPrelievo = ss.currentMode === 'prelievo';
  locs.forEach((l) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.locationId = l.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.disabled = isPrelievo && l.quantita <= 0;
    btn.className =
      'scan-linea-btn press-spring min-h-[44px] rounded-lg border px-3 py-1.5 font-display font-semibold tracking-wide text-sm bg-graphite-900 text-graphite-200 border-graphite-700 flex flex-col items-center justify-center leading-tight disabled:opacity-40';
    const name = document.createElement('span');
    name.className = 'uppercase max-w-full truncate';
    name.textContent = l.locazione || 'Senza scaffale'; // testo, mai HTML
    const qty = document.createElement('span');
    qty.className = 'font-mono text-xs font-normal opacity-80';
    qty.textContent = `${l.quantita} pz`;
    btn.append(name, qty);
    btn.addEventListener('click', () => {
      feedback.focusTap();
      ss.currentLocationId = l.id;
      els.shelfGroup.querySelectorAll('[data-location-id]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.locationId === l.id));
      });
      updateAfterPreview();
    });
    els.shelfGroup.appendChild(btn);
  });
}

/** Evidenzia la linea scelta (L1/L2) e la salva nel campo nascosto. '' = nessuna scelta. */
export function setLinea(value) {
  els.lineaInput.value = value || '';
  els.lineaGroup.querySelectorAll('[data-linea]').forEach((btn) => {
    const on = btn.dataset.linea === value;
    btn.setAttribute('aria-pressed', String(on));
  });
  refreshPuntiSuggeriti();
  // Il Macchinario segue la linea: su Linea 1 non compaiono le macchine che stanno solo su Linea 2 (e viceversa)
  if (ss.machinesCache && ss.currentMode === 'prelievo' && !els.macchinarioWrap.classList.contains('hidden')) {
    const names = machineNamesForLinea(value);
    const cur = els.macchinarioSelect.value;
    renderMacchinariOptions(names, names.some((n) => n.toLowerCase() === cur.toLowerCase()) ? cur : '');
  }
}

/** Nomi delle macchine presenti sulla linea (tutte se la linea non è ancora scelta), nell'ordine dell'admin */
export function machineNamesForLinea(linea) {
  return (ss.machinesCache || []).filter((e) => machineOnLinea(e, linea)).map((e) => e.nome);
}

/**
 * Campi extra del Prelievo: la linea si chiede sempre; per i cuscinetti anche
 * macchinario e punto di utilizzo. Per cinghie e ricambi tecnici il punto non
 * si chiede (resta quello standard dell'articolo).
 */
function setupPrelievoFields(product) {
  const isPrelievo = ss.currentMode === 'prelievo';
  const isBearing = product.categoria === 'cuscinetti';
  els.prelievoFields.classList.toggle('hidden', !isPrelievo);
  els.macchinarioWrap.classList.toggle('hidden', !(isPrelievo && isBearing));
  els.puntoWrap.classList.toggle('hidden', isPrelievo && !isBearing);
  els.puntoLabel.textContent = isPrelievo && isBearing ? 'Punto di utilizzo' : 'Punto utilizzo';
  els.puntoInput.placeholder = isPrelievo && isBearing ? 'Dove viene montato' : 'es. Linea 1';
  // Articolo usato su una sola linea (L1 o L2): la linea è automatica e non si sceglie, si vede solo quale è.
  // Con L1-L2 o senza linea, invece, va scelta.
  const fixedLinea = product.linea === 'L1' || product.linea === 'L2' ? product.linea : '';
  setLinea(fixedLinea);
  els.lineaGroup.classList.toggle('hidden', !!fixedLinea);
  els.lineaFixed.classList.toggle('hidden', !fixedLinea);
  els.lineaFixedName.textContent = fixedLinea === 'L1' ? 'Linea 1' : fixedLinea === 'L2' ? 'Linea 2' : '';
  // Punto di utilizzo già assegnato al cuscinetto: nessun suggerimento (non c'è nulla da scegliere) e linea e macchinario
  // vanno indicati ogni volta dall'operatore, senza macchina preimpostata
  // Cuscinetto in Prelievo: ordine Linea → Macchinario → Punto di utilizzo (il campo scende sotto il macchinario)
  (isPrelievo && isBearing ? els.prelievoFields : els.puntoHome).appendChild(els.puntoWrap);
  ss.puntoPrefilled = isBearing && (product.punto_utilizzo_standard || '').trim() !== '';
  if (isPrelievo && isBearing) fillMacchinari(ss.puntoPrefilled ? '' : product.macchina);
  ss.puntiOpen = false;
  refreshPuntiSuggeriti();
}
