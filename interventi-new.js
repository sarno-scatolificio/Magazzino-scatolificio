// =============================================================
// interventi-new.js — Nuovo intervento: Linea → Macchina → Intervento
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, authorName, draft, els, state } from './interventi-shared.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy, syncSegIndicator } from './ui-utils.js';
import { confirmDialog } from './ui-modal.js';
import { createIntervento, lineaLabel, rapidoMatches } from './interventi-data.js';
import { ensureRapidi, paintTabs, renderList } from './interventi-list.js';
import feedback from './feedback.js';
import { listDistinctMacchine } from './supabase.js';
import { openPicker } from './picker.js';
import { toastError, toastSuccess, toastWarning } from './toast.js';
import { wirePhoto } from './interventi-photo.js';

// ---------------------------------------------------------------
// NUOVO INTERVENTO — Linea → Macchina → Intervento
// ---------------------------------------------------------------
export function initNewSheet() {
  els.newModal = $('int-new-modal');
  els.newSeg = $('int-new-linea-seg');
  els.newMacchinaBtn = $('int-new-macchina-btn');
  els.newMacchinaValue = $('int-new-macchina-value');
  els.newDesc = $('int-new-desc');
  els.newChips = $('int-new-chips');
  els.newSave = $('int-new-save');
  els.newReset = $('int-new-reset');

  const close = () => closeOverlay(els.newModal);
  $('int-new-close').addEventListener('click', close);
  els.newModal.addEventListener('click', (e) => e.target === els.newModal && close());
  enableSheetDrag(els.newModal.querySelector('.modal-panel'), close);

  // 1 · Linea (controllo blu a scorrimento)
  els.newSeg.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-linea]');
    if (!btn) return;
    const changed = draft.linea !== btn.dataset.linea;
    draft.linea = btn.dataset.linea;
    feedback.modeSelect();
    if (changed && draft.macchina) {
      // La macchina già scelta deve esistere anche sulla nuova linea, altrimenti si riparte da qui
      const onLine = await listDistinctMacchine({ linea: draft.linea }).catch(() => null);
      if (onLine && !onLine.includes(draft.macchina)) draft.macchina = '';
    }
    paintNew();
    // La macchina si sceglie a mano, toccando il campo: non si apre più da sola
  });

  // 2 · Macchina
  els.newMacchinaBtn.addEventListener('click', pickNewMacchina);

  // 3 · Descrizione
  els.newDesc.addEventListener('input', () => {
    draft.desc = els.newDesc.value;
    paintNew({ keepText: true });
  });

  wirePhotoNew = wirePhoto('int-new', (blob, url) => {
    if (draft.fotoUrl) URL.revokeObjectURL(draft.fotoUrl);
    draft.foto = blob;
    draft.fotoUrl = url;
    paintNew();
  });

  els.newReset.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Azzerare la bozza?', message: 'Linea, macchina, testo e foto già inseriti verranno cancellati.', confirmLabel: 'Azzera', danger: true });
    if (!ok) return;
    clearDraft();
    paintNew();
  });

  els.newSave.addEventListener('click', saveNew);
}
let wirePhotoNew = null;

function clearDraft() {
  if (draft.fotoUrl) URL.revokeObjectURL(draft.fotoUrl);
  draft.linea = draft.macchina = draft.desc = '';
  draft.foto = null;
  draft.fotoUrl = '';
}

export async function openNew() {
  feedback.tap();
  paintNew();
  openOverlay(els.newModal);
  ensureRapidi(); // in background: le scelte rapide servono al terzo passo
}

async function pickNewMacchina() {
  if (!draft.linea) return;
  let options = [];
  try {
    // Solo le macchine presenti sulla linea scelta
    options = await listDistinctMacchine({ linea: draft.linea });
  } catch (err) {
    feedback.errorAction();
    toastError('Impossibile caricare l\'elenco delle macchine.');
    return;
  }
  const picked = await openPicker({ title: `Macchina · ${lineaLabel(draft.linea)}`, options, keepOrder: true, currentValue: draft.macchina });
  if (!picked) return;
  const changed = picked !== draft.macchina;
  draft.macchina = picked;
  feedback.stepDone();
  await ensureRapidi();
  paintNew();
  // Nessuna scelta rapida per questa combinazione: si va dritti alla scrittura
  if (changed && !draft.desc && !rapidiFor(draft.linea, draft.macchina).length) els.newDesc.focus();
}

const rapidiFor = (linea, macchina) => state.rapidi.filter((r) => rapidoMatches(r, linea, macchina));

function paintNew({ keepText = false } = {}) {
  // Linea
  els.newSeg.querySelectorAll('[data-linea]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.linea === draft.linea));
  syncSegIndicator(els.newSeg);

  // Passi
  $('int-step-macchina').dataset.locked = String(!draft.linea);
  const hasMacc = !!draft.linea && !!draft.macchina;
  $('int-step-desc').dataset.locked = String(!hasMacc);
  $('int-step-photo').dataset.locked = String(!hasMacc);

  els.newMacchinaValue.textContent = draft.macchina || 'Seleziona…';
  els.newMacchinaValue.classList.toggle('text-graphite-400', !draft.macchina);
  els.newMacchinaValue.classList.toggle('text-graphite-100', !!draft.macchina);

  // Scelte rapide filtrate per linea + macchina
  const chips = hasMacc ? rapidiFor(draft.linea, draft.macchina) : [];
  els.newChips.classList.toggle('hidden', !chips.length);
  if (!keepText) {
    els.newChips.innerHTML = '';
    chips.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'int-chip press-spring';
      b.textContent = c.titolo; // testo, mai HTML
      b.addEventListener('click', () => {
        draft.desc = c.titolo;
        els.newDesc.value = c.titolo;
        feedback.presetPick();
        paintNew({ keepText: true });
      });
      els.newChips.appendChild(b);
    });
    if (document.activeElement !== els.newDesc) els.newDesc.value = draft.desc;
  }
  els.newChips.querySelectorAll('.int-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === draft.desc.trim())));

  wirePhotoNew?.show(draft.fotoUrl);

  const valid = hasMacc && draft.desc.trim().length > 0;
  els.newSave.disabled = !valid;
  const dirty = !!(draft.linea || draft.macchina || draft.desc || draft.foto);
  els.newReset.classList.toggle('hidden', !dirty);
}

async function saveNew() {
  if (!draft.linea || !draft.macchina || !draft.desc.trim()) {
    feedback.errorAction();
    toastWarning('Servono linea, macchina e descrizione.');
    return;
  }
  setButtonBusy(els.newSave, true, 'Salvataggio…');
  try {
    const row = await createIntervento({
      linea: draft.linea,
      macchina: draft.macchina,
      descrizione: draft.desc.trim(),
      foto: draft.foto,
      authorName: authorName(),
    });
    state.open.unshift(row);
    clearDraft();
    feedback.noteSaved();
    toastSuccess('Intervento annotato.', 2500);
    closeOverlay(els.newModal);
    state.tab = 'open';
    paintTabs();
    renderList();
  } catch (err) {
    // Il modulo resta aperto con i dati: niente da riscrivere
    console.error(err);
    feedback.errorAction();
    toastError(err?.message?.includes('fetch') ? 'Connessione assente: l\'intervento NON è stato salvato. Riprova.' : 'Salvataggio non riuscito. Riprova.', 6000);
  } finally {
    setButtonBusy(els.newSave, false);
  }
}
