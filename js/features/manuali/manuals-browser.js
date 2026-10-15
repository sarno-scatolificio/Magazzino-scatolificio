// =============================================================
// manuals-browser.js — Vista "Manuali" (barra in basso, visibile a tutti:
// Admin e Operatore). Due pannelli:
//  1) elenco macchine, righe semplici (non espandibili) — toccarne una apre
//  2) il dettaglio: un indice a griglia (3 per riga) di pulsanti personalizzati
//     ("Mettifoglio", "Squadratura"…) definiti dall'Admin, ognuno legato a un
//     intervallo di pagine di un manuale operatore; toccandolo si apre il PDF
//     già scorso a quella pagina. In basso il pulsante "Spare parts" apre il
//     manuale ricambi della macchina (quello cercabile per codice articolo).
//     L'Admin trova qui anche il pulsante "+" per aggiungerne di nuovi.
// =============================================================
// Questo file tiene l'avvio e l'ingresso/uscita dalla vista; il resto è diviso in manuals-shared / -list /
// -icon / -detail / -groups / -spare / -reorder / -section-modal.

import { applyWholeDocumentToggle, handleCreateSection } from './manuals-section-modal.js';
import { closeMachineDetail } from './manuals-detail.js';
import { closeOverlay, enableSheetDrag } from '../../shared/ui-utils.js';
import { els, ms } from './manuals-shared.js';
import { exitListReorderMode, renderList, sortMachinesForList } from './manuals-list.js';
import { handleDeleteFromModal, toggleReorderMode } from './manuals-reorder.js';
import { handleGroupDelete, handleGroupSubmit, moveGroup, onGroupsBarClick } from './manuals-groups.js';
import { handleMachineIconSubmit, onMachineIconClean, onMachineIconPicked, onMachineIconRemove } from './manuals-icon.js';
import { listMachinesWithCounts } from '../../data/supabase.js';
import { refreshManualsCache } from './manuals.js';
import { releaseLayer } from '../../core/nav-history.js';
import { toastError, toastWarning } from '../../shared/toast.js';

