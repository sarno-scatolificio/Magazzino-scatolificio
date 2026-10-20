// =============================================================
// manuals-desktop.js — Manuali su desktop (≥1024px): elenco macchine a sinistra, indice della macchina a destra,
// sempre insieme (niente scambio a scorrimento). La macchina scelta resta evidenziata.
// Ricerca rapida sopra l'elenco: filtra le macchine per nome e per nome delle loro sezioni (/ per raggiungerla,
// Invio apre la prima macchina trovata). ↑ ↓ cambiano macchina senza usare il mouse.
// =============================================================

import { els, ms } from './manuals-shared.js';
import { openMachineDetail } from './manuals-detail.js';
import { getOperatorManualsForMachine, getSectionsForOperatorManual } from './manuals-data.js';
import feedback from '../../shared/feedback.js';

const MQ = window.matchMedia('(min-width: 1024px)');
export const isDesktopManuals = () => MQ.matches;

let input = null;
let wired = false;
let lastId = null; // macchina scelta l'ultima volta: si riapre alla visita successiva

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Nomi delle sezioni di una macchina (per la ricerca) */
function sectionLabels(machine) {
  try {
    return getOperatorManualsForMachine(machine.id).flatMap((m) => getSectionsForOperatorManual(m.id).map((s) => norm(s.label)));
  } catch {
    return [];
  }
}

function ensureSearch() {
  if (input || !els.list) return;
  const wrap = document.createElement('div');
  wrap.className = 'mn-search';
  wrap.innerHTML =
    '<input type="text" id="manuals-desk-search" autocomplete="off" spellcheck="false" data-no-clear placeholder="Cerca macchina o sezione…" aria-label="Cerca macchina o sezione">' +
    '<kbd>/</kbd><p class="mn-search-note hidden" aria-live="polite"></p>';
  els.list.parentElement.insertBefore(wrap, els.list);
  input = wrap.querySelector('input');
  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = rows().find((r) => !r.classList.contains('hidden'));
      if (first) {
        first.click();
        input.blur();
      }
    } else if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      applyFilter();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      input.blur();
    }
  });
}

const rows = () => [...els.list.querySelectorAll('[data-machine-id]')].filter((r) => r.tagName === 'BUTTON');

function applyFilter() {
  const q = norm(input?.value.trim());
  const note = input?.parentElement.querySelector('.mn-search-note');
  let shown = 0;
  rows().forEach((r) => {
    const m = ms.cachedMachines.find((x) => String(x.id) === r.dataset.machineId);
    const hit = !q || (m && (norm(m.nome).includes(q) || sectionLabels(m).some((l) => l.includes(q))));
    r.classList.toggle('hidden', !hit);
    if (hit) shown += 1;
  });
  if (note) {
    note.classList.toggle('hidden', !q);
    note.textContent = shown ? `${shown} ${shown === 1 ? 'macchina' : 'macchine'}` : 'Nessuna macchina o sezione trovata';
  }
}

function markSelected() {
  const id = ms.currentMachine?.id;
  rows().forEach((r) => r.classList.toggle('mn-sel', id != null && r.dataset.machineId === String(id)));
}

/** Da chiamare dopo ogni disegno dell'elenco macchine: evidenzia la scelta, riapplica la ricerca, apre una macchina se nessuna lo è */
export function manualsDesktopSync() {
  if (!MQ.matches || !els.list || ms.listReorderMode) return;
  ensureSearch();
  wire();
  if (!ms.currentMachine && ms.cachedMachines.length) {
    const m = ms.cachedMachines.find((x) => x.id === lastId) || ms.cachedMachines[0];
    openMachineDetail(m);
  }
  if (ms.currentMachine) lastId = ms.currentMachine.id;
  markSelected();
  applyFilter();
}

function wire() {
  if (wired) return;
  wired = true;
  els.list.addEventListener('click', () => {
    feedback.tap();
    setTimeout(() => {
      if (ms.currentMachine) lastId = ms.currentMachine.id;
      markSelected();
    }, 0);
  });
  document.addEventListener('keydown', (e) => {
    if (!MQ.matches || els.view?.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-overlay.modal-visible')) return;
    const t = document.activeElement;
    if (e.key === '/' && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      e.preventDefault();
      input?.focus();
      input?.select();
      return;
    }
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = rows().filter((r) => !r.classList.contains('hidden'));
      const i = list.findIndex((r) => r.classList.contains('mn-sel'));
      const next = list[(i < 0 ? (e.key === 'ArrowDown' ? -1 : list.length) : i) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.click();
        next.scrollIntoView({ block: 'nearest' });
      }
    }
  });
}
