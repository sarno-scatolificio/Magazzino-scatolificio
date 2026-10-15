// =============================================================
// manuals-groups.js — Gruppi di piastrelle (tab) e relativa modale
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { GROUP_TAB_STORAGE_KEY, NO_GROUP, activeGroupByMachine, els, ms } from './manuals-shared.js';
import { closeOverlay, openOverlay, setButtonBusy, syncSegIndicator } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import { createManualGroup, deleteManualGroup, updateManualGroup, updateManualGroupsOrder, updateManualSectionsOrder } from '../../data/supabase.js';
import { escapeHtml } from '../../shared/html-utils.js';
import feedback from '../../shared/feedback.js';
import { getGroupsForMachine, refreshManualsCache } from './manuals.js';
import { isAdmin } from '../../core/auth.js';
import { renderDetailGrid } from './manuals-detail.js';
import { toastError, toastSuccess, toastWarning } from '../../shared/toast.js';

// ------------------------------------------------------------ Gruppi di piastrelle --

export function getActiveGroupKey(machineId) {
  if (activeGroupByMachine.has(machineId)) return activeGroupByMachine.get(machineId);
  try {
    return localStorage.getItem(GROUP_TAB_STORAGE_KEY + machineId) || null;
  } catch (err) {
    return null;
  }
}

function setActiveGroupKey(machineId, key) {
  activeGroupByMachine.set(machineId, key);
  try {
    localStorage.setItem(GROUP_TAB_STORAGE_KEY + machineId, key);
  } catch (err) {
    /* memoria locale non disponibile: il tab resta ricordato solo finché l'app è aperta */
  }
}

/** Calcola i tab da mostrare e le piastrelle del tab aperto. Senza gruppi: nessun tab, tutte le piastrelle. */
export function computeGroupView(machine, all) {
  const groups = getGroupsForMachine(machine.id);
  if (!groups.length) return { tabs: [], activeKey: null, visible: all };
  const ids = new Set(groups.map((g) => g.id));
  const ungrouped = all.filter((x) => !x.section.group_id || !ids.has(x.section.group_id));
  // Chi non è admin non vede i gruppi vuoti
  const tabs = groups
    .filter((g) => isAdmin() || all.some((x) => x.section.group_id === g.id))
    .map((g) => ({ key: g.id, label: g.name, group: g }));
  if (ungrouped.length) tabs.push({ key: NO_GROUP, label: 'Altro', group: null });
  let key = getActiveGroupKey(machine.id);
  if (!tabs.some((t) => t.key === key)) key = tabs[0]?.key ?? NO_GROUP;
  activeGroupByMachine.set(machine.id, key);
  const visible = key === NO_GROUP ? ungrouped : all.filter((x) => x.section.group_id === key);
  return { tabs, activeKey: key, visible };
}

/** Disegna la barra dei tab (stesso controllo segmentato del Magazzino, scorrevole in orizzontale). */
export function buildGroupBar(view, keepBar) {
  const bar = els.groupsBar;
  if (!bar) return;
  const edit = isAdmin() && ms.reorderMode;
  const show = view.tabs.length > 0 || edit;
  bar.classList.toggle('hidden', !show);
  if (!show) {
    bar.innerHTML = '';
    return;
  }
  if (keepBar && bar.querySelector('.seg')) {
    // Cambio di tab: si aggiorna solo l'evidenziazione, così il rettangolo scorre
    bar.querySelectorAll('[data-group-key]').forEach((btn) => btn.classList.toggle('category-tab-active', btn.dataset.groupKey === view.activeKey));
    placeGroupIndicator(bar);
    return;
  }
  const tabsHtml = view.tabs
    .map((t) => {
      const pencil =
        edit && t.group
          ? `<span class="group-tab-edit" data-group-edit="${escapeHtml(t.group.id)}" role="button" aria-label="Modifica gruppo ${escapeHtml(t.label)}"><i data-lucide="pencil" class="w-3 h-3" stroke-width="2.4"></i></span>`
          : '';
      return `<button type="button" role="tab" data-group-key="${escapeHtml(t.key)}" class="category-tab${t.key === view.activeKey ? ' category-tab-active' : ''} rounded-md min-h-[44px] px-3.5 py-1.5 flex items-center justify-center text-xs font-display font-semibold uppercase tracking-wide">${escapeHtml(t.label)}${pencil}</button>`;
    })
    .join('');
  const addBtn = edit
    ? '<button type="button" data-group-add="1" aria-label="Nuovo gruppo" class="press-spring shrink-0 w-11 rounded-lg border-2 border-dashed border-amber-400 text-amber-400 hover:text-amber-300 hover:border-amber-300 flex items-center justify-center"><i data-lucide="plus" class="w-5 h-5" stroke-width="2"></i></button>'
    : '';
  const main = view.tabs.length
    ? `<div class="seg manuals-seg flex flex-1 min-w-0 rounded-lg border border-graphite-700 bg-graphite-800 p-0.5" role="tablist"><span class="seg-indicator" aria-hidden="true"></span>${tabsHtml}</div>`
    : '<p class="flex-1 self-center ui-note text-graphite-500">Nessun gruppo: tocca + per crearne uno</p>';
  bar.innerHTML = `<div class="flex items-stretch gap-2">${main}${addBtn}</div>`;
  window.lucide?.createIcons();
  placeGroupIndicator(bar);
}

function placeGroupIndicator(bar) {
  const seg = bar.querySelector('.seg');
  if (!seg) return;
  syncSegIndicator(seg);
  const active = seg.querySelector('.category-tab-active');
  if (active) {
    // porta il tab attivo al centro della barra, se questa scorre
    seg.scrollTo({ left: Math.max(0, active.offsetLeft - (seg.clientWidth - active.offsetWidth) / 2), behavior: 'smooth' });
  }
}

