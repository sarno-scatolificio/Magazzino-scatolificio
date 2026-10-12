// =============================================================
// scanner-camera.js — Modalità, finestra di scansione e fotocamera
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { closeCodeSearchPanel, resetCodeSearch } from './scanner-search.js';
import { closeOverlay, openOverlay } from './ui-utils.js';
import { els, ss } from './scanner-shared.js';
import feedback from './feedback.js';
import { handleDetectedCode } from './scanner-result.js';
import { startCamera, stopCamera } from './camera.js';

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
