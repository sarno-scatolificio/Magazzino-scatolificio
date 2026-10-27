// =============================================================
// shelf-photos.js — Gestione scaffali: foto di uno scaffale (solo Admin).
// Scatta o scegli una foto, ritagliala e ruotala come serve, e l'app la riduce e la carica. Da qui si può anche
// ritagliare di nuovo la foto già caricata o toglierla. Dove sta ogni articolo sulla foto si indica poi dalla scheda
// dell'articolo (shared/shelf-photo-viewer.js).
// =============================================================

import { loadShelfPhotos, getShelfPhoto, getShelfPhotoUrl, uploadShelfPhoto, deleteShelfPhoto } from '../../data/supabase.js';
import { openPhotoCropper } from '../../shared/photo-cropper.js';
import { toastSuccess, toastError } from '../../shared/toast.js';
import { closeOverlay, enableSheetDrag, modalCloseMs, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import feedback from '../../shared/feedback.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtKB = (bytes) => `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
const BTN =
  'press-spring min-h-[48px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 px-3 flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-wide text-sm transition-colors disabled:opacity-50';

/**
 * @param {{ nome: string }} shelf
 * @param {{ onChanged?: () => void }} opts  chiamata dopo ogni salvataggio o eliminazione
 */
export async function openShelfPhotoManager(shelf, { onChanged } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[94] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-md bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between gap-3 px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <div class="min-w-0">
          <h3 class="font-display font-bold text-lg uppercase tracking-wide">Foto scaffale</h3>
          <p class="text-xs text-graphite-400 truncate">${esc(shelf.nome)}</p>
        </div>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <div data-role="preview" class="rounded-lg border border-graphite-700 bg-graphite-800/40 min-h-[120px] flex items-center justify-center overflow-hidden">
          <p data-role="empty" class="text-sm text-graphite-400 px-4 py-8 text-center">Nessuna foto per questo scaffale.</p>
          <img data-role="img" alt="Foto dello scaffale" class="hidden block max-w-full" style="max-height: 40vh; width: auto; height: auto" />
        </div>
        <p data-role="info" class="hidden text-xs text-graphite-400 text-center font-mono"></p>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" data-act="shoot" class="${BTN}"><i data-lucide="camera" class="w-4 h-4"></i>Scatta foto</button>
          <button type="button" data-act="pick" class="${BTN}"><i data-lucide="image" class="w-4 h-4"></i>Dalla galleria</button>
          <button type="button" data-act="recrop" class="${BTN} hidden"><i data-lucide="crop" class="w-4 h-4"></i>Ritaglia</button>
          <button type="button" data-act="remove" class="${BTN} hidden text-rose-700"><i data-lucide="trash-2" class="w-4 h-4"></i>Elimina</button>
        </div>
        <p class="text-xs text-graphite-500">Dopo lo scatto la inquadri e la raddrizzi, poi l'app la riduce da sola prima di caricarla. Se cambi l'inquadratura di una foto già usata, controlla la posizione degli articoli.</p>
        <input data-role="cam" type="file" accept="image/*" capture="environment" class="hidden" />
        <input data-role="gal" type="file" accept="image/*" class="hidden" />
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const emptyEl = $('[data-role="empty"]');
  const imgEl = $('[data-role="img"]');
  const infoEl = $('[data-role="info"]');
  const recropBtn = $('[data-act="recrop"]');
  const removeBtn = $('[data-act="remove"]');
  const shootBtn = $('[data-act="shoot"]');
  const pickBtn = $('[data-act="pick"]');

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  const close = () => {
    cleanup();
    closeOverlay(overlay);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.addEventListener('overlay-cancel', cleanup);
  $('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag($('.modal-panel'), close);

  async function refresh() {
    await loadShelfPhotos(true);
    const photo = getShelfPhoto(shelf.nome);
    recropBtn.classList.toggle('hidden', !photo);
    removeBtn.classList.toggle('hidden', !photo);
    emptyEl.classList.toggle('hidden', !!photo);
    imgEl.classList.toggle('hidden', !photo);
    infoEl.classList.toggle('hidden', !photo);
    if (!photo) return;
    const when = photo.updated_at ? new Date(photo.updated_at).toLocaleDateString('it-IT') : '';
    infoEl.textContent = `${photo.width || '?'} × ${photo.height || '?'} px · ${fmtKB(photo.size_bytes)}${when ? ` · ${when}` : ''}`;
    try {
      imgEl.src = await getShelfPhotoUrl(photo.storage_path);
    } catch (err) {
      console.error(err);
      toastError('Impossibile mostrare la foto.');
    }
  }

  const setBusy = (on) => [shootBtn, pickBtn, recropBtn, removeBtn].forEach((b) => (b.disabled = on));

  // Ritaglia/ruota → comprime (dentro il ritaglio) → carica
  async function processAndUpload(source) {
    const result = await openPhotoCropper(source, { title: `Foto · ${shelf.nome}` });
    if (!result) return;
    setBusy(true);
    try {
      const had = !!getShelfPhoto(shelf.nome);
      await uploadShelfPhoto(shelf.nome, result.blob, { width: result.width, height: result.height });
      feedback.confirmAction();
      toastSuccess(`Foto salvata (${fmtKB(result.blob.size)}).`);
      await refresh();
      onChanged?.();
      if (had) toastSuccess('Se hai cambiato inquadratura, controlla la posizione degli articoli.');
    } catch (err) {
      console.error(err);
      feedback.errorAction();
      toastError(err?.message?.includes('row-level security') ? 'Solo l\'Admin può caricare le foto.' : 'Impossibile salvare la foto.');
    } finally {
      setBusy(false);
    }
  }

  for (const sel of ['[data-role="cam"]', '[data-role="gal"]']) {
    $(sel).addEventListener('change', (ev) => {
      const file = ev.target.files?.[0];
      ev.target.value = ''; // permette di riscegliere lo stesso file
      if (file) processAndUpload(file);
    });
  }
  shootBtn.addEventListener('click', () => {
    feedback.tap();
    $('[data-role="cam"]').click();
  });
  pickBtn.addEventListener('click', () => {
    feedback.tap();
    $('[data-role="gal"]').click();
  });
  recropBtn.addEventListener('click', async () => {
    feedback.tap();
    const photo = getShelfPhoto(shelf.nome);
    if (!photo) return;
    setBusy(true);
    try {
      const resp = await fetch(await getShelfPhotoUrl(photo.storage_path));
      if (!resp.ok) throw new Error('download');
      var blob = await resp.blob();
    } catch (err) {
      console.error(err);
      toastError('Impossibile aprire la foto per il ritaglio.');
      setBusy(false);
      return;
    }
    setBusy(false);
    processAndUpload(blob);
  });
  removeBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Eliminare la foto?',
      message: `Verranno tolte la foto di "${shelf.nome}" e le posizioni degli articoli indicate su di essa.`,
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return;
    setButtonBusy(removeBtn, true);
    try {
      await deleteShelfPhoto(shelf.nome);
      feedback.deleteAction();
      toastSuccess('Foto eliminata.');
      await refresh();
      onChanged?.();
    } catch (err) {
      console.error(err);
      feedback.errorAction();
      toastError('Impossibile eliminare la foto.');
    } finally {
      setButtonBusy(removeBtn, false);
    }
  });

  openOverlay(overlay);
  window.lucide?.createIcons();
  refresh();
}