/**
 * In modalità modifica, salva l'ordine delle piastrelle del tab aperto se è stato cambiato,
 * prima di un'operazione che ridisegna la griglia (cambio tab, gruppi): altrimenti andrebbe perso.
 * Restituisce false se il salvataggio fallisce (l'operazione va annullata).
 */
async function persistVisibleOrder() {
  if (!ms.reorderMode || !els.detailGrid) return true;
  const ids = Array.from(els.detailGrid.querySelectorAll('.manual-section-tile[data-section-id]')).map((t) => t.dataset.sectionId);
  if (ids.length < 2 || ids.join() === ms.lastRenderedIds.join()) return true;
  try {
    await updateManualSectionsOrder(ids);
    await refreshManualsCache();
    return true;
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile salvare il nuovo ordine.');
    return false;
  }
}

export async function onGroupsBarClick(e) {
  if (!ms.currentMachine || ms.reorderSaving) return;
  const editEl = e.target.closest('[data-group-edit]');
  if (editEl) {
    e.stopPropagation();
    const group = getGroupsForMachine(ms.currentMachine.id).find((g) => g.id === editEl.dataset.groupEdit);
    if (group) openGroupModal(ms.currentMachine, group);
    return;
  }
  if (e.target.closest('[data-group-add]')) {
    openGroupModal(ms.currentMachine);
    return;
  }
  const tab = e.target.closest('[data-group-key]');
  if (!tab) return;
  const key = tab.dataset.groupKey;
  if (key === getActiveGroupKey(ms.currentMachine.id)) return;
  if (!(await persistVisibleOrder())) return;
  setActiveGroupKey(ms.currentMachine.id, key);
  renderDetailGrid({ keepBar: true });
}

function openGroupModal(machine, group = null) {
  ms.editingGroup = group;
  els.groupForm.reset();
  if (group) {
    const groups = getGroupsForMachine(machine.id);
    const idx = groups.findIndex((g) => g.id === group.id);
    els.groupModalTitle.textContent = 'Modifica gruppo';
    els.groupSubmit.textContent = 'Salva modifiche';
    els.groupName.value = group.name;
    els.groupDelete.classList.remove('hidden');
    els.groupMoveRow.classList.toggle('hidden', groups.length < 2);
    els.groupLeft.disabled = idx <= 0;
    els.groupRight.disabled = idx < 0 || idx >= groups.length - 1;
  } else {
    els.groupModalTitle.textContent = 'Nuovo gruppo';
    els.groupSubmit.textContent = 'Aggiungi';
    els.groupDelete.classList.add('hidden');
    els.groupMoveRow.classList.add('hidden');
  }
  openOverlay(els.groupModal);
}

export async function handleGroupSubmit(e) {
  e.preventDefault();
  if (!ms.currentMachine) return;
  const name = els.groupName.value.trim();
  if (!name) return;
  const groups = getGroupsForMachine(ms.currentMachine.id);
  if (groups.some((g) => g.id !== ms.editingGroup?.id && g.name.trim().toLowerCase() === name.toLowerCase())) {
    toastWarning('Esiste già un gruppo con questo nome.');
    return;
  }
  setButtonBusy(els.groupSubmit, true);
  try {
    if (!(await persistVisibleOrder())) return;
    if (ms.editingGroup) {
      await updateManualGroup(ms.editingGroup.id, { name });
      toastSuccess(`Gruppo "${name}" aggiornato.`);
    } else {
      const created = await createManualGroup({ machineId: ms.currentMachine.id, name, sortOrder: groups.length });
      setActiveGroupKey(ms.currentMachine.id, created.id);
      toastSuccess(`Gruppo "${name}" creato.`);
    }
    feedback.confirmAction();
    closeOverlay(els.groupModal);
    await refreshManualsCache();
    renderDetailGrid();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile salvare il gruppo.');
  } finally {
    setButtonBusy(els.groupSubmit, false);
  }
}

export async function handleGroupDelete() {
  if (!ms.editingGroup || !ms.currentMachine) return;
  const group = ms.editingGroup;
  const ok = await confirmDialog({
    title: 'Eliminare il gruppo?',
    message: `Il gruppo "${group.name}" verrà eliminato. Le sue piastrelle non vengono eliminate: passano nel gruppo "Altro".`,
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  setButtonBusy(els.groupDelete, true);
  try {
    if (!(await persistVisibleOrder())) return;
    await deleteManualGroup(group.id);
    if (getActiveGroupKey(ms.currentMachine.id) === group.id) setActiveGroupKey(ms.currentMachine.id, NO_GROUP);
    feedback.deleteAction();
    toastSuccess(`Gruppo "${group.name}" eliminato.`);
    closeOverlay(els.groupModal);
    await refreshManualsCache();
    renderDetailGrid();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile eliminare il gruppo.');
  } finally {
    setButtonBusy(els.groupDelete, false);
  }
}

/** Sposta il gruppo in modifica di una posizione a sinistra (-1) o a destra (+1) nella barra dei tab. */
export async function moveGroup(direction) {
  if (!ms.editingGroup || !ms.currentMachine) return;
  const groups = [...getGroupsForMachine(ms.currentMachine.id)];
  const i = groups.findIndex((g) => g.id === ms.editingGroup.id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= groups.length) return;
  try {
    if (!(await persistVisibleOrder())) return;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    await updateManualGroupsOrder(groups.map((g) => g.id));
    feedback.confirmAction();
    closeOverlay(els.groupModal);
    await refreshManualsCache();
    renderDetailGrid();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err.message || 'Impossibile spostare il gruppo.');
  }
}
