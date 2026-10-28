// =============================================================
// scanner.js — Scansione barcode con fotocamera + flusso deposito/prelievo
// =============================================================
// Questo file tiene l'avvio dello scanner e le funzioni usate dal resto dell'app; il resto è diviso in
// scanner-shared / -camera / -search / -result / -punti / -transaction / -idle.

import { bindHoldRepeat, handleDetectedCode, onProductMatched, refreshPuntoHint, setAdvancedOpen, setLinea, setPrestito } from './scanner-result.js';
import { bindScanModalBack, closeScanModal, collapseCamera, expandCamera, selectMode, toggleScanCameraSection, updateOfflineBadge } from './scanner-camera.js';
import { confirmTransaction, resetAll, resetResult } from './scanner-transaction.js';
import { els, ss } from './scanner-shared.js';
import { enableSheetDrag } from '../../shared/ui-utils.js';
import feedback from '../../shared/feedback.js';
import { getQueueCount, onQueueChange } from '../../core/offline-queue.js';
import { initCodeSearch } from './scanner-search.js';
import { initScannerDesktop } from './scanner-desktop.js';
import { loadIdlePanel } from './scanner-idle.js';
import { paintPunti, pickMacchinario, refreshPuntiSuggeriti, syncMacchinarioBtn } from './scanner-punti.js';
import { stopCamera, switchCamera as switchCameraShared, toggleTorch } from '../../shared/camera.js';
export { loadIdlePanel } from './scanner-idle.js';

