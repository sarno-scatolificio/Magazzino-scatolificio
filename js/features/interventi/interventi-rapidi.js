// =============================================================
// interventi-rapidi.js — Impostazioni → Interventi rapidi (solo Admin)
// Elenco dei lavori ricorrenti associati a una linea e a una macchina, con ripetizione facoltativa
// (tornano da soli tra i «Da effettuare»). Registrazione in tre tocchi: Linea → Macchina (chip) → Intervento.
// =============================================================

import { LINEE, lineaLabel, listRapidi, createRapido, updateRapido, deleteRapido, updateRapidoCadenza, listOperatori, createOperatore, deleteOperatore, formatOperatore, compareOperatori } from './interventi-data.js';
import { listDistinctMacchine, listMachineEntries } from '../../data/supabase.js';
import { invalidateRapidi, invalidateOperatori } from './interventi.js';
import { toastSuccess, toastError, toastWarning, toastInfo } from '../../shared/toast.js';
import { isAdmin } from '../../core/auth.js';
import { staggerIndex, setButtonBusy, openOverlay, closeOverlay, enableSheetDrag, syncSegIndicator } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import feedback from '../../shared/feedback.js';

const $ = (id) => document.getElementById(id);
const els = {};
let linea = '';
let macchina = '';
let macchineLinea = []; // macchine presenti sulla linea scelta
let cadenzaSel = ''; // '' = nessuna ripetizione | '7' | '15' | '30' | '90' | 'altro'
let tableMissing = false;
let lineaSeq = 0;
let editing = null; // intervento rapido in modifica (null = si sta aggiungendo)

// Scelte rapide per la ripetizione: un tocco; "Altro" apre il campo per un numero di giorni a piacere
const CADENZE = [
  { v: '', label: 'Mai' },
  { v: '7', label: '7 giorni' },
  { v: '14', label: '14 giorni' },
  { v: '30', label: '30 giorni' },
  { v: '90', label: '90 giorni' },
  { v: 'altro', label: 'Altro…' },
];

export function initInterventiRapidi() {
  els.modal = $('rapidi-modal');
  els.seg = $('rapidi-linea-seg');
  els.form = $('rapidi-form');
  els.title = $('rapidi-titolo');
  els.cadenza = $('rapidi-cadenza');
  els.cadenzaChips = $('rapidi-cadenza-chips');
  els.cadenzaAltro = $('rapidi-cadenza-altro');
  els.macchine = $('rapidi-macchine');
  els.addBtn = $('rapidi-add-btn');
  els.editBanner = $('rapidi-edit-banner');
  els.list = $('rapidi-list');
  els.skeleton = $('rapidi-skeleton');
  els.notice = $('rapidi-notice');
  if (!els.modal) return;

  // Scelte di ripetizione (chip): si disegnano una volta sola
  CADENZE.forEach(({ v, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'int-chip press-spring';
    b.dataset.cad = v;
    b.textContent = label;
    els.cadenzaChips.appendChild(b);
  });
  els.cadenzaChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cad]');
    if (!btn) return;
    cadenzaSel = btn.dataset.cad;
    feedback.modeSelect();
    paintForm();
    if (cadenzaSel === 'altro') setTimeout(() => els.cadenza.focus(), 280);
  });

  $('rapidi-manage-btn')?.addEventListener('click', () => {
    openOverlay(els.modal);
    syncSegIndicator(els.seg);
    paintForm();
    refresh();
  });
  $('rapidi-modal-close').addEventListener('click', () => closeOverlay(els.modal));
  els.modal.addEventListener('click', (e) => e.target === els.modal && closeOverlay(els.modal));
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => closeOverlay(els.modal));

  // 1 · Linea
  els.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-linea]');
    if (!btn || btn.dataset.linea === linea) return;
    setLinea(btn.dataset.linea);
  });

  // 2 · Macchina (chip)
  els.macchine.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-macchina]');
    if (!btn) return;
    const changed = macchina !== btn.dataset.macchina;
    macchina = btn.dataset.macchina;
    feedback.stepDone();
    renderMacchine();
    paintForm();
    // Scelta la macchina si va dritti alla scrittura
    if (changed && !els.title.value.trim()) setTimeout(() => els.title.focus(), 120);
  });

  // 3 · Intervento
  els.title.addEventListener('input', paintForm);

  els.form.addEventListener('submit', onAdd);
  $('rapidi-edit-cancel').addEventListener('click', cancelEdit);
  renderMacchine();
  paintForm();
}

