// =============================================================
// manuals-reorder.js — Modalità riordino delle piastrelle (Admin), con trascinamento
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { closeOverlay, setButtonBusy } from './ui-utils.js';
import { confirmDialog } from './ui-modal.js';
import { deleteManualSection, updateManualSectionsOrder } from './supabase.js';
import { els, ms } from './manuals-shared.js';
import feedback from './feedback.js';
import { pushLayer, releaseLayer } from './nav-history.js';
import { refreshManualsCache } from './manuals.js';
import { renderDetailGrid } from './manuals-detail.js';
import { renderList } from './manuals-list.js';
import { toastError, toastSuccess } from './toast.js';

// ---------------------------------------------------------------- riordino (Admin) --

/** In modalità modifica compare la spunta per salvare e uscire; fuori da essa si entra tenendo premuta un'icona. */
export function updateReorderToggleVisibility(sectionsCount) {
  if (!els.reorderToggle) return;
  els.reorderToggle.classList.toggle('hidden', !ms.reorderMode);
  els.reorderToggle.disabled = ms.reorderSaving;
  els.reorderToggle.innerHTML = `<i data-lucide="${ms.reorderMode ? 'check' : 'move'}" class="w-[18px] h-[18px]" stroke-width="${ms.reorderMode ? '2.4' : '1.8'}"></i>`;
  // bg-graphite-800 / text-graphite-400 vanno TOLTI in modalità modifica: erano in conflitto
  // con bg-amber-400 e la spunta bianca finiva su sfondo bianco (invisibile).
  els.reorderToggle.classList.toggle('bg-graphite-800', !ms.reorderMode);
  els.reorderToggle.classList.toggle('border-graphite-700', !ms.reorderMode);
  els.reorderToggle.classList.toggle('text-graphite-400', !ms.reorderMode);
  els.reorderToggle.classList.toggle('bg-amber-400', ms.reorderMode);
  els.reorderToggle.classList.toggle('border-amber-400', ms.reorderMode);
  els.reorderToggle.classList.toggle('text-white', ms.reorderMode);
  els.detailBack.disabled = ms.reorderSaving;
  els.detailBack.classList.toggle('opacity-40', ms.reorderMode);
  els.detailBack.classList.toggle('pointer-events-none', ms.reorderMode);
  els.reorderHint?.classList.toggle('hidden', !ms.reorderMode);
  window.lucide?.createIcons(); // l'icona è appena stata riscritta: senza questo (es. durante il salvataggio) resterebbe vuota
}

export function toggleReorderMode() {
  if (ms.reorderSaving) return;
  if (ms.reorderMode) exitReorderMode({ save: true });
  else enterReorderMode();
}

export function enterReorderMode() {
  if (ms.reorderMode || ms.reorderSaving) return;
  ms.reorderMode = true;
  if (!ms.reorderLayer) ms.reorderLayer = pushLayer(() => exitReorderMode({ save: true }));
  feedback.modeSelect();
  feedback.longPress();
  renderDetailGrid();
  window.lucide?.createIcons();
}

/** Esce dalla modalità Riordina; se `save` è vero (caso normale: si tocca il segno di spunta,
 *  oppure si torna indietro con un riordino in corso) salva il nuovo ordine letto dal DOM. */
export async function exitReorderMode({ save }) {
  releaseLayer(ms.reorderLayer);
  ms.reorderLayer = null;
  const grid = els.detailGrid;
  if (!save || !grid || !ms.currentMachine) {
    ms.reorderMode = false;
    renderDetailGrid();
    window.lucide?.createIcons();
    return;
  }
  // Durante il salvataggio resta visivamente "in modalità Riordina" (stessa spunta,
  // stesso ordine a schermo) ma bloccata, cosí non si può trascinare di nuovo mentre
  // la richiesta è in volo.
  const orderedIds = Array.from(grid.querySelectorAll('.manual-section-tile[data-section-id]')).map((t) => t.dataset.sectionId);
  ms.reorderSaving = true;
  grid.classList.add('opacity-60', 'pointer-events-none');
  updateReorderToggleVisibility(orderedIds.length);
  try {
    await updateManualSectionsOrder(orderedIds);
    feedback.confirmAction();
    await refreshManualsCache();
    toastSuccess('Ordine dei pulsanti aggiornato.');
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile salvare il nuovo ordine.');
  } finally {
    ms.reorderSaving = false;
    ms.reorderMode = false;
    renderDetailGrid();
    renderList();
    window.lucide?.createIcons();
  }
}

/**
 * Fa scivolare i banner che cambiano posto invece di farli teletrasportare: si misurano le
 * posizioni PRIMA, si esegue la modifica al DOM, poi ogni banner parte dalla vecchia posizione
 * e scorre alla nuova. Si usa la proprietà `translate` (indipendente da `transform`, che il
 * tremolio della modalità modifica usa già). Sicura se richiamata durante uno scorrimento.
 */
