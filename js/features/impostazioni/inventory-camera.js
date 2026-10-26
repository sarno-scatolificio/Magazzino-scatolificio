// =============================================================
// inventory-camera.js — Cassetto fotocamera dell'Inventario.
// Si apre da solo con la fotocamera già accesa, con i pulsanti per
// cambiare fotocamera e accendere il flash. Al primo codice letto la
// fotocamera si ferma e il codice si mostra per intero: l'utente lo legge
// e conferma (oppure riscansiona) prima che venga salvato.
// =============================================================

import feedback from '../../shared/feedback.js';
import { closeOverlay, enableSheetDrag, modalCloseMs, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { startCamera, stopCamera, switchCamera, toggleTorch } from '../../shared/camera.js';

const READER_ID = 'inv-cam-reader';

const BTN =
  'inv-cam-btn press-spring hidden flex-1 min-h-[44px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 px-3 items-center justify-center gap-1.5 text-xs font-display font-semibold uppercase tracking-wide transition-colors';

/**
 * Apre il cassetto con la fotocamera e legge un codice a barre.
 * @param {{
 *   title?: string,
 *   subtitle?: string,
 *   confirmLabel?: string,
 *   onConfirm?: (code: string) => Promise<void>,
 *   onCode?: (code: string) => void,
 * }} opts  Con onConfirm il codice letto resta visibile finché l'utente conferma (o riscansiona);
 *          se onConfirm lancia un errore, il messaggio compare sotto il codice. Senza, il cassetto
 *          si chiude al primo codice e lo consegna a onCode.
 */
export async function openCameraSheet({ title = 'Scansiona codice', subtitle = '', confirmLabel = 'Conferma', onConfirm, onCode } = {}) {
  if (document.getElementById(READER_ID)) return; // già aperto

  const overlay = document.createElement('div');
  overlay.className =
    'modal-overlay hidden fixed inset-0 z-[99] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-md bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <h3 class="font-display font-bold text-lg uppercase tracking-wide"></h3>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div class="px-5 pt-4 pb-5 space-y-3">
        <p data-role="subtitle" class="hidden text-sm font-display font-bold break-words"></p>
        <div data-role="live" class="space-y-3">
          <div id="${READER_ID}" class="w-full relative"></div>
          <p data-role="focus" class="hidden text-center text-xs text-graphite-500">Tocca lo schermo sul codice per mettere a fuoco</p>
          <div class="flex gap-2">
            <button type="button" data-act="switch" class="${BTN}"><i data-lucide="switch-camera" class="w-4 h-4" stroke-width="2"></i>Cambia fotocamera</button>
            <button type="button" data-act="torch" aria-label="Flash" class="${BTN}"><i data-lucide="flashlight" class="w-4 h-4" stroke-width="2"></i>Flash</button>
          </div>
        </div>
        <div data-role="result" class="hidden space-y-3">
          <p class="text-[11px] uppercase tracking-wider font-display font-semibold text-graphite-400">Codice letto</p>
          <p data-role="code" class="rounded-lg border border-graphite-700 bg-graphite-800 px-4 py-3 font-display font-bold text-xl break-all"></p>
          <p data-role="err" class="hidden text-xs text-rose-700"></p>
          <div class="flex gap-2">
            <button type="button" data-act="retry" class="press-spring flex-1 min-h-[48px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 font-display font-semibold uppercase tracking-wide text-sm transition-colors">Riscansiona</button>
            <button type="button" data-act="confirm" class="press-spring flex-1 min-h-[48px] rounded-lg bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide text-sm transition-colors"></button>
          </div>
        </div>
      </div>
    </div>`;
  overlay.querySelector('h3').textContent = title;
  overlay.querySelector('[data-act="confirm"]').textContent = confirmLabel;
  const subtitleEl = overlay.querySelector('[data-role="subtitle"]');
  if (subtitle) {
    subtitleEl.textContent = subtitle;
    subtitleEl.classList.remove('hidden');
  }
  document.body.appendChild(overlay);

  const liveEl = overlay.querySelector('[data-role="live"]');
  const resultEl = overlay.querySelector('[data-role="result"]');
  const codeEl = overlay.querySelector('[data-role="code"]');
  const errEl = overlay.querySelector('[data-role="err"]');
  const confirmBtn = overlay.querySelector('[data-act="confirm"]');
  const switchBtn = overlay.querySelector('[data-act="switch"]');
  const torchBtn = overlay.querySelector('[data-act="torch"]');
  const focusHint = overlay.querySelector('[data-role="focus"]');
  const ui = { switchBtnEl: switchBtn, torchBtnEl: torchBtn, focusHintEl: focusHint };
  const showErr = (msg) => {
    errEl.textContent = msg || '';
    errEl.classList.toggle('hidden', !msg);
  };

  let closed = false;
  let done = false;
  let scanned = '';
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
    if (!onConfirm) {
      close();
      onCode?.(code);
      return;
    }
    // Conferma: la fotocamera si ferma e il codice letto resta in vista
    scanned = code;
    stopCamera().catch(() => {});
    codeEl.textContent = code;
    showErr('');
    liveEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
  };

  const startScan = async () => {
    done = false;
    const ok = await startCamera(READER_ID, onDetected, ui);
    if (ok === false) close(); // il messaggio d'errore l'ha già mostrato startCamera
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
  overlay.querySelector('[data-act="retry"]').addEventListener('click', () => {
    feedback.tap();
    resultEl.classList.add('hidden');
    liveEl.classList.remove('hidden');
    showErr('');
    startScan();
  });
  confirmBtn.addEventListener('click', async () => {
    if (!scanned) return;
    showErr('');
    setButtonBusy(confirmBtn, true, 'Salvataggio…');
    try {
      await onConfirm(scanned);
      close();
    } catch (ex) {
      feedback.errorAction();
      showErr(ex?.message || 'Operazione non riuscita.');
    } finally {
      setButtonBusy(confirmBtn, false);
    }
  });

  openOverlay(overlay);
  window.lucide?.createIcons();

  // La fotocamera parte subito, senza un secondo tocco.
  await startScan();
}
