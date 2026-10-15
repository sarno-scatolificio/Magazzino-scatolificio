// =============================================================
// manuals-detail.js — Dettaglio macchina: griglia delle piastrelle
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { attachLongPress, els, ms } from './manuals-shared.js';
import { buildGroupBar, computeGroupView } from './manuals-groups.js';
import { enterReorderMode, exitReorderMode, makeTileDraggable, updateReorderToggleVisibility } from './manuals-reorder.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { getOperatorManualsForMachine, getSectionsForOperatorManual } from './manuals.js';
import { openManualExternal } from './manuals-external.js';
import { getSectionIconUrl } from '../../data/supabase.js';
import { isAdmin } from '../../core/auth.js';
import { machineIconUrl } from './manuals-list.js';
import { openSectionModal } from './manuals-section-modal.js';
import { pushLayer, releaseLayer } from '../../core/nav-history.js';
import { renderSpareButtons } from './manuals-spare.js';
import { staggerIndex } from '../../shared/ui-utils.js';

// ---------------------------------------------------------------- dettaglio --

export function openMachineDetail(machine) {
  ms.currentMachine = machine;
  ms.reorderMode = false;
  els.detailTitle.textContent = machine.nome;
  // Con un'immagine caricata: banner a tutta larghezza in cima e niente quadratino; altrimenti l'ingranaggio di sempre.
  const detailIconUrl = machineIconUrl(machine);
  if (els.detailBanner && els.detailBannerImg) {
    els.detailBanner.classList.toggle('hidden', !detailIconUrl);
    if (detailIconUrl) els.detailBannerImg.src = detailIconUrl;
    else els.detailBannerImg.removeAttribute('src');
  }
  if (els.detailIconWrap) {
    els.detailIconWrap.classList.toggle('hidden', !!detailIconUrl);
    els.detailIconWrap.innerHTML = '<i data-lucide="cog" class="w-5 h-5 text-amber-300" stroke-width="1.8"></i>';
  }
  renderDetailGrid({ opening: true });
  renderSpareButtons(machine);
  ms.listScrollY = window.scrollY;
  els.view?.classList.add('manuals-detail-open');
  window.scrollTo(0, 0); // il dettaglio è una schermata nuova: parte dall'alto
  if (!ms.detailLayer) ms.detailLayer = pushLayer(() => closeMachineDetail());
  document.body.classList.add('manuals-detail-active');
  window.lucide?.createIcons();
}

export function closeMachineDetail({ immediate = false } = {}) {
  if (ms.reorderMode) exitReorderMode({ save: true });
  releaseLayer(ms.detailLayer);
  ms.detailLayer = null;
  document.body.classList.remove('manuals-detail-active');
  const wasOpen = els.view?.classList.contains('manuals-detail-open');
  if (immediate && els.view) {
    els.view.classList.add('manuals-reset-instant');
    els.view.classList.remove('manuals-detail-open');
    void els.view.offsetWidth; // forza il reflow: applica il reset prima di riabilitare le transizioni
    els.view.classList.remove('manuals-reset-instant');
    ms.currentMachine = null;
  } else {
    els.view?.classList.remove('manuals-detail-open');
    // Si rivede l'elenco esattamente dov'era stato lasciato
    if (wasOpen) window.scrollTo(0, ms.listScrollY);
  }
}

