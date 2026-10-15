// =============================================================
// manuals-section-modal.js — Modale "Aggiungi/Modifica pulsante"
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { closeOverlay, openOverlay, setButtonBusy, startUploadProgress } from '../../shared/ui-utils.js';
import { createManualSection, getSectionIconUrl, updateManualSection, uploadSectionIcon } from '../../data/supabase.js';
import { els, ms } from './manuals-shared.js';
import { escapeHtml } from '../../shared/html-utils.js';
import feedback from '../../shared/feedback.js';
import { getActiveGroupKey } from './manuals-groups.js';
import { getGroupsForMachine, getOperatorManualsForMachine, getSectionsForOperatorManual, refreshManualsCache } from './manuals.js';
import { renderDetailGrid } from './manuals-detail.js';
import { renderList } from './manuals-list.js';
import { toastError, toastSuccess } from '../../shared/toast.js';

/** Con "Manuale intero" spuntato, i campi pagina si nascondono e smettono di essere obbligatori. */
export function applyWholeDocumentToggle() {
  const whole = els.wholeCheckbox.checked;
  els.pagesRow.classList.toggle('hidden', whole);
  els.pageStartInput.required = !whole;
  els.pageEndInput.required = !whole;
}

// ---------------------------------------------------------------- modale "Aggiungi/Modifica pulsante" --

/** Stessa modale per creare (`section` assente) e modificare (`section` valorizzata) un pulsante. */
export function openSectionModal(machine, section = null) {
  ms.editingSection = section;
  const operatorManuals = getOperatorManualsForMachine(machine.id);

  els.form.reset();
  ms.pendingIconFile = null;
  els.iconPreview.classList.add('hidden');
  els.iconPlaceholder.classList.remove('hidden');

  els.manualSelect.innerHTML = operatorManuals
    .map((m) => `<option value="${m.id}">${escapeHtml(m.file_name)}</option>`)
    .join('');

  const hasManuals = operatorManuals.length > 0;
  els.noManualNotice.classList.toggle('hidden', hasManuals);
  els.manualSelect.disabled = !hasManuals;
  els.labelInput.disabled = !hasManuals;
  els.pageStartInput.disabled = !hasManuals;
  els.pageEndInput.disabled = !hasManuals;
  els.iconInput.disabled = !hasManuals;
  els.submitBtn.disabled = !hasManuals;
  els.submitBtn.classList.toggle('opacity-50', !hasManuals);

  // Scelta del gruppo: solo se la macchina ne ha. Nuova piastrella: parte dal tab aperto.
  const groups = getGroupsForMachine(machine.id);
  els.groupWrap.classList.toggle('hidden', groups.length === 0);
  els.groupSelect.innerHTML =
    '<option value="">Altro (nessun gruppo)</option>' + groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
  const activeKey = getActiveGroupKey(machine.id);
  els.groupSelect.value = section ? section.group_id || '' : groups.some((g) => g.id === activeKey) ? activeKey : '';

  if (section) {
    els.modalTitle.textContent = 'Modifica pulsante';
    els.submitBtn.textContent = 'Salva modifiche';
    els.deleteBtn.classList.remove('hidden');
    els.labelInput.value = section.label;
    els.manualSelect.value = section.operator_manual_id;
    els.wholeCheckbox.checked = section.page_start == null && section.page_end == null;
    els.pageStartInput.value = section.page_start ?? '';
    els.pageEndInput.value = section.page_end ?? '';
    if (section.icon_storage_path) {
      els.iconPreview.src = getSectionIconUrl(section.icon_storage_path);
      els.iconPreview.classList.remove('hidden');
      els.iconPlaceholder.classList.add('hidden');
    }
  } else {
    els.modalTitle.textContent = 'Nuovo pulsante';
    els.submitBtn.textContent = 'Aggiungi';
    els.deleteBtn.classList.add('hidden');
  }
  applyWholeDocumentToggle();

  openOverlay(els.modal);
}

export async function handleCreateSection(e) {
  e.preventDefault();
  if (!ms.currentMachine) return;
  const label = els.labelInput.value.trim();
  const operatorManualId = els.manualSelect.value;
  const wholeDocument = els.wholeCheckbox.checked;
  let pageStart = null;
  let pageEnd = null;

  if (!label || !operatorManualId) return;
  if (!wholeDocument) {
    pageStart = Number(els.pageStartInput.value);
    pageEnd = Number(els.pageEndInput.value);
    if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
      toastError('Controlla l\'intervallo di pagine: la pagina finale deve essere uguale o successiva a quella iniziale.');
      return;
    }
  }

  const groupHidden = els.groupWrap.classList.contains('hidden');
  const groupId = groupHidden ? undefined : els.groupSelect.value || null;

  setButtonBusy(els.submitBtn, true);
  const up = ms.pendingIconFile ? startUploadProgress(ms.pendingIconFile.name) : null;
  try {
    let newIconStoragePath;
    if (ms.pendingIconFile) {
      newIconStoragePath = await uploadSectionIcon(ms.pendingIconFile, up.update);
      up.done();
    }

    if (ms.editingSection) {
      await updateManualSection(ms.editingSection.id, {
        operatorManualId,
        label,
        pageStart,
        pageEnd,
        newIconStoragePath,
        previousIconStoragePath: ms.editingSection.icon_storage_path,
        groupId,
      });
      feedback.confirmAction();
      toastSuccess(`Pulsante "${label}" aggiornato.`);
    } else {
      const sortOrder = getOperatorManualsForMachine(ms.currentMachine.id).reduce((n, m) => n + getSectionsForOperatorManual(m.id).length, 0); // in fondo a tutte le piastrelle della macchina
      await createManualSection({
        machineId: ms.currentMachine.id,
        operatorManualId,
        label,
        iconStoragePath: newIconStoragePath || null,
        pageStart,
        pageEnd,
        sortOrder,
        groupId,
      });
      feedback.confirmAction();
      toastSuccess(`Pulsante "${label}" aggiunto.`);
    }
    closeOverlay(els.modal);
    await refreshManualsCache();
    renderDetailGrid();
    renderList();
  } catch (err) {
    console.error(err);
    up?.fail();
    feedback.errorAction();
    toastError(err.message || `Impossibile ${ms.editingSection ? 'salvare le modifiche' : 'aggiungere il pulsante'}.`);
  } finally {
    setButtonBusy(els.submitBtn, false);
  }
}
