// =============================================================
// scanner-punti.js — Punto di utilizzo (suggerimenti) e Macchinario del prelievo cuscinetti
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { els, ss, effectiveLinea } from './scanner-shared.js';
import feedback from '../../shared/feedback.js';
import { flagMissing } from './scanner-transaction.js';
import { listMachineEntries } from '../../data/supabase.js';
import { listPuntiSuggeriti } from '../magazzino/punti-utilizzo.js';
import { machineNamesForLinea } from './scanner-result.js';
import { openPicker } from '../../shared/picker.js';
import { toastError } from '../../shared/toast.js';

// ---------------------------------------------------------------
// Punto di utilizzo: suggerimenti (solo cuscinetti, Prelievo)
// ---------------------------------------------------------------





const isBearingPrelievo = () => ss.currentMode === 'prelievo' && ss.currentProduct?.categoria === 'cuscinetti';
const suggestionsOn = () => isBearingPrelievo() && !ss.puntoPrefilled;

/** Rilegge i punti già usati per questo cuscinetto su questa linea e macchina (si chiama a ogni cambio di scelta) */
export async function refreshPuntiSuggeriti({ autoOpen = false } = {}) {
  const seq = ++ss.puntiSeq;
  ss.puntiSuggeriti = [];
  ss.puntiOpen = false;
  if (suggestionsOn() && effectiveLinea() && els.macchinarioSelect.value) {
    try {
      const list = await listPuntiSuggeriti({ productId: ss.currentProduct.id, linea: effectiveLinea(), macchinario: els.macchinarioSelect.value });
      if (seq !== ss.puntiSeq) return; // nel frattempo è cambiata la scelta
      ss.puntiSuggeriti = list;
      // Appena scelti linea e macchinario, se ci sono precedenti la tendina si estende da sola (se non si sta già scrivendo)
      ss.puntiOpen = autoOpen && list.length > 0 && document.activeElement !== els.puntoInput;
    } catch (err) {
      console.warn('Punti di utilizzo non disponibili (offline?).', err);
    }
  }
  paintPunti();
}

export function paintPunti() {
  const has = suggestionsOn() && ss.puntiSuggeriti.length > 0;
  const open = has && ss.puntiOpen;
  els.puntoSuggest.classList.toggle('is-open', open);
  els.puntoSuggest.setAttribute('aria-hidden', String(!open));
  if (!has) {
    els.puntoList.innerHTML = '';
    return;
  }
  // Il contenuto resta mentre la tendina si richiude (animazione); si ricostruisce solo quando serve
  const sig = ss.puntiSuggeriti.map((s) => `${s.punto}|${s.volte}|${s.ultimo}`).join('§');
  if (els.puntoList.dataset.sig === sig && els.puntoList.childElementCount) return;
  els.puntoList.dataset.sig = sig;
  els.puntoList.innerHTML = '';
  const cap = document.createElement('p');
  cap.className = 'px-3 pt-2 pb-1 ui-note font-semibold uppercase tracking-wide text-graphite-500';
  cap.textContent = 'Già montato qui';
  els.puntoList.appendChild(cap);
  ss.puntiSuggeriti.forEach((s) => {
    const d = document.createElement('div');
    d.setAttribute('role', 'separator');
    d.className = 'h-px bg-graphite-700/70 mx-3';
    els.puntoList.appendChild(d);
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.className = 'w-full text-left px-3 py-2.5 min-h-[48px] active:bg-graphite-800';
    const name = document.createElement('span');
    name.className = 'block text-sm font-medium text-graphite-100';
    name.textContent = s.punto; // testo, mai HTML
    const meta = document.createElement('span');
    meta.className = 'block ui-note text-graphite-500';
    meta.textContent = `montato ${s.volte} ${s.volte === 1 ? 'volta' : 'volte'} · ultimo ${new Date(s.ultimo).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
    row.append(name, meta);
    row.addEventListener('click', () => {
      els.puntoInput.value = s.punto;
      els.puntoInput.dispatchEvent(new Event('input')); // aggiorna "Consigliato"
      ss.puntiOpen = false;
      feedback.presetPick();
      paintPunti();
    });
    els.puntoList.appendChild(row);
  });
}

/** Macchinario: finestra dell'app (non l'elenco di sistema). Si può scegliere anche senza aver scelto la linea. */
export async function pickMacchinario() {
  const options = [...els.macchinarioSelect.options].map((o) => o.value).filter(Boolean);
  const picked = await openPicker({
    title: `Macchinario${{ L1: ' · Linea 1', L2: ' · Linea 2' }[els.lineaInput.value] || ''}`,
    options,
    keepOrder: true,
    currentValue: els.macchinarioSelect.value,
  });
  if (picked === null) return; // annullato
  els.macchinarioSelect.value = picked;
  if (picked) feedback.stepDone();
  els.macchinarioSelect.dispatchEvent(new Event('change'));
}

/** Mostra nel pulsante il macchinario scelto */
export function syncMacchinarioBtn() {
  const v = els.macchinarioSelect.value;
  els.macchinarioValue.textContent = v || 'Seleziona macchinario…';
  els.macchinarioValue.classList.toggle('text-graphite-400', !v);
  els.macchinarioValue.classList.toggle('text-graphite-100', !!v);
}

export function renderMacchinariOptions(names, selected) {
  const sel = els.macchinarioSelect;
  sel.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Seleziona macchinario…';
  sel.appendChild(first);
  const list = [...names];
  if (selected && !list.some((n) => n.toLowerCase() === selected.toLowerCase())) list.unshift(selected);
  list.forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  const match = selected ? list.find((n) => n.toLowerCase() === selected.toLowerCase()) : '';
  sel.value = match || '';
  syncMacchinarioBtn();
  refreshPuntiSuggeriti();
}

export async function fillMacchinari(productMacchina) {
  const preferred = (productMacchina || '').trim();
  const linea = () => els.lineaInput.value;
  renderMacchinariOptions(machineNamesForLinea(linea()), preferred);
  if (ss.machinesCache) return;
  try {
    ss.machinesCache = await listMachineEntries();
  } catch (err) {
    console.warn('Elenco macchine non disponibile (offline?): resta solo quella dell\'articolo.', err);
    return;
  }
  // Se nel frattempo l'operatore ha già scelto qualcosa, non glielo cambio
  if (ss.currentMode === 'prelievo' && ss.currentProduct && !els.macchinarioSelect.value) {
    renderMacchinariOptions(machineNamesForLinea(linea()), preferred);
  } else if (ss.currentMode === 'prelievo' && ss.currentProduct) {
    renderMacchinariOptions(machineNamesForLinea(linea()), els.macchinarioSelect.value);
  }
}