export function initScanner() {
  els.modeDeposito = document.getElementById('mode-deposito');
  els.modePrelievo = document.getElementById('mode-prelievo');
  els.scanModal = document.getElementById('scan-mode-modal');
  els.scanModalPanel = document.getElementById('scan-modal-panel');
  els.closeModalBtn = document.getElementById('scan-mode-close-btn');
  els.findMethods = document.getElementById('scan-find-methods');
  els.openCameraBtn = document.getElementById('scan-open-camera-btn');
  els.cameraCollapse = document.getElementById('scanner-camera-collapse');
  els.readerWrap = document.getElementById('scanner-reader-wrap');
  els.reader = document.getElementById('scanner-reader');
  els.codeSearchWrap = document.getElementById('scanner-code-search-wrap');
  els.codeSearchInput = document.getElementById('scanner-code-search-input');
  els.codeSearchResults = document.getElementById('scanner-code-search-results');
  els.findDivider = document.getElementById('scan-find-divider');
  els.resultCard = document.getElementById('scan-result-card');
  els.resultSkeleton = document.getElementById('scan-result-skeleton');
  els.productName = document.getElementById('scan-product-name');
  els.productCode = document.getElementById('scan-product-code');
  els.productStock = document.getElementById('scan-product-stock');
  els.productLoc = document.getElementById('scan-product-loc');
  els.shelfWrap = document.getElementById('scan-shelf-wrap');
  els.shelfGroup = document.getElementById('scan-shelf-group');
  els.qtyInput = document.getElementById('scan-qty-input');
  els.qtyValue = document.getElementById('scan-qty-value');
  els.qtyMinusBtn = document.getElementById('scan-qty-minus');
  els.qtyPlusBtn = document.getElementById('scan-qty-plus');
  els.puntoInput = document.getElementById('scan-punto-input');
  els.puntoWrap = document.getElementById('scan-punto-wrap');
  els.puntoLabel = document.getElementById('scan-punto-label');
els.puntoSuggest = document.getElementById('scan-punto-suggest');
els.puntoList = document.getElementById('scan-punto-list');
els.puntoHome = els.puntoWrap.parentElement; // posizione di partenza (Deposito); nel Prelievo dei cuscinetti il campo va dopo il macchinario
els.macchinarioBtn = document.getElementById('scan-macchinario-btn');
els.macchinarioValue = document.getElementById('scan-macchinario-value');
  els.prelievoFields = document.getElementById('scan-prelievo-fields');
  els.lineaGroup = document.getElementById('scan-linea-group');
  els.lineaInput = document.getElementById('scan-linea-input');
  els.lineaFixed = document.getElementById('scan-linea-fixed');
  els.lineaFixedName = document.getElementById('scan-linea-fixed-name');
  els.macchinarioWrap = document.getElementById('scan-macchinario-wrap');
  els.macchinarioSelect = document.getElementById('scan-macchinario-input');
  els.advancedWrap = document.getElementById('scan-advanced');
  els.puntoHint = document.getElementById('scan-punto-hint');
  els.advancedToggle = document.getElementById('scan-advanced-toggle');
  els.advancedPanel = document.getElementById('scan-advanced-panel');
  els.prestitoToggle = document.getElementById('scan-prestito-toggle');
  els.prestitoState = document.getElementById('scan-prestito-state');
  els.prestitoDestWrap = document.getElementById('scan-prestito-dest-wrap');
  els.prestitoDest = document.getElementById('scan-prestito-dest');
  els.confirmBtn = document.getElementById('scan-confirm-btn');
  els.cancelBtn = document.getElementById('scan-cancel-btn');
  els.modeBanner = document.getElementById('scan-mode-banner');
  els.afterBox = document.getElementById('scan-after');
  els.afterValue = document.getElementById('scan-after-value');
  els.afterLabel = document.getElementById('scan-after-label');
  els.stopCameraBtn = document.getElementById('scanner-stop-btn');
  els.switchCameraBtn = document.getElementById('scanner-switch-btn');
  els.torchBtn = document.getElementById('scanner-torch-btn');
  els.focusHint = document.getElementById('scanner-focus-hint');
  els.idlePanel = document.getElementById('scanner-idle-panel');
  els.lowStockCountEl = document.getElementById('scanner-lowstock-count');
  els.recentListEl = document.getElementById('scanner-recent-list');
  els.recentEmptyEl = document.getElementById('scanner-recent-empty');
  els.offlineBadge = document.getElementById('scanner-offline-badge');
  els.offlineBadgeCount = document.getElementById('scanner-offline-badge-count');

  // Linee/ordine/elenco delle macchine cambiati dalle Impostazioni: si rilegge al prossimo prelievo
  window.addEventListener('machines-changed', () => {
    ss.machinesCache = null;
  });

  // Punto di utilizzo dei cuscinetti: i punti già usati si estendono da soli sotto il campo (appena scelti linea e macchinario);
  // toccando il campo per scrivere la tendina si chiude
  els.puntoInput.addEventListener('input', refreshPuntoHint);
  els.puntoInput.addEventListener('focus', () => {
    ss.puntiOpen = false;
    paintPunti();
  });
  els.macchinarioSelect.addEventListener('change', () => {
    syncMacchinarioBtn();
    refreshPuntiSuggeriti({ autoOpen: true });
  });
  els.macchinarioBtn.addEventListener('click', pickMacchinario);
  els.lineaGroup?.querySelectorAll('[data-linea]').forEach((btn) => {
    btn.addEventListener('click', () => {
      feedback.focusTap();
      setLinea(btn.dataset.linea);
    });
  });

  els.modeDeposito.addEventListener('click', () => selectMode('deposito'));
  els.modePrelievo.addEventListener('click', () => selectMode('prelievo'));
  els.closeModalBtn.addEventListener('click', () => {
    feedback.cancelAction();
    closeScanModal();
  });
  enableSheetDrag(els.scanModalPanel, closeScanModal); // trascinamento verso il basso per chiudere
  els.openCameraBtn.addEventListener('click', expandCamera);
  // Appena si tocca il campo di ricerca, il pulsante "scansiona" e il
  // separatore spariscono per fare spazio ai risultati (la modale è
  // sempre ancorata in alto, quindi c'è già spazio sotto la barra di
  // ricerca a prescindere dalla tastiera).
  els.codeSearchInput.addEventListener('focus', () => {
    toggleScanCameraSection(false);
    setTimeout(() => {
      els.codeSearchWrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 300);
  });
  els.codeSearchInput.addEventListener('blur', () => {
    if (!els.codeSearchInput.value.trim()) toggleScanCameraSection(true);
  });
  initCodeSearch();
  initScannerDesktop(); // solo desktop: campo di scansione sempre pronto e scorciatoie da tastiera
  els.cancelBtn.addEventListener('click', () => {
    feedback.cancelAction();
    resetResult();
  });
  els.advancedToggle?.addEventListener('click', () => {
    feedback.tap();
    setAdvancedOpen(els.advancedPanel.classList.contains('is-open') ? false : true);
  });
  els.prestitoToggle?.addEventListener('click', () => {
    feedback.focusTap();
    setPrestito(!ss.prestito, { focus: true });
  });
  els.confirmBtn.addEventListener('click', confirmTransaction);
  bindHoldRepeat(els.qtyMinusBtn, -1);
  bindHoldRepeat(els.qtyPlusBtn, 1);
  els.stopCameraBtn.addEventListener('click', collapseCamera);
  els.switchCameraBtn.addEventListener('click', () =>
    switchCameraShared(handleDetectedCode, { focusHintEl: els.focusHint, switchBtnEl: els.switchCameraBtn, torchBtnEl: els.torchBtn })
  );
  els.torchBtn?.addEventListener('click', () => toggleTorch(els.torchBtn));

  onQueueChange(updateOfflineBadge);
  updateOfflineBadge(getQueueCount());

  resetAll();
  loadIdlePanel();
  bindScanModalBack();
}

/** Chiamata quando si esce dalla vista scanner (es. cambio tab) */
/** Avvia un movimento con un articolo già scelto (ricerca/scansione in testata):
 *  apre il cassetto Deposito/Prelievo direttamente sulla scheda quantità. */
export function startMovement(product, mode) {
  if (!product || !els.scanModal) return;
  selectMode(mode);
  onProductMatched(product);
}

/* ------------------------------------------------------------------
   Ingresso animato di Movimenti (solo al primo arrivo dopo l'apertura/accesso):
   1. le schede "Articoli sotto scorta", "Prestiti in sospeso" (solo admin) e "Ultimi movimenti" salgono una dopo l'altra
      da dietro la barra in basso;
   2. Deposito e poi Prelievo entrano uno dopo l'altro, in modo semplice (nessun rimbalzo);
   3. la barra di ricerca in basso esce da sotto la navigazione e sale a velocità costante, subito dopo l'inizio della comparsa dei pulsanti.
   Web Animations API: solo transform/opacity, nessuno stato lasciato dietro.
   ------------------------------------------------------------------ */
export function playScannerIntro() {
  const view = document.getElementById('view-scanner');
  if (!view || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  view.classList.add('intro-pending'); // nasconde subito i 4 elementi: niente lampo prima dell'animazione

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const cards = [
        document.getElementById('scanner-lowstock-card'),
        document.getElementById('scanner-prestiti-btn'), // solo admin: per gli altri è nascosta e salta da sola
        document.querySelector('#scanner-idle-panel > .card-plate:last-child'),
      ].filter((c) => c && c.offsetParent);
      const dep = document.getElementById('mode-deposito');
      const pre = document.getElementById('mode-prelievo');
      const vh = window.innerHeight;
      const anims = [];

      // 1) Schede: partono dietro la barra in basso (altezza = distanza fino al fondo schermo)
      cards.forEach((card, i) => {
        const rise = Math.max(120, vh - card.getBoundingClientRect().top);
        anims.push(
          card.animate(
            [
              { transform: `translateY(${rise}px)`, opacity: 1 },
              { transform: 'translateY(0)', opacity: 1 },
            ],
            { duration: 760, delay: i * 170, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' }
          )
        );
      });

      // 2) Pulsanti: dopo la lista, entrano semplicemente uno dopo l'altro (Deposito, poi Prelievo): niente rimbalzo
      const base = 160 + Math.max(0, cards.length) * 170;
      if (dep && pre) {
        [dep, pre].forEach((btn, i) => {
          anims.push(
            btn.animate(
              [
                { transform: 'translateY(22px)', opacity: 0 },
                { transform: 'translateY(0)', opacity: 1 },
              ],
              { duration: 480, delay: base + i * 130, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' }
            )
          );
        });
      }

      // 3) Barra di ricerca in basso: esce da sotto la barra di navigazione (quella con i 4 pulsanti sezione) e sale in modo
      //    uniforme (easing lineare, sempre opaca), partendo subito dopo l'inizio della comparsa dei pulsanti.
      //    Classe dock-intro: la barra sta sotto la navigazione (z-index) e senza transizioni CSS, altrimenti
      //    l'aggiornamento di --nav-h (altezza reale della navigazione) muoveva `bottom` a metà salita.
      const dock = document.getElementById('search-dock');
      const nav = document.querySelector('nav.nav-glass');
      if (dock && nav && dep && pre && getComputedStyle(dock).display !== 'none') {
        dock.classList.add('dock-intro');
        // distanza che porta il bordo alto della barra a filo con il bordo alto della navigazione (poi +2 px di sicurezza)
        const hide = Math.max(0, nav.getBoundingClientRect().top - dock.getBoundingClientRect().top) + 2;
        const dockAnim = dock.animate(
          [
            { transform: `translateY(${hide}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 520, delay: base + 70, easing: 'linear', fill: 'backwards' }
        );
        anims.push(dockAnim);
        const done = () => dock.classList.remove('dock-intro');
        dockAnim.finished.then(done).catch(done);
      }

      view.classList.remove('intro-pending'); // le animazioni (fill backwards) tengono già la posizione di partenza
      Promise.allSettled(anims.map((a) => a.finished)).then(() => anims.forEach((a) => a.cancel()));
    })
  );
}

export function teardownScanner() {
  stopCamera();
  resetAll();
}

/** Attiva direttamente una modalità (deposito/prelievo), usata dagli shortcut della PWA */
export function activateMode(mode) {
  if (mode !== 'deposito' && mode !== 'prelievo') return;
  selectMode(mode);
}