const FLIP_MS = 240;
const FLIP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
function flipSiblings(grid, skip, mutate) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sibs = Array.from(grid.children).filter((c) => c !== skip);
  if (reduce || !sibs[0]?.animate) {
    mutate();
    return;
  }
  const before = sibs.map((c) => c.getBoundingClientRect().top); // posizione visiva attuale (anche a metà scorrimento)
  sibs.forEach((c) => c._flip?.cancel());
  mutate();
  sibs.forEach((c, i) => {
    const dy = before[i] - c.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) return;
    c._flip = c.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: FLIP_MS, easing: FLIP_EASE });
    c._flip.onfinish = () => {
      c._flip = null;
    };
  });
}

/**
 * Trascinamento libero di una tile dentro la griglia, via Pointer Events (uniforme
 * dito/mouse): al posto suo resta un segnaposto che segue il punto toccato, così
 * al rilascio l'ordine nel DOM è già quello nuovo — non serve altro calcolo.
 */
export function makeTileDraggable(tile, grid = els.detailGrid) {
  let dragging = false;
  let placeholder = null;
  let offsetX = 0;
  let offsetY = 0;
  let pointerId = null;
  let originX = 0;
  let originY = 0;

  const start = (e) => {
    if (dragging || e.button > 0) return;
    if (e.target.closest?.('[data-edit-btn]')) return; // la matita non avvia il trascinamento
    dragging = true;
    pointerId = e.pointerId;
    try {
      tile.setPointerCapture(pointerId);
    } catch (err) {
      /* puntatore non più attivo: si prosegue senza cattura */
    }
    const rect = tile.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    placeholder = document.createElement('div');
    placeholder.className = 'manual-section-tile reorder-placeholder';
    placeholder.style.height = `${rect.height}px`;
    tile.after(placeholder);
    tile.style.animation = 'none';
    tile.style.position = 'fixed';
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.style.left = '0px';
    tile.style.top = '0px';
    tile.style.zIndex = '60';
    // Se un antenato ha transform (il pannello scorrevole), position:fixed si ancora
    // a lui e non alla finestra: si misura l'origine reale e la si sottrae.
    const origin = tile.getBoundingClientRect();
    originX = origin.left;
    originY = origin.top;
    tile.style.left = `${rect.left - originX}px`;
    tile.style.top = `${rect.top - originY}px`;
    tile.classList.add('reorder-dragging');
    feedback.dragStart();
  };

  const move = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    tile.style.left = `${e.clientX - offsetX - originX}px`;
    tile.style.top = `${e.clientY - offsetY - originY}px`;
    tile.style.visibility = 'hidden';
    const below = document.elementFromPoint(e.clientX, e.clientY);
    tile.style.visibility = '';
    const overTile = below?.closest('.manual-section-tile');
    if (overTile && overTile !== placeholder && overTile.parentElement === grid && overTile !== tile) {
      const rect = overTile.getBoundingClientRect();
      const isAfter = e.clientY > rect.top + rect.height / 2; // elenco in colonna: conta solo l'altezza
      const ref = isAfter ? overTile.nextSibling : overTile;
      if (ref !== placeholder && placeholder.nextSibling !== ref) {
        flipSiblings(grid, tile, () => grid.insertBefore(placeholder, ref));
        feedback.dragSwap();
      }
    }
  };

  const end = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try {
      tile.releasePointerCapture(pointerId);
    } catch (err) {
      /* già rilasciato */
    }
    const dropRect = tile.getBoundingClientRect(); // dove si trova ora, sotto il dito
    placeholder?.replaceWith(tile);
    placeholder = null;
    tile.classList.remove('reorder-dragging');
    feedback.dragDrop();
    tile.style.animation = '';
    tile.style.position = '';
    tile.style.width = '';
    tile.style.height = '';
    tile.style.left = '';
    tile.style.top = '';
    tile.style.zIndex = '';
    // Rilascio: dal punto in cui è stato lasciato il banner scivola nel suo posto (niente scatto).
    const slot = tile.getBoundingClientRect();
    const dx = dropRect.left - slot.left;
    const dy = dropRect.top - slot.top;
    if (tile.animate && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      tile.animate(
        [
          { translate: `${dx}px ${dy}px`, scale: '1.05' },
          { translate: '0 0', scale: '1' },
        ],
        { duration: FLIP_MS, easing: FLIP_EASE }
      );
    }
  };

  tile.addEventListener('pointerdown', start);
  tile.addEventListener('pointermove', move);
  tile.addEventListener('pointerup', end);
  tile.addEventListener('pointercancel', end);
}

export async function handleDeleteFromModal() {
  if (!ms.editingSection) return;
  const ok = await confirmDialog({
    title: 'Eliminare il pulsante?',
    message: `Il pulsante "${ms.editingSection.label}" verrà eliminato. L'operazione non si può annullare.`,
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  setButtonBusy(els.deleteBtn, true);
  try {
    await deleteManualSection(ms.editingSection);
    feedback.deleteAction();
    toastSuccess(`Pulsante "${ms.editingSection.label}" eliminato.`);
    closeOverlay(els.modal);
    await refreshManualsCache();
    renderDetailGrid();
    renderList();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile eliminare il pulsante.');
  } finally {
    setButtonBusy(els.deleteBtn, false);
  }
}
