// =============================================================
// scanner-camera.js — Modalità, finestra di scansione e fotocamera
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { closeCodeSearchPanel, resetCodeSearch } from './scanner-search.js';
import { closeOverlay, openOverlay } from '../../shared/ui-utils.js';
import { els, ss } from './scanner-shared.js';
import feedback from '../../shared/feedback.js';
import { handleDetectedCode } from './scanner-result.js';
import { startCamera, stopCamera } from '../../shared/camera.js';

export function updateOfflineBadge(count) {
  if (!els.offlineBadge) return;
  els.offlineBadge.classList.toggle('hidden', !count);
  if (els.offlineBadgeCount) els.offlineBadgeCount.textContent = count;
}

export function selectMode(mode) {
  feedback.modeSelect();
  ss.currentMode = mode;
  els.modeDeposito.classList.toggle('mode-active-deposito', mode === 'deposito');
  els.modePrelievo.classList.toggle('mode-active-prelievo', mode === 'prelievo');

  // Il colore di testata, bordo, conferma e anteprima dipende da questo attributo (vedi style.css)
  els.scanModalPanel.dataset.mode = mode;
  els.modeBanner.textContent = mode === 'deposito' ? 'Deposito' : 'Prelievo';

  openScanModal();
}

/** Apre la finestra di scansione/ricerca sopra la vista Scanner. La
 *  fotocamera NON parte da sola: resta il pulsante "Effettua scansione
 *  codice" finché l'utente non lo preme (vedi expandCamera). */
function openScanModal() {
  showFindMethods();
  openOverlay(els.scanModal);
  // Con mouse e tastiera (desktop) non c'è la fotocamera: la ricerca per codice è
  // l'unico modo per trovare l'articolo, quindi il cursore parte già nel campo.
  // Su telefono no: la tastiera resterebbe aperta senza che serva.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    requestAnimationFrame(() => els.codeSearchInput.focus({ preventScroll: true }));
  }
}

/** Chiude del tutto la finestra ed esce dalla modalità deposito/prelievo. */
// Tasto indietro del telefono: stessa chiusura del pulsante Annulla (ferma la fotocamera, azzera la modalità).
export function bindScanModalBack() {
  els.scanModal?.addEventListener('overlay-back', (e) => {
    e.preventDefault();
    closeScanModal();
  });
}

export function closeScanModal() {
  if (!els.scanModal.dataset.modalOpen) return; // già chiusa
  collapseCamera();
  ss.currentMode = null;
  ss.currentProduct = null;
  els.modeDeposito.classList.remove('mode-active-deposito');
  els.modePrelievo.classList.remove('mode-active-prelievo');
  closeOverlay(els.scanModal);
}

/** Torna alla schermata "scansiona o cerca", pronta per il prossimo
 *  articolo: fotocamera richiusa (va riaperta col pulsante), ricerca per
 *  codice azzerata. Usata sia alla prima apertura sia dopo un Annulla. */
export function showFindMethods() {
  els.findMethods.classList.remove('hidden');
  els.resultCard.classList.add('hidden');
  els.resultSkeleton.classList.add('hidden');
  resetCodeSearch();
  collapseCamera();
  toggleScanCameraSection(true);
}

/** Nasconde/mostra il pulsante "Effettua scansione codice" (e il
 *  separatore "oppure") per lasciare tutto lo spazio disponibile alla
 *  ricerca per codice mentre la tastiera è aperta. Se la fotocamera era
 *  attiva la richiude, dato che si sta comunque passando all'altro modo
 *  di cercare l'articolo. */
export function toggleScanCameraSection(show) {
  if (!show) collapseCamera();
  els.openCameraBtn.classList.toggle('hidden', !show);
  els.findDivider?.classList.toggle('hidden', !show);
}

/** Un articolo è stato trovato: si passa alla scheda quantità/conferma,
 *  richiudendo fotocamera e ricerca. */
export function hideFindMethods() {
  collapseCamera();
  els.findMethods.classList.add('hidden');
  closeCodeSearchPanel();
}

/** Espande con animazione fluida il riquadro della fotocamera e la avvia:
 *  chiamata solo dal pulsante "Effettua scansione codice", mai in automatico. */
export function expandCamera() {
  els.openCameraBtn.classList.add('hidden');
  els.cameraCollapse.classList.add('expanded');
  startCamera('scanner-reader', handleDetectedCode, {
    focusHintEl: els.focusHint,
    switchBtnEl: els.switchCameraBtn,
    torchBtnEl: els.torchBtn,
    errorHint: 'Usa la ricerca per codice.',
  }).then((started) => {
    if (started === null) return; // richiesta superata da una chiusura: la sezione è già a posto
    if (started) els.stopCameraBtn.classList.remove('hidden');
    else collapseCamera(); // fotocamera non disponibile: torna al pulsante
  });
}

