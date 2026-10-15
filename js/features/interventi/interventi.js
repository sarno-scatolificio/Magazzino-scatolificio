// =============================================================
// interventi.js — Blocco Note Interventi (soste di manutenzione)
// Vista "Interventi" (User e Admin): elenco Da fare / Effettuati con filtri per linea e
// macchina, nuovo intervento in tre passi obbligatori (Linea → Macchina → Intervento, con
// scelte rapide per la combinazione), foto opzionale, aggiornamento dell'esito e PDF
// giornaliero. Feedback sonoro e aptico su ogni passo (vedi feedback.js).
// =============================================================

// Questo file tiene l'avvio della sezione e le funzioni usate dal resto dell'app; il resto è diviso in
// interventi-shared / -list / -new / -detail / -photo / -pdf-sheet.

import { $, draft, els, state } from './interventi-shared.js';
import { LINEE, STATI, dayKey, keyToDate, lineaLabel, listEffettuatiDays, listInterventi } from './interventi-data.js';
import { defaultDay, loadDay, paintFilters, paintTabs, renderList, selectDay, stepDay } from './interventi-list.js';
import feedback from '../../shared/feedback.js';
import { initDetailSheet, openDetail, resetDetail } from './interventi-detail.js';
import { initNewSheet, openNew } from './interventi-new.js';
import { initRicambiSheet } from './interventi-ricambi.js';
import { initPdfSheet, onExportPdf, onExportTodoPdf } from './interventi-pdf-sheet.js';
import { initPhotoViewer } from './interventi-photo.js';
import { listDistinctMacchine } from '../../data/supabase.js';
import { openPicker } from '../../shared/picker.js';
import { pickDateRange } from '../../shared/date-range-modal.js';
import { syncSegIndicator } from '../../shared/ui-utils.js';
import { toastError } from '../../shared/toast.js';

// ---------------------------------------------------------------
// INIT
// ---------------------------------------------------------------
export function initInterventi() {
  els.seg = $('int-seg');
  els.list = $('int-list');
  els.skeleton = $('int-skeleton');
  els.notice = $('int-notice');
  els.fab = $('int-fab'); // fuori dalla vista (vedi index.html)

  // Tab Da fare / Effettuati
  els.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-int-tab]');
    if (!btn || btn.dataset.intTab === state.tab) return;
    feedback.modeSelect();
    state.tab = btn.dataset.intTab;
    paintTabs();
    renderList();
  });

  // Giorno degli effettuati: freccia indietro/avanti sui soli giorni con interventi, o calendario con i pallini blu
  $('int-date-prev').addEventListener('click', () => stepDay(-1));
  $('int-date-next').addEventListener('click', () => stepDay(1));
  $('int-date-btn').addEventListener('click', async () => {
    feedback.tap();
    const range = await pickDateRange({ from: state.doneDay ? keyToDate(state.doneDay) : new Date(), single: true, marks: state.doneDays, title: 'Giorno degli interventi' });
    if (range) await selectDay(dayKey(range.from));
  });

  // Filtri
  $('int-filter-linea-btn').addEventListener('click', async () => {
    const labels = LINEE.map((l) => l.label);
    const picked = await openPicker({ title: 'Filtra per linea', options: labels, currentValue: lineaLabel(state.filterLinea) });
    if (picked === null) return;
    state.filterLinea = LINEE.find((l) => l.label === picked)?.value || '';
    if (state.filterLinea && state.filterMacchina) {
      const onLine = await listDistinctMacchine({ linea: state.filterLinea }).catch(() => null);
      if (onLine && !onLine.includes(state.filterMacchina)) state.filterMacchina = '';
    }
    feedback.filterChange();
    paintFilters();
    renderList();
  });
  $('int-filter-macchina-btn').addEventListener('click', async () => {
    // Macchine presenti negli interventi (della linea filtrata, se scelta), nell'ordine scelto dall'admin
    const used = new Set([...state.open, ...state.done].filter((r) => !state.filterLinea || r.linea === state.filterLinea).map((r) => r.macchina));
    let ordered = [];
    try {
      ordered = await listDistinctMacchine({ linea: state.filterLinea });
    } catch (err) {
      console.warn('Ordine macchine non disponibile.', err);
    }
    const options = [...ordered.filter((n) => used.has(n)), ...[...used].filter((n) => !ordered.includes(n))];
    const picked = await openPicker({ title: 'Filtra per macchina', options, keepOrder: true, currentValue: state.filterMacchina });
    if (picked === null) return;
    state.filterMacchina = picked;
    feedback.filterChange();
    paintFilters();
    renderList();
  });

  // PDF giornaliero
  $('int-pdf-btn').addEventListener('click', onExportPdf);
  $('int-pdf-todo-btn').addEventListener('click', onExportTodoPdf);

  // Nuovo intervento
  els.fab.addEventListener('click', openNew);
  initNewSheet();
  initRicambiSheet();
  initDetailSheet();
  initPhotoViewer();
  initPdfSheet();
  paintFilters();
}

