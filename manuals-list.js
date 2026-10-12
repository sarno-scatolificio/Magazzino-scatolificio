// =============================================================
// manuals-list.js — Elenco macchine e modalità modifica dell'elenco (Admin)
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { attachLongPress, els, ms } from './manuals-shared.js';
import { escapeHtml } from './html-utils.js';
import feedback from './feedback.js';
import { getOperatorManualsForMachine, getSectionsForOperatorManual } from './manuals.js';
import { getSectionIconUrl, updateMachinesOrder } from './supabase.js';
import { isAdmin } from './auth.js';
import { makeTileDraggable } from './manuals-reorder.js';
import { openMachineDetail } from './manuals-detail.js';
import { openMachineIconModal } from './manuals-icon.js';
import { pushLayer, releaseLayer } from './nav-history.js';
import { staggerIndex } from './ui-utils.js';
import { toastError, toastSuccess } from './toast.js';

// ---------------------------------------------------------------- elenco --

function sectionsCountForMachine(machine) {
  return getOperatorManualsForMachine(machine.id).reduce((sum, m) => sum + getSectionsForOperatorManual(m.id).length, 0);
}

/** Ordine dell'elenco: prima quelle riordinate dall'admin (sort_order), poi le altre in ordine alfabetico. */
export function sortMachinesForList(list) {
  return list.slice().sort((a, b) => {
    const sa = a.sort_order ?? Infinity;
    const sb = b.sort_order ?? Infinity;
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'it');
  });
}

export function machineIconUrl(machine) {
  return machine.icon_storage_path ? getSectionIconUrl(machine.icon_storage_path) : null;
}

/** Contenuto del riquadro icona di una macchina: l'immagine scelta dall'admin oppure l'ingranaggio. */
function machineIconHtml(machine, size = 22) {
  const url = machineIconUrl(machine);
  return url
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" class="w-full h-full object-contain">`
    : `<i data-lucide="cog" class="w-[${size}px] h-[${size}px] text-graphite-400" stroke-width="1.8"></i>`;
}

function updateListReorderBar() {
  els.listReorderBar?.classList.toggle('hidden', !ms.listReorderMode);
  if (els.listReorderDone) els.listReorderDone.disabled = ms.listReorderSaving;
}

export function renderList() {
  els.list.innerHTML = '';
  els.list.classList.toggle('reorder-mode', ms.listReorderMode);
  els.view?.classList.toggle('manuals-list-editing', ms.listReorderMode);
  els.list.classList.toggle('opacity-60', ms.listReorderSaving);
  els.list.classList.toggle('pointer-events-none', ms.listReorderSaving);
  updateListReorderBar();
  if (ms.cachedMachines.length === 0) {
    els.list.classList.add('hidden');
    els.empty?.classList.remove('hidden');
    return;
  }
  els.empty?.classList.add('hidden');

  ms.cachedMachines.forEach((machine, i) => {
    const hasOperatorManual = getOperatorManualsForMachine(machine.id).length > 0;
    const count = sectionsCountForMachine(machine);
    const meta = !hasOperatorManual
      ? 'nessun manuale operatore'
      : count === 0
        ? 'nessuna sezione creata'
        : `${count} ${count === 1 ? 'sezione' : 'sezioni'}`;

    // Riquadro rettangolare: i disegni delle macchine sono larghi, in un quadrato restavano minuscoli.
    const iconBox = `<span class="shrink-0 w-24 h-16 rounded-lg bg-graphite-700/50 flex items-center justify-center overflow-hidden">${machineIconHtml(machine)}</span>`;
    const label = `
        <span class="min-w-0 text-left">
          <span class="block font-display font-bold uppercase tracking-wide truncate">${escapeHtml(machine.nome)}</span>
          <span class="block ui-note text-graphite-500 mt-0.5">${meta}</span>
        </span>`;

    if (ms.listReorderMode) {
      // Modalità modifica: la riga vibra, si trascina, e la matita apre la modale dell'icona.
      const row = document.createElement('div');
      row.dataset.machineId = machine.id;
      row.className = 'manual-section-tile press-spring w-full flex items-center gap-3 pl-4 pr-14 py-3 card-plate rounded-xl';
      row.innerHTML = `${iconBox}${label}`;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.dataset.editBtn = '1';
      editBtn.className = 'reorder-handle';
      editBtn.setAttribute('aria-label', `Modifica l'icona di ${machine.nome}`);
      editBtn.innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5" stroke-width="2.4"></i>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMachineIconModal(machine);
      });
      row.appendChild(editBtn);
      makeTileDraggable(row, els.list);
      els.list.appendChild(row);
      return;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'list-item-in press-spring w-full flex items-center justify-between gap-3 px-4 py-3 card-plate rounded-xl';
    row.style.setProperty('--i', staggerIndex(i));
    row.innerHTML = `
      <span class="flex items-center gap-3 min-w-0">
        ${iconBox}${label}
      </span>
      <i data-lucide="chevron-right" class="w-5 h-5 text-graphite-400 shrink-0"></i>
    `;
    // Admin: tenendo premuto su una macchina si entra in modalità modifica (riordino e icone).
    if (isAdmin()) attachLongPress(row, () => enterListReorderMode());
    row.addEventListener('click', () => openMachineDetail(machine));
    els.list.appendChild(row);
  });

  els.list.classList.remove('hidden');
  window.lucide?.createIcons();
}

// ---------------------------------------------------------------- modifica elenco macchine (Admin) --

function enterListReorderMode() {
  if (ms.listReorderMode || ms.listReorderSaving || !isAdmin()) return;
  ms.listReorderMode = true;
  if (!ms.listReorderLayer) ms.listReorderLayer = pushLayer(() => exitListReorderMode({ save: true }));
  feedback.modeSelect();
  feedback.longPress();
  renderList();
}

/** Esce dalla modifica dell'elenco; con `save` salva il nuovo ordine letto dal DOM (se è cambiato). */
export async function exitListReorderMode({ save }) {
  if (!ms.listReorderMode) return;
  releaseLayer(ms.listReorderLayer);
  ms.listReorderLayer = null;
  const ids = Array.from(els.list.querySelectorAll('[data-machine-id]')).map((t) => t.dataset.machineId);
  const changed = save && ids.length > 0 && ids.join() !== ms.cachedMachines.map((m) => m.id).join();
  if (!changed) {
    ms.listReorderMode = false;
    renderList();
    window.lucide?.createIcons();
    return;
  }
  // Durante il salvataggio resta in modalità modifica ma bloccata, come nel dettaglio.
  ms.listReorderSaving = true;
  els.list.classList.add('opacity-60', 'pointer-events-none');
  updateListReorderBar();
  try {
    await updateMachinesOrder(ids);
    ms.cachedMachines.forEach((m) => {
      m.sort_order = ids.indexOf(m.id);
    });
    ms.cachedMachines = sortMachinesForList(ms.cachedMachines);
    feedback.confirmAction();
    toastSuccess('Ordine delle macchine aggiornato.');
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile salvare il nuovo ordine.');
  } finally {
    ms.listReorderSaving = false;
    ms.listReorderMode = false;
    renderList();
    window.lucide?.createIcons();
  }
}
