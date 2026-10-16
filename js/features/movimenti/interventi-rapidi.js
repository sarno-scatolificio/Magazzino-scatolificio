// =============================================================
// interventi-rapidi.js — Impostazioni → Interventi rapidi (solo Admin)
// Elenco dei lavori ricorrenti associati a una linea e a una macchina. Nel Blocco Note
// Interventi, scelte linea e macchina, compaiono da soli come scelte rapide.
// =============================================================

import { LINEE, lineaLabel, listRapidi, createRapido, deleteRapido, updateRapidoCadenza, listOperatori, createOperatore, deleteOperatore, formatOperatore, compareOperatori } from './interventi-data.js';
import { listDistinctMacchine, listMachineEntries } from '../../data/supabase.js';
import { invalidateRapidi, invalidateOperatori } from './interventi.js';
import { openPicker } from '../../shared/picker.js';
import { toastSuccess, toastError, toastWarning, toastInfo } from '../../shared/toast.js';
import { isAdmin } from '../../core/auth.js';
import { staggerIndex, setButtonBusy, openOverlay, closeOverlay, enableSheetDrag, syncSegIndicator } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import feedback from '../../shared/feedback.js';

const $ = (id) => document.getElementById(id);
const els = {};
let linea = '';
let macchina = '';
let tableMissing = false;

export function initInterventiRapidi() {
  els.modal = $('rapidi-modal');
  els.seg = $('rapidi-linea-seg');
  els.form = $('rapidi-form');
  els.title = $('rapidi-titolo');
  els.cadenza = $('rapidi-cadenza');
  els.addBtn = $('rapidi-add-btn');
  els.list = $('rapidi-list');
  els.skeleton = $('rapidi-skeleton');
  els.notice = $('rapidi-notice');
  if (!els.modal) return;

  $('rapidi-manage-btn')?.addEventListener('click', () => {
    openOverlay(els.modal);
    syncSegIndicator(els.seg);
    refresh();
  });
  $('rapidi-modal-close').addEventListener('click', () => closeOverlay(els.modal));
  els.modal.addEventListener('click', (e) => e.target === els.modal && closeOverlay(els.modal));
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => closeOverlay(els.modal));

  els.seg.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-linea]');
    if (!btn) return;
    const changed = linea !== btn.dataset.linea;
    linea = btn.dataset.linea;
    feedback.modeSelect();
    if (changed && macchina) {
      // La macchina già scelta deve esistere anche sulla nuova linea
      const onLine = await listDistinctMacchine({ linea }).catch(() => null);
      if (onLine && !onLine.includes(macchina)) {
        macchina = '';
        const v = $('rapidi-macchina-value');
        v.textContent = 'Macchina…';
        v.classList.replace('text-graphite-100', 'text-graphite-400');
      }
    }
    els.seg.querySelectorAll('[data-linea]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.linea === linea));
    syncSegIndicator(els.seg);
  });

  $('rapidi-macchina-btn').addEventListener('click', async () => {
    let options = [];
    try {
      // Solo le macchine presenti sulla linea scelta (tutte se non ancora scelta)
    options = await listDistinctMacchine({ linea });
    } catch (err) {
      feedback.errorAction();
      toastError('Impossibile caricare l\'elenco delle macchine.');
      return;
    }
    const picked = await openPicker({ title: 'Macchina', options, keepOrder: true, currentValue: macchina });
    if (!picked) return;
    macchina = picked;
    feedback.stepDone();
    const v = $('rapidi-macchina-value');
    v.textContent = macchina;
    v.classList.replace('text-graphite-400', 'text-graphite-100');
  });

  els.form.addEventListener('submit', onAdd);
}

async function refresh() {
  if (!isAdmin()) return;
  els.skeleton.classList.remove('hidden');
  els.list.classList.add('hidden');
  try {
    const res = await listRapidi();
    tableMissing = res.tableMissing;
    render(res.rapidi);
  } catch (err) {
    console.error(err);
    toastError('Impossibile caricare gli interventi rapidi.');
  } finally {
    els.skeleton.classList.add('hidden');
  }
}