/** Sceglie la linea e mostra subito le sue macchine, da toccare: niente elenco a parte da aprire */
async function setLinea(value) {
  linea = value;
  feedback.modeSelect();
  els.seg.querySelectorAll('[data-linea]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.linea === linea));
  syncSegIndicator(els.seg);
  const mySeq = ++lineaSeq;
  let list = [];
  try {
    list = await listDistinctMacchine({ linea });
  } catch (err) {
    feedback.errorAction();
    toastError('Impossibile caricare l\'elenco delle macchine.');
  }
  if (mySeq !== lineaSeq) return; // nel frattempo si è scelta un'altra linea
  macchineLinea = list;
  if (macchina && !macchineLinea.includes(macchina)) macchina = ''; // la macchina deve esistere anche sulla nuova linea
  renderMacchine();
  paintForm();
}

/** Porta nel modulo un intervento rapido già salvato, per modificarlo */
async function startEdit(r) {
  editing = r;
  await setLinea(r.linea === 'L1-L2' ? 'L1' : r.linea);
  macchina = r.macchina;
  if (!macchineLinea.includes(macchina)) macchineLinea = [macchina, ...macchineLinea]; // macchina non più elencata sulla linea: resta modificabile
  renderMacchine();
  els.title.value = r.titolo;
  const g = r.cadenza_giorni ?? null;
  cadenzaSel = g == null ? '' : ['7', '14', '30', '90'].includes(String(g)) ? String(g) : 'altro';
  els.cadenza.value = cadenzaSel === 'altro' ? String(g) : '';
  paintForm();
  els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  if (!editing) return;
  editing = null;
  els.title.value = '';
  els.cadenza.value = '';
  cadenzaSel = '';
  paintForm();
}

function renderMacchine() {
  els.macchine.innerHTML = '';
  if (!linea) {
    els.macchine.innerHTML = '<p class="text-xs text-graphite-500">Scegli prima la linea.</p>';
    return;
  }
  if (!macchineLinea.length) {
    els.macchine.innerHTML = '<p class="text-xs text-graphite-500">Nessuna macchina su questa linea.</p>';
    return;
  }
  macchineLinea.forEach((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'int-chip press-spring';
    b.dataset.macchina = name;
    b.textContent = name; // testo, mai HTML
    b.setAttribute('aria-pressed', String(name === macchina));
    els.macchine.appendChild(b);
  });
}

/** Passi sbloccati in ordine (Linea → Macchina → Intervento), scelte attive e pulsante Aggiungi */
function paintForm() {
  const hasLinea = !!linea;
  const hasMacc = hasLinea && !!macchina;
  $('rapidi-step-macchina').dataset.locked = String(!hasLinea);
  $('rapidi-step-titolo').dataset.locked = String(!hasMacc);
  $('rapidi-step-cadenza').dataset.locked = String(!hasMacc);
  els.macchine.querySelectorAll('[data-macchina]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.macchina === macchina)));
  els.cadenzaChips.querySelectorAll('[data-cad]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cad === cadenzaSel)));
  const altro = cadenzaSel === 'altro';
  els.cadenzaAltro.classList.toggle('is-open', altro);
  els.cadenzaAltro.setAttribute('aria-hidden', String(!altro));
  els.title.disabled = tableMissing;
  els.addBtn.disabled = tableMissing || !hasMacc || !els.title.value.trim();
  els.editBanner.classList.toggle('hidden', !editing);
  const mode = editing ? 'edit' : 'add';
  if (els.addBtn.dataset.mode !== mode) {
    els.addBtn.dataset.mode = mode;
    els.addBtn.innerHTML = `<i data-lucide="${editing ? 'check' : 'plus'}" class="w-5 h-5" stroke-width="2.5"></i><span>${editing ? 'Salva modifiche' : 'Aggiungi'}</span>`;
    window.lucide?.createIcons();
  }
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
  paintForm();
  els.list.innerHTML = '';
  if (!rapidi.length) {
    const p = document.createElement('p');
    p.className = 'text-sm text-graphite-500 py-2';
    p.textContent = 'Nessun intervento rapido ancora registrato.';
    els.list.appendChild(p);
  } else {
    const h = document.createElement('p');
    h.className = 'ui-label font-display font-bold uppercase tracking-wider text-graphite-400';
    h.textContent = 'Già registrati';
    els.list.appendChild(h);
  }
  const order = (v) => (v === 'L1-L2' ? 99 : LINEE.findIndex((l) => l.value === v));
  const sorted = [...rapidi].sort((a, b) => order(a.linea) - order(b.linea) || a.macchina.localeCompare(b.macchina, 'it') || a.titolo.localeCompare(b.titolo, 'it'));
  // Una scheda per macchina (stessa linea), con i suoi interventi in righe: come nell'elenco degli Interventi
  let lastKey = '';
  let card = null;
  let i = 0;
  sorted.forEach((r) => {
    const key = `${r.linea}|${r.macchina}`;
    if (key !== lastKey) {
      lastKey = key;
      card = document.createElement('div');
      card.className = 'list-item-in card-plate rounded-xl overflow-hidden';
      card.style.setProperty('--i', staggerIndex(i++));
      const head = document.createElement('div');
      head.className = 'flex items-center justify-between gap-2 px-3.5 py-2 bg-graphite-800/70';
      const name = document.createElement('h4');
      name.className = 'min-w-0 truncate font-display font-bold text-sm uppercase tracking-wider text-graphite-100';
      name.textContent = r.macchina; // testo, mai HTML
      const lin = document.createElement('span');
      lin.className = 'shrink-0 ui-label font-display font-bold uppercase tracking-wider text-graphite-500';
      lin.textContent = lineaLabel(r.linea);
      head.append(name, lin);
      card.appendChild(head);
      els.list.appendChild(card);
    }
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 pl-3.5 pr-1.5 py-1.5 border-t border-graphite-700/70';
    const name = document.createElement('span');
    name.className = 'min-w-0 flex-1 text-sm font-medium text-graphite-100';
    name.textContent = r.titolo;
    // Cadenza: ogni N giorni il lavoro compare da solo tra i "Da effettuare" alle 00:00 del giorno di scadenza (vuoto = nessuna ripetizione)
    const cad = document.createElement('label');
    cad.className = 'shrink-0 flex items-center gap-1 text-[11px] text-graphite-500';
    cad.innerHTML = 'ogni <input type="number" inputmode="numeric" min="1" max="365" step="1" placeholder="–" data-no-clear class="w-14 rounded-md bg-graphite-800 border border-graphite-700 px-1 py-1.5 text-sm text-center text-graphite-100 focus:border-amber-400 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"> gg';
    const cadInput = cad.querySelector('input');
    cadInput.value = r.cadenza_giorni ?? '';
    cadInput.setAttribute('aria-label', `Ripeti "${r.titolo}" ogni quanti giorni`);
    cadInput.addEventListener('change', () => onCadenza(r, cadInput));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Modifica ${r.titolo}`);
    edit.className = 'shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-graphite-400 hover:bg-graphite-800 transition-colors';
    edit.innerHTML = '<i data-lucide="pencil" class="w-5 h-5" stroke-width="2"></i>';
    edit.addEventListener('click', () => startEdit(r));
    const del = document.createElement('button');
    del.type = 'button';
    del.setAttribute('aria-label', `Rimuovi ${r.titolo}`);
    del.className = 'shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-rose-700 hover:bg-rose-50 transition-colors';
    del.innerHTML = '<i data-lucide="trash-2" class="w-5 h-5" stroke-width="2"></i>';
    del.addEventListener('click', () => onRemove(r));
    row.append(name, cad, edit, del);
    card.appendChild(row);
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
  const cadenzaGiorni = parseCadenza(cadenzaSel === 'altro' ? els.cadenza.value : cadenzaSel);
  if (cadenzaGiorni === false || (cadenzaSel === 'altro' && cadenzaGiorni === null)) {
    feedback.errorAction();
    toastWarning('La ripetizione deve essere un numero di giorni da 1 a 365.');
    return;
  }
  const wasEditing = !!editing;
  setButtonBusy(els.addBtn, true);
  try {
    // Macchina presente su entrambe le linee: l'intervento rapido è uno solo e vale per tutte e due
    const entry = (await listMachineEntries().catch(() => [])).find((m) => m.nome.toLowerCase() === macchina.toLowerCase());
    // (scegliendo "Reparto" l'intervento resta di reparto, anche se la macchina sta pure sulle linee)
    const onBoth = linea !== 'REP' && Array.isArray(entry?.linee) && entry.linee.includes('L1') && entry.linee.includes('L2');
    const lineaFinale = onBoth ? 'L1-L2' : linea;
    if (editing) {
      // Cambia solo il modello: gli interventi già inseriti restano com'erano. Il conteggio dei giorni riparte solo se cambia la ripetizione o la linea.
      const riparti = cadenzaGiorni !== (editing.cadenza_giorni ?? null) || lineaFinale !== editing.linea;
      await updateRapido(editing.id, { linea: lineaFinale, macchina, titolo, cadenzaGiorni, riparti });
      editing = null;
    } else {
      await createRapido({ linea: lineaFinale, macchina, titolo, cadenzaGiorni });
    }
    if (onBoth) toastInfo('Vale per entrambe le linee: la macchina è presente su Linea 1 e Linea 2.', 3000);
    // Linea e macchina restano scelte: per aggiungerne un altro sulla stessa macchina basta riscrivere il titolo
    els.title.value = '';
    els.cadenza.value = '';
    cadenzaSel = '';
    invalidateRapidi();
    feedback.confirmAction();
    toastSuccess(wasEditing ? 'Modifiche salvate: valgono dal prossimo inserimento.' : 'Intervento rapido aggiunto.', 3000);
    await refresh();
  } catch (err) {
    feedback.errorAction();
    toastError(err.message || 'Impossibile aggiungere l\'intervento rapido.');
  } finally {
    setButtonBusy(els.addBtn, false);
    paintForm();
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
    toastSuccess(giorni ? `Ripetizione: ogni ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}, alle 00:00.` : 'Ripetizione tolta.', 2500);
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
    if (editing?.id === r.id) cancelEdit();
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
