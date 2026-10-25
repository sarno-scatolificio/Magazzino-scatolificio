// =============================================================
// inventory-camera.js — Cassetto fotocamera dell'Inventario.
// Si apre da solo con la fotocamera già accesa, con i pulsanti per
// cambiare fotocamera e accendere il flash. Al primo codice letto
// si chiude e lo consegna a chi l'ha richiesto.
// =============================================================

import feedback from '../../shared/feedback.js';
import { closeOverlay, enableSheetDrag, modalCloseMs, openOverlay } from '../../shared/ui-utils.js';
import { startCamera, stopCamera, switchCamera, toggleTorch } from '../../shared/camera.js';

const READER_ID = 'inv-cam-reader';

const BTN =
  'inv-cam-btn press-spring hidden flex-1 min-h-[44px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 px-3 items-center justify-center gap-1.5 text-xs font-display font-semibold uppercase tracking-wide transition-colors';

/**
 * Apre il cassetto con la fotocamera e legge un codice a barre.
 * @param {{ title?: string, onCode: (code: string) => void }} opts
 */
export async function openCameraSheet({ title = 'Scansiona codice', onCode } = {}) {
  if (document.getElementById(READER_ID)) return; // già aperto

  const overlay = document.createElement('div');
  overlay.className =
    'modal-overlay hidden fixed inset-0 z-[99] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-md bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <h3 class="font-display font-bold text-lg uppercase tracking-wide">${title}</h3>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div class="px-5 pt-4 pb-5 space-y-3">
        <div id="${READER_ID}" class="w-full relative"></div>
        <p data-role="focus" class="hidden text-center text-xs text-graphite-500">Tocca lo schermo sul codice per mettere a fuoco</p>
        <div class="flex gap-2">
          <button type="button" data-act="switch" class="${BTN}"><i data-lucide="switch-camera" class="w-4 h-4" stroke-width="2"></i>Cambia fotocamera</button>
          <button type="button" data-act="torch" aria-label="Flash" class="${BTN}"><i data-lucide="flashlight" class="w-4 h-4" stroke-width="2"></i>Flash</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const switchBtn = overlay.querySelector('[data-act="switch"]');
  const torchBtn = overlay.querySelector('[data-act="torch"]');
  const focusHint = overlay.querySelector('[data-role="focus"]');
  const ui = { switchBtnEl: switchBtn, torchBtnEl: torchBtn, focusHintEl: focusHint };

  let closed = false;
  let done = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stopCamera().catch(() => {});
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  const close = () => {
    cleanup();
    closeOverlay(overlay);
  };

  const onDetected = (raw) => {
    const code = String(raw || '').trim();
    if (done || closed || !code) return;
    done = true;
    feedback.scanFound();
    close();
    onCode?.(code);
  };

  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.addEventListener('overlay-cancel', cleanup); // tasto indietro del telefono
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag(overlay.querySelector('.modal-panel'), close);
  switchBtn.addEventListener('click', () => {
    feedback.tap();
    switchCamera(onDetected, ui);
  });
  torchBtn.addEventListener('click', () => toggleTorch(torchBtn));

  openOverlay(overlay);
  window.lucide?.createIcons();

  // La fotocamera parte subito, senza un secondo tocco.
  const ok = await startCamera(READER_ID, onDetected, ui);
  if (ok === false) close(); // il messaggio d'errore l'ha già mostrato startCamera
}