/** Mostra/nasconde il "+" (sta fuori dalla vista): visibile solo nella sezione Interventi */
export function setInterventiFab(on) {
  document.getElementById('int-fab')?.classList.toggle('int-fab--on', !!on);
}

/** Entrando nella vista: primo caricamento, poi aggiornamento silenzioso */
export async function enterInterventi() {
  syncSegIndicator(els.seg);
  await refreshInterventi({ silent: state.loaded });
}

export function resetInterventi() {
  setInterventiFab(false);
  state.open = [];
  state.done = [];
  state.doneRecent = [];
  state.doneDays = new Set();
  state.doneDay = '';
  state.machineOrder = [];
  state.loaded = false;
  state.rapidi = [];
  state.rapidiLoaded = false;
  state.operatori = [];
  state.operatoriLoaded = false;
  state.filterLinea = '';
  state.filterMacchina = '';
  state.tab = 'open';
  draft.linea = draft.macchina = draft.desc = '';
  draft.foto = null;
  draft.fotoUrl = '';
  draft.fatto = false;
  resetDetail();
  els.list && (els.list.innerHTML = '');
  paintTabs();
  paintFilters();
}

export async function refreshInterventi({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) {
    els.skeleton.classList.remove('hidden');
    els.list.classList.add('hidden');
  }
  try {
    const [res, days, order] = await Promise.all([
      listInterventi(),
      listEffettuatiDays().catch(() => null),
      listDistinctMacchine().catch(() => null),
    ]);
    state.tableMissing = res.tableMissing;
    state.open = res.open;
    state.doneRecent = res.done;
    state.doneDays = new Set(days || res.done.map((r) => dayKey(new Date(r.esito_at))));
    if (order) state.machineOrder = order;
    // Scheda Effettuati: un giorno alla volta (oggi se ci sono interventi, altrimenti l'ultimo giorno con interventi)
    if (!state.doneDay) state.doneDay = defaultDay();
    await loadDay();
    state.loaded = true;
    renderList();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Impossibile caricare gli interventi. Controlla la connessione.');
    if (!state.loaded) renderList();
  } finally {
    state.loading = false;
    els.skeleton.classList.add('hidden');
    els.list.classList.remove('hidden');
  }
}

/** Ricerca per la barra in testata: testo libero su descrizione, macchina, linea, esito e nomi. Cerca in tutti gli interventi (da fare ed effettuati), ignorando i filtri. */
export async function searchInterventi(term) {
  if (!state.loaded) {
    await refreshInterventi({ silent: true });
    // Se un caricamento era già in corso (entrata nella vista) si attende che finisca
    for (let i = 0; i < 30 && state.loading; i += 1) await new Promise((r) => setTimeout(r, 100));
  }
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hay = (r) =>
    [r.descrizione, r.macchina, lineaLabel(r.linea), r.linea, r.note_esito, r.dettagli, r.created_by_name, r.esito_by_name, STATI[r.stato]]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  return [...state.open, ...state.doneRecent].filter((r) => {
    const h = hay(r);
    return words.every((w) => h.includes(w));
  });
}

/** Apre il foglio di un intervento (dai risultati della ricerca in testata) */
export function openInterventoDetail(row) {
  return openDetail(row);
}

/** Chiamata dalle Impostazioni quando cambia l'elenco degli operatori */
export function invalidateOperatori() {
  state.operatoriLoaded = false;
}

/** Chiamata dalle Impostazioni quando cambiano gli interventi rapidi */
export function invalidateRapidi() {
  state.rapidiLoaded = false;
}
