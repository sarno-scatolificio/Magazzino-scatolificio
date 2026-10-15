// =============================================================
// manuals-icon.js — Modale "Icona macchina"
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { closeOverlay, openOverlay, setButtonBusy, startUploadProgress, trimImageMargins } from '../../shared/ui-utils.js';
import { els, ms } from './manuals-shared.js';
import feedback from '../../shared/feedback.js';
import { machineIconUrl, renderList } from './manuals-list.js';
import { toastError, toastInfo, toastSuccess, toastWarning } from '../../shared/toast.js';
import { updateMachineIcon, uploadSectionIcon } from '../../data/supabase.js';

// ---------------------------------------------------------------- modale "Icona macchina" --

function setMachineIconPreview(url) {
  if (url) {
    els.machineIconPreview.src = url;
    els.machineIconPreview.classList.remove('hidden');
    els.machineIconPlaceholder.classList.add('hidden');
  } else {
    els.machineIconPreview.removeAttribute('src');
    els.machineIconPreview.classList.add('hidden');
    els.machineIconPlaceholder.classList.remove('hidden');
  }
}

export function openMachineIconModal(machine) {
  ms.editingMachine = machine;
  ms.pendingMachineIconFile = null;
  ms.removeMachineIcon = false;
  els.machineIconForm.reset();
  els.machineIconTitle.textContent = machine.nome;
  const url = machineIconUrl(machine);
  setMachineIconPreview(url);
  els.machineIconRemove.classList.toggle('hidden', !url);
  els.machineIconClean?.classList.toggle('hidden', !url);
  openOverlay(els.machineIconModal);
  window.lucide?.createIcons();
}

export function onMachineIconPicked() {
  let file = els.machineIconInput.files?.[0] || null;
  // Come per le icone dei pulsanti: il selettore non filtra per tipo, controllo qui che sia un'immagine.
  if (file && !(file.type || '').startsWith('image/') && !/\.(png|jpe?g|webp|gif|svg|bmp|avif|heic|heif)$/i.test(file.name || '')) {
    toastWarning('Seleziona un file immagine (PNG, JPG, WEBP, SVG...)');
    els.machineIconInput.value = '';
    file = null;
  }
  ms.pendingMachineIconFile = file;
  if (file) {
    ms.removeMachineIcon = false;
    // Ritaglio automatico dei margini: si vede subito in anteprima ed è ciò che viene caricato.
    const picked = file;
    setMachineIconPreview(URL.createObjectURL(picked));
    trimImageMargins(picked).then((trimmed) => {
      if (ms.pendingMachineIconFile !== picked) return; // nel frattempo scelto un altro file o rimossa l'icona
      ms.pendingMachineIconFile = trimmed;
      if (trimmed !== picked) setMachineIconPreview(URL.createObjectURL(trimmed));
    });
  } else {
    setMachineIconPreview(ms.removeMachineIcon ? null : machineIconUrl(ms.editingMachine || {}));
  }
}

/**
 * "Ripulisci immagine attuale": rielabora l'immagine già caricata (toglie sfondo e margini)
 * senza doverla ricaricare dal telefono. Il risultato si salva con "Salva".
 */
export async function onMachineIconClean() {
  const url = machineIconUrl(ms.editingMachine || {});
  if (!url || ms.pendingMachineIconFile) return;
  setButtonBusy(els.machineIconClean, true);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('download non riuscito');
    const blob = await res.blob();
    const original = new File([blob], `${ms.editingMachine.nome || 'macchina'}.png`, { type: blob.type || 'image/png' });
    const cleaned = await trimImageMargins(original);
    if (cleaned === original) {
      toastInfo('Non c\'è niente da ripulire in questa immagine.');
      return;
    }
    ms.pendingMachineIconFile = cleaned;
    ms.removeMachineIcon = false;
    setMachineIconPreview(URL.createObjectURL(cleaned));
    els.machineIconClean.classList.add('hidden');
    toastInfo('Immagine ripulita: premi Salva per applicarla.');
  } catch (err) {
    console.error(err);
    toastError('Impossibile elaborare l\'immagine attuale: ricaricala dal telefono.');
  } finally {
    setButtonBusy(els.machineIconClean, false);
  }
}

/** "Rimuovi icona": toglie l'anteprima e, al salvataggio, cancella l'icona (si torna all'ingranaggio). */
export function onMachineIconRemove() {
  ms.pendingMachineIconFile = null;
  ms.removeMachineIcon = true;
  els.machineIconInput.value = '';
  setMachineIconPreview(null);
  els.machineIconRemove.classList.add('hidden');
  els.machineIconClean?.classList.add('hidden');
}

export async function handleMachineIconSubmit(e) {
  e.preventDefault();
  if (!ms.editingMachine) return;
  if (!ms.pendingMachineIconFile && !ms.removeMachineIcon) {
    closeOverlay(els.machineIconModal); // niente da salvare
    return;
  }
  setButtonBusy(els.machineIconSubmit, true);
  const up = ms.pendingMachineIconFile ? startUploadProgress(ms.pendingMachineIconFile.name) : null;
  try {
    let newPath = null; // null = icona rimossa
    if (ms.pendingMachineIconFile) {
      newPath = await uploadSectionIcon(ms.pendingMachineIconFile, up.update);
      up.done();
    }
    await updateMachineIcon(ms.editingMachine.id, {
      newIconStoragePath: newPath,
      previousIconStoragePath: ms.editingMachine.icon_storage_path,
    });
    ms.editingMachine.icon_storage_path = newPath;
    feedback.confirmAction();
    toastSuccess(newPath ? 'Icona aggiornata.' : 'Icona rimossa.');
    closeOverlay(els.machineIconModal);
    // L'elenco è in modalità modifica: si ridisegna senza uscirne e senza perdere l'ordine appena trascinato.
    const order = Array.from(els.list.querySelectorAll('[data-machine-id]')).map((t) => t.dataset.machineId);
    if (order.length) ms.cachedMachines.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renderList();
  } catch (err) {
    console.error(err);
    up?.fail();
    feedback.errorAction();
    toastError(err.message || 'Impossibile salvare l\'icona.');
  } finally {
    setButtonBusy(els.machineIconSubmit, false);
  }
}