export function initManualsBrowser() {
  els.skeleton = document.getElementById('manuals-browser-skeleton');
  els.list = document.getElementById('manuals-browser-list');
  els.empty = document.getElementById('manuals-browser-empty');

  els.view = document.getElementById('view-manuals');
  els.listReorderBar = document.getElementById('manuals-list-reorder-bar');
  els.listReorderDone = document.getElementById('manuals-list-reorder-done');
  els.machineIconModal = document.getElementById('manual-machine-icon-modal');
  els.machineIconTitle = document.getElementById('manual-machine-icon-title');
  els.machineIconClose = document.getElementById('manual-machine-icon-close');
  els.machineIconForm = document.getElementById('manual-machine-icon-form');
  els.machineIconInput = document.getElementById('manual-machine-icon-input');
  els.machineIconPreview = document.getElementById('manual-machine-icon-preview');
  els.machineIconPlaceholder = document.getElementById('manual-machine-icon-placeholder');
  els.machineIconSubmit = document.getElementById('manual-machine-icon-submit');
  els.machineIconRemove = document.getElementById('manual-machine-icon-remove');
  els.machineIconClean = document.getElementById('manual-machine-icon-clean');
  els.listPanel = document.getElementById('manuals-list-panel');
  els.detailPanel = document.getElementById('manuals-detail-panel');
  els.detailBack = document.getElementById('manuals-detail-back');
  els.detailIconWrap = document.getElementById('manuals-detail-icon-wrap');
  els.detailBanner = document.getElementById('manuals-detail-banner');
  els.detailBannerImg = document.getElementById('manuals-detail-banner-img');
  els.detailTitle = document.getElementById('manuals-detail-title');
  els.detailSubtitle = document.getElementById('manuals-detail-subtitle');
  els.detailGrid = document.getElementById('manuals-detail-grid');
  els.detailEmpty = document.getElementById('manuals-detail-empty');
  els.spareWrap = document.getElementById('manuals-detail-spare-parts-wrap');
  els.reorderToggle = document.getElementById('manuals-detail-reorder-toggle');
  els.reorderHint = document.getElementById('manuals-reorder-hint');

  els.modal = document.getElementById('manual-section-modal');
  els.modalTitle = document.getElementById('manual-section-modal-title');
  els.modalClose = document.getElementById('manual-section-modal-close');
  els.form = document.getElementById('manual-section-form');
  els.noManualNotice = document.getElementById('manual-section-no-manual-notice');
  els.labelInput = document.getElementById('manual-section-label');
  els.manualSelect = document.getElementById('manual-section-manual');
  els.pageStartInput = document.getElementById('manual-section-page-start');
  els.pageEndInput = document.getElementById('manual-section-page-end');
  els.wholeCheckbox = document.getElementById('manual-section-whole');
  els.pagesRow = document.getElementById('manual-section-pages-row');
  els.iconInput = document.getElementById('manual-section-icon');
  els.iconPreview = document.getElementById('manual-section-icon-preview');
  els.iconPlaceholder = document.getElementById('manual-section-icon-placeholder');
  els.submitBtn = document.getElementById('manual-section-submit');
  els.deleteBtn = document.getElementById('manual-section-delete');
  els.groupsBar = document.getElementById('manuals-groups-bar');
  els.groupWrap = document.getElementById('manual-section-group-wrap');
  els.groupSelect = document.getElementById('manual-section-group');
  els.groupModal = document.getElementById('manual-group-modal');
  els.groupModalTitle = document.getElementById('manual-group-modal-title');
  els.groupModalClose = document.getElementById('manual-group-modal-close');
  els.groupForm = document.getElementById('manual-group-form');
  els.groupName = document.getElementById('manual-group-name');
  els.groupMoveRow = document.getElementById('manual-group-move-row');
  els.groupLeft = document.getElementById('manual-group-left');
  els.groupRight = document.getElementById('manual-group-right');
  els.groupSubmit = document.getElementById('manual-group-submit');
  els.groupDelete = document.getElementById('manual-group-delete');

  if (!els.list) return; // markup non presente (non dovrebbe succedere)

  els.detailBack?.addEventListener('click', closeMachineDetail);

  els.reorderToggle?.addEventListener('click', toggleReorderMode);

  els.listReorderDone?.addEventListener('click', () => {
    if (!ms.listReorderSaving) exitListReorderMode({ save: true });
  });
  els.machineIconClose?.addEventListener('click', () => closeOverlay(els.machineIconModal));
  els.machineIconModal?.addEventListener('click', (e) => {
    if (e.target === els.machineIconModal) closeOverlay(els.machineIconModal);
  });
  if (els.machineIconModal) enableSheetDrag(els.machineIconModal.querySelector('.modal-panel'), () => closeOverlay(els.machineIconModal));
  els.machineIconInput?.addEventListener('change', onMachineIconPicked);
  els.machineIconRemove?.addEventListener('click', onMachineIconRemove);
  els.machineIconClean?.addEventListener('click', onMachineIconClean);
  els.machineIconForm?.addEventListener('submit', handleMachineIconSubmit);

  els.groupsBar?.addEventListener('click', onGroupsBarClick);
  els.groupModalClose?.addEventListener('click', () => closeOverlay(els.groupModal));
  els.groupModal?.addEventListener('click', (e) => {
    if (e.target === els.groupModal) closeOverlay(els.groupModal);
  });
  if (els.groupModal) enableSheetDrag(els.groupModal.querySelector('.modal-panel'), () => closeOverlay(els.groupModal));
  els.groupForm?.addEventListener('submit', handleGroupSubmit);
  els.groupDelete?.addEventListener('click', handleGroupDelete);
  els.groupLeft?.addEventListener('click', () => moveGroup(-1));
  els.groupRight?.addEventListener('click', () => moveGroup(1));

  els.modalClose?.addEventListener('click', () => closeOverlay(els.modal));
  els.modal?.addEventListener('click', (e) => {
    if (e.target === els.modal) closeOverlay(els.modal);
  });
  if (els.modal) enableSheetDrag(els.modal.querySelector('.modal-panel'), () => closeOverlay(els.modal));

  els.iconInput?.addEventListener('change', () => {
    let file = els.iconInput.files?.[0] || null;
    // Il selettore non filtra per tipo (cosi' Android apre l'archivio file del telefono,
    // non solo la galleria): controllo qui che sia davvero un'immagine.
    if (file && !(file.type || '').startsWith('image/') && !/\.(png|jpe?g|webp|gif|svg|bmp|avif|heic|heif)$/i.test(file.name || '')) {
      toastWarning('Seleziona un file immagine (PNG, JPG, WEBP, SVG...)');
      els.iconInput.value = '';
      file = null;
    }
    ms.pendingIconFile = file;
    if (file) {
      els.iconPreview.src = URL.createObjectURL(file);
      els.iconPreview.classList.remove('hidden');
      els.iconPlaceholder.classList.add('hidden');
    } else {
      els.iconPreview.classList.add('hidden');
      els.iconPlaceholder.classList.remove('hidden');
    }
  });

  els.form?.addEventListener('submit', handleCreateSection);
  els.wholeCheckbox?.addEventListener('change', applyWholeDocumentToggle);
  els.deleteBtn?.addEventListener('click', handleDeleteFromModal);
}

/** Richiamata da app.js ogni volta che si entra nella vista Manuali. */
export async function enterManualsBrowser() {
  if (!els.list) return;
  closeMachineDetail({ immediate: true });
  if (ms.listReorderMode) {
    // Si rientra nella vista con la modifica dell'elenco rimasta aperta: si chiude senza salvare.
    releaseLayer(ms.listReorderLayer);
    ms.listReorderLayer = null;
    ms.listReorderMode = false;
  }
  if (!ms.loaded) {
    els.skeleton?.classList.remove('hidden');
    els.list.classList.add('hidden');
    els.empty?.classList.add('hidden');
  }
  try {
    const [{ machines }] = await Promise.all([listMachinesWithCounts(), refreshManualsCache()]);
    ms.cachedMachines = sortMachinesForList(machines.filter((m) => m.id)); // solo le macchine registrate possono avere un manuale collegato
    renderList();
    ms.loaded = true;
  } catch (err) {
    console.error(err);
    toastError('Impossibile caricare l\'elenco delle macchine.');
  } finally {
    els.skeleton?.classList.add('hidden');
  }
}

/** Si richiama al logout, così il prossimo accesso (magari di un altro utente) ricarica da capo. */
export function resetManualsBrowser() {
  ms.loaded = false;
  ms.cachedMachines = [];
  ms.currentMachine = null;
  ms.reorderMode = false;
  ms.reorderSaving = false;
  ms.listReorderMode = false;
  ms.listReorderSaving = false;
  ms.listReorderLayer = null;
  els.view?.classList.remove('manuals-list-editing');
  ms.detailLayer = null; // (le voci di cronologia le azzera resetLayers al logout)
  ms.reorderLayer = null;
  document.body.classList.remove('manuals-detail-active');
}