export function renderDetailGrid({ keepBar = false, opening = false } = {}) {
  if (!ms.currentMachine) return;
  const machine = ms.currentMachine;
  const operatorManuals = getOperatorManualsForMachine(machine.id);
  const sections = [];
  operatorManuals.forEach((manual) => {
    getSectionsForOperatorManual(manual.id).forEach((section) => sections.push({ section, manual }));
  });
  // L'ordine salvato (sort_order) vale per TUTTA la macchina, non per singolo manuale:
  // senza questo, le piastrelle restavano raggruppate per manuale e un riordino che le
  // mescolava tra manuali diversi "tornava indietro" alla riapertura. Sort stabile:
  // a parità di valore resta l'ordine di raggruppamento precedente.
  sections.sort((x, y) => (x.section.sort_order ?? 0) - (y.section.sort_order ?? 0));

  // Gruppi (macrogruppi): se la macchina ne ha, si mostra un tab per gruppo e solo le
  // piastrelle del tab aperto; senza gruppi tutto resta come prima.
  const view = computeGroupView(machine, sections);
  const allSections = sections;
  const visibleSections = view.visible;
  ms.lastRenderedIds = visibleSections.map((x) => x.section.id);
  buildGroupBar(view, keepBar);

  els.detailGrid.innerHTML = '';
  // Il ritardo extra (attesa che il pannello finisca di scorrere) vale solo all'apertura del
  // dettaglio: cambiando gruppo i banner devono comparire subito.
  els.detailGrid.classList.toggle('grid-opening', opening);
  els.detailGrid.classList.toggle('reorder-mode', ms.reorderMode);
  // innerHTML='' svuota i figli ma non le classi dell'elenco stesso: quelle di
  // blocco visivo durante il salvataggio vanno quindi ripulite esplicitamente,
  // altrimenti resterebbero appiccicate anche a riordino ormai concluso.
  els.detailGrid.classList.toggle('opacity-60', ms.reorderSaving);
  els.detailGrid.classList.toggle('pointer-events-none', ms.reorderSaving);

  visibleSections.forEach(({ section, manual }, i) => {
    const tile = document.createElement(ms.reorderMode ? 'div' : 'button');
    if (!ms.reorderMode) tile.type = 'button';
    tile.dataset.sectionId = section.id;
    tile.className = `manual-section-tile manual-section-tile--banner${ms.reorderMode ? '' : ' list-item-in'} press-spring card-plate rounded-xl flex items-center gap-3 px-4 py-3 w-full text-left border-2 border-graphite-700`;
    tile.style.setProperty('--i', staggerIndex(i));
    const iconUrl = section.icon_storage_path ? getSectionIconUrl(section.icon_storage_path) : null;
    // Banner come gli scaffali del Magazzino: icona a sinistra, dettaglio (nome della sezione) a destra.
    tile.innerHTML = `
      <span class="manual-section-banner-ico bg-graphite-700/50${iconUrl ? '' : ' manual-section-banner-ico--fallback'} shrink-0 flex items-center justify-center">
        ${
          iconUrl
            ? `<img src="${escapeHtml(iconUrl)}" alt="" class="w-full h-full object-contain">`
            : '<i data-lucide="book-open" class="w-full h-full text-graphite-400" stroke-width="1.8"></i>'
        }
      </span>
      <span class="manual-section-banner-label min-w-0 flex-1 font-display font-bold uppercase tracking-wide" title="${escapeHtml(section.label)}">${escapeHtml(section.label)}</span>
    `;
    if (ms.reorderMode) {
      // Modalità modifica: la tile vibra, si trascina, e la matita apre la modale di questa stessa icona.
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.dataset.editBtn = '1';
      editBtn.className = 'reorder-handle';
      editBtn.setAttribute('aria-label', `Modifica ${section.label}`);
      editBtn.innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5" stroke-width="2.4"></i>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSectionModal(machine, section);
      });
      tile.appendChild(editBtn);
      makeTileDraggable(tile);
    } else {
      // Admin: tenendo premuto sull'icona si entra in modalità modifica.
      if (isAdmin()) attachLongPress(tile, () => enterReorderMode());
      tile.addEventListener('click', () => openManualExternal(manual, { startPage: section.page_start, endPage: section.page_end, title: section.label }));
    }
    els.detailGrid.appendChild(tile);
  });

  if (isAdmin() && !ms.reorderMode) {
    const addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.setAttribute('aria-label', `Aggiungi pulsante per ${machine.nome}`);
    addTile.className = 'manual-section-tile manual-section-tile--banner list-item-in press-spring card-plate rounded-xl flex items-center gap-3 px-4 py-3 w-full text-left border-2 border-dashed border-amber-400 text-amber-400 hover:text-amber-300 hover:border-amber-300 transition-colors';
    addTile.style.setProperty('--i', staggerIndex(visibleSections.length));
    addTile.innerHTML = `
      <span class="manual-section-banner-ico bg-graphite-700/50 shrink-0 flex items-center justify-center"><i data-lucide="plus" class="w-6 h-6" stroke-width="1.8"></i></span>
      <span class="manual-section-banner-label min-w-0 flex-1 font-display font-bold uppercase tracking-wide">Aggiungi</span>
    `;
    addTile.addEventListener('click', () => openSectionModal(machine));
    els.detailGrid.appendChild(addTile);
  }

  const isEmpty = visibleSections.length === 0 && !isAdmin();
  els.detailGrid.classList.toggle('hidden', isEmpty);
  els.detailEmpty?.classList.toggle('hidden', !isEmpty);
  if (els.detailSubtitle) {
    els.detailSubtitle.textContent =
      allSections.length === 0
        ? isAdmin()
          ? 'Nessun pulsante ancora: tocca Aggiungi per crearne uno'
          : 'Nessun pulsante ancora disponibile'
        : `${allSections.length} ${allSections.length === 1 ? 'pulsante disponibile' : 'pulsanti disponibili'}`;
  }

  updateReorderToggleVisibility(allSections.length);
  window.lucide?.createIcons();
}