function render(rapidi) {
  els.notice.classList.toggle('hidden', !tableMissing);
  els.addBtn.disabled = tableMissing;
  els.title.disabled = tableMissing;
  els.list.innerHTML = '';
  if (!rapidi.length) {
    const p = document.createElement('p');
    p.className = 'text-sm text-graphite-500 py-2';
    p.textContent = 'Nessun intervento rapido ancora registrato.';
    els.list.appendChild(p);
  }
  const order = (v) => (v === 'L1-L2' ? 99 : LINEE.findIndex((l) => l.value === v));
  const sorted = [...rapidi].sort((a, b) => order(a.linea) - order(b.linea) || a.macchina.localeCompare(b.macchina, 'it') || a.titolo.localeCompare(b.titolo, 'it'));
  let lastKey = '';
  let i = 0;
  sorted.forEach((r) => {
    const key = `${r.linea}|${r.macchina}`;
    if (key !== lastKey) {
      lastKey = key;
      const h = document.createElement('p');
      h.className = 'ui-label font-display font-bold uppercase tracking-wider text-graphite-400 pt-2';
      h.textContent = `${lineaLabel(r.linea)} · ${r.macchina}`; // testo, mai HTML
      els.list.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'list-item-in card-plate rounded-xl pl-3.5 pr-1.5 py-1.5 flex items-center justify-between gap-2';
    row.style.setProperty('--i', staggerIndex(i++));
    const name = document.createElement('span');
    name.className = 'min-w-0 text-sm font-medium text-graphite-100';
    name.textContent = r.titolo;
    // Cadenza: ogni N giorni il lavoro compare da solo tra i "Da effettuare" alle 6:00 (vuoto = nessuna ripetizione)
    const cad = document.createElement('label');
    cad.className = 'shrink-0 flex items-center gap-1 text-[11px] text-graphite-500';
    cad.innerHTML = 'ogni <input type="number" inputmode="numeric" min="1" max="365" step="1" placeholder="–" data-no-clear class="w-14 rounded-md bg-graphite-800 border border-graphite-700 px-1 py-1.5 text-sm text-center text-graphite-100 focus:border-amber-400 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"> gg';
    const cadInput = cad.querySelector('input');
    cadInput.value = r.cadenza_giorni ?? '';
    cadInput.setAttribute('aria-label', `Ripeti "${r.titolo}" ogni quanti giorni`);
    cadInput.addEventListener('change', () => onCadenza(r, cadInput));
    const del = document.createElement('button');
    del.type = 'button';
    del.setAttribute('aria-label', `Rimuovi ${r.titolo}`);
    del.className = 'shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-rose-700 hover:bg-rose-50 transition-colors';
    del.innerHTML = '<i data-lucide="trash-2" class="w-5 h-5" stroke-width="2"></i>';
    del.addEventListener('click', () => onRemove(r));
    row.append(name, cad, del);
    els.list.appendChild(row);
  });
  els.list.classList.remove('hidden');
  window.lucide?.createIcons();
}

async function onAdd(e) {
  e.preventDefault();
  const titolo = els.title.value.trim();
  if (!linea || !macchina || !titolo) {
    feedback.errorAction();
    toastWarning('Scegli linea e macchina e scrivi l\'intervento.');
    return;
  }
  setButtonBusy(els.addBtn, true);
  try {
    const cadenzaGiorni = parseCadenza(els.cadenza.value);
    if (cadenzaGiorni === false) {
      feedback.errorAction();
      toastWarning('La ripetizione deve essere un numero di giorni da 1 a 365.');
      return;
    }
    // Macchina presente su entrambe le linee: l'intervento rapido è uno solo e vale per tutte e due
    const entry = (await listMachineEntries().catch(() => [])).find((m) => m.nome.toLowerCase() === macchina.toLowerCase());
    // (scegliendo "Reparto" l'intervento resta di reparto, anche se la macchina sta pure sulle linee)
    const onBoth = linea !== 'REP' && Array.isArray(entry?.linee) && entry.linee.includes('L1') && entry.linee.includes('L2');
    await createRapido({ linea: onBoth ? 'L1-L2' : linea, macchina, titolo, cadenzaGiorni });
    if (onBoth) toastInfo('Vale per entrambe le linee: la macchina è presente su Linea 1 e Linea 2.', 3000);
    els.title.value = '';
    els.cadenza.value = '';
    invalidateRapidi();
    feedback.confirmAction();
    toastSuccess('Intervento rapido aggiunto.', 2000);
    await refresh();
  } catch (err) {
    feedback.errorAction();
    toastError(err.message || 'Impossibile aggiungere l\'intervento rapido.');
  } finally {
    setButtonBusy(els.addBtn, false);
  }
}

/** Giorni di ripetizione: numero intero 1-365, null se vuoto, false se non valido */
function parseCadenza(txt) {
  const t = String(txt ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : false;
}

async function onCadenza(r, input) {
  const giorni = parseCadenza(input.value);
  if (giorni === false) {
    feedback.errorAction();
    toastWarning('La ripetizione deve essere un numero di giorni da 1 a 365.');
    input.value = r.cadenza_giorni ?? '';
    return;
  }
  if (giorni === (r.cadenza_giorni ?? null)) return;
  try {
    await updateRapidoCadenza(r.id, giorni);
    r.cadenza_giorni = giorni;
    invalidateRapidi();
    feedback.confirmAction();
    toastSuccess(giorni ? `Ripetizione: ogni ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}, alle 6:00.` : 'Ripetizione tolta.', 2500);
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Impossibile salvare la ripetizione.');
    input.value = r.cadenza_giorni ?? '';
  }
}

async function onRemove(r) {
  const ok = await confirmDialog({ title: 'Rimuovere l\'intervento rapido?', message: `"${r.titolo}" non comparirà più tra le scelte rapide di ${lineaLabel(r.linea)} · ${r.macchina}.`, confirmLabel: 'Rimuovi', danger: true });
  if (!ok) return;
  try {
    await deleteRapido(r.id);
    invalidateRapidi();
    await refresh();
  } catch (err) {
    feedback.errorAction();
    toastError('Impossibile rimuovere l\'intervento rapido.');
  }
}


// ---------------------------------------------------------------
// OPERATORI (Impostazioni → Operatori, solo Admin)
// ---------------------------------------------------------------
const op = {};

export function initOperatori() {
  op.modal = $('operatori-modal');
  if (!op.modal) return;
  op.form = $('operatori-form');
  op.input = $('operatori-nome');
  op.addBtn = $('operatori-add-btn');
  op.list = $('operatori-list');
  op.skeleton = $('operatori-skeleton');
  op.notice = $('operatori-notice');

  $('operatori-manage-btn')?.addEventListener('click', () => {
    openOverlay(op.modal);
    refreshOperatori();
  });
  const close = () => closeOverlay(op.modal);
  $('operatori-modal-close').addEventListener('click', close);
  op.modal.addEventListener('click', (e) => e.target === op.modal && close());
  enableSheetDrag(op.modal.querySelector('.modal-panel'), close);
  op.form.addEventListener('submit', onAddOperatore);
}

async function refreshOperatori() {
  if (!isAdmin()) return;
  op.skeleton.classList.remove('hidden');
  op.list.classList.add('hidden');
  try {
    const res = await listOperatori();
    op.notice.classList.toggle('hidden', !res.tableMissing);
    op.addBtn.disabled = res.tableMissing;
    op.input.disabled = res.tableMissing;
    renderOperatori(res.operatori);
  } catch (err) {
    console.error(err);
    toastError('Impossibile caricare gli operatori.');
  } finally {
    op.skeleton.classList.add('hidden');
  }
}

function renderOperatori(operatori) {
  op.list.innerHTML = '';
  if (!operatori.length) {
    const p = document.createElement('p');
    p.className = 'text-sm text-graphite-500 py-2';
    p.textContent = 'Nessun operatore ancora in elenco.';
    op.list.appendChild(p);
  }
  [...operatori].sort((a, b) => compareOperatori(a.nome, b.nome)).forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'list-item-in card-plate rounded-xl pl-3.5 pr-1.5 py-1.5 flex items-center justify-between gap-2';
    row.style.setProperty('--i', staggerIndex(i));
    const name = document.createElement('span');
    name.className = 'min-w-0 text-sm font-medium text-graphite-100';
    name.textContent = formatOperatore(o.nome); // es. "N. VORRARO" (testo, mai HTML)
    const del = document.createElement('button');
    del.type = 'button';
    del.setAttribute('aria-label', `Rimuovi ${formatOperatore(o.nome)}`);
    del.className = 'shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-rose-700 hover:bg-rose-50 transition-colors';
    del.innerHTML = '<i data-lucide="trash-2" class="w-5 h-5" stroke-width="2"></i>';
    del.addEventListener('click', () => onRemoveOperatore(o));
    row.append(name, del);
    op.list.appendChild(row);
  });
  op.list.classList.remove('hidden');
  window.lucide?.createIcons();
}

async function onAddOperatore(e) {
  e.preventDefault();
  setButtonBusy(op.addBtn, true);
  try {
    await createOperatore(op.input.value);
    op.input.value = '';
    invalidateOperatori();
    feedback.confirmAction();
    await refreshOperatori();
  } catch (err) {
    feedback.errorAction();
    toastError(err.message || 'Impossibile aggiungere l\'operatore.');
  } finally {
    setButtonBusy(op.addBtn, false);
  }
}

async function onRemoveOperatore(o) {
  const ok = await confirmDialog({ title: 'Rimuovere l\'operatore?', message: `${formatOperatore(o.nome)} non comparirà più tra le scelte. Gli interventi già chiusi con il suo nome non cambiano.`, confirmLabel: 'Rimuovi', danger: true });
  if (!ok) return;
  try {
    await deleteOperatore(o.id);
    invalidateOperatori();
    await refreshOperatori();
  } catch (err) {
    feedback.errorAction();
    toastError('Impossibile rimuovere l\'operatore.');
  }
}