/** Richiude il riquadro della fotocamera (stessa animazione, alla
 *  rovescia) e la ferma. Riporta al solo pulsante "Effettua scansione". */
export function collapseCamera() {
  stopCamera();
  els.cameraCollapse.classList.remove('expanded');
  els.openCameraBtn.classList.remove('hidden');
  els.switchCameraBtn?.classList.add('hidden');
  els.stopCameraBtn?.classList.add('hidden');
  els.torchBtn?.classList.add('hidden');
  els.focusHint?.classList.add('hidden');
}

/* ------------------------------------------------------------------
   Tieni premuto Deposito/Prelievo (solo touch/penna): dopo un attimo, dal punto toccato, un cerchio si allarga
   un po' alla volta sul pulsante con sopra l'icona di scansione; a riempimento completo si apre il cassetto e
   parte direttamente la fotocamera (un solo gesto, al posto di tocco + tocco su "Effettua scansione codice").
   Rilasciando prima, o muovendo il dito (scorrimento della pagina), il cerchio si richiude e non succede nulla.
   Un tocco breve resta quello di sempre (apre il cassetto, vedi scanner.js).
   ------------------------------------------------------------------ */
const HOLD_DELAY_MS = 180; // sotto questa soglia è un tocco normale: nessun effetto
const HOLD_GROW_MS = 600; // tempo di riempimento del pulsante
const HOLD_MOVE_TOLERANCE = 12; // px di spostamento oltre i quali è uno scorrimento, non una pressione
const HOLD_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/>' +
  '<path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M17 7v10"/></svg>';
let holdClickBlockUntil = 0;

/** Vero subito dopo una pressione lunga completata: il click che segue il rilascio va ignorato. */
export function holdScanJustFired() {
  return performance.now() < holdClickBlockUntil;
}

export function bindHoldToScan(btn, mode) {
  if (!btn) return;
  const fx = document.createElement('span');
  fx.className = 'hold-scan-fx';
  fx.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'hold-scan-icon';
  icon.innerHTML = HOLD_ICON_SVG;
  fx.appendChild(icon);
  btn.appendChild(fx);
  btn.classList.add('hold-scan-btn');

  let delayTimer = null;
  let anims = [];
  let startX = 0;
  let startY = 0;
  let pressing = false; // dito giù e gesto ancora valido
  let released = false; // il cerchio si sta richiudendo
  let fired = false; // riempimento completato: scansione avviata

  const cleanup = () => {
    anims.forEach((a) => a.cancel());
    anims = [];
    fx.classList.remove('is-on');
  };

  const complete = () => {
    fired = true;
    pressing = false;
    holdClickBlockUntil = performance.now() + 800;
    selectMode(mode); // apre il cassetto (e dà già il feedback di selezione)
    expandCamera(); // e avvia subito la fotocamera
    setTimeout(cleanup, 350); // il cassetto ora copre il pulsante: si ripristina l'aspetto normale
  };

  const startFill = () => {
    delayTimer = null;
    const rect = btn.getBoundingClientRect();
    const cx = startX - rect.left;
    const cy = startY - rect.top;
    // raggio che arriva fino all'angolo più lontano dal punto toccato
    const radius = Math.ceil(Math.hypot(Math.max(cx, rect.width - cx), Math.max(cy, rect.height - cy))) + 2;
    const grow = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : HOLD_GROW_MS;
    fx.classList.add('is-on');
    const opts = { duration: grow, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' };
    const fill = fx.animate(
      [{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${radius}px at ${cx}px ${cy}px)` }],
      opts
    );
    const ico = icon.animate(
      [
        { opacity: 0, transform: 'scale(0.55)' },
        { opacity: 0, transform: 'scale(0.55)', offset: 0.35 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      opts
    );
    anims = [fill, ico];
    fill.onfinish = () => {
      if (!released && pressing) complete();
    };
  };

  const cancel = () => {
    if (fired) return; // a gesto completato il resto lo gestisce complete()
    pressing = false;
    if (delayTimer) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (!anims.length) return;
    released = true; // si richiude più in fretta di come si è aperto
    const [fill] = anims;
    anims.forEach((a) => (a.playbackRate = -2.5));
    fill.onfinish = cleanup;
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return; // solo dito/penna: col mouse non c'è la fotocamera
    cleanup();
    pressing = true;
    released = false;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    delayTimer = setTimeout(startFill, HOLD_DELAY_MS);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!pressing) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > HOLD_MOVE_TOLERANCE) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, cancel));
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  });
  // Tenere premuto su touch apre il menu contestuale/selezione del telefono: va evitato
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
