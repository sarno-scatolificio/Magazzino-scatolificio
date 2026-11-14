// =============================================================
// interventi-pdf-sheet.js — Foglio di scelta degli interventi e delle foto per il PDF del giorno
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, els, state } from './interventi-shared.js';
import { LINEE, dettagliPdf, keyToDate, lineaLabel, listEffettuatiRange, operatoriDi, signedUrls } from './interventi-data.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { escapeHtml } from '../magazzino/products-shared.js';
import { exportGiornoPdf } from './interventi-pdf.js';
import { exportDaFarePdf } from './interventi-pdf-todo.js';
import feedback from '../../shared/feedback.js';
import { openPhotoViewer } from './interventi-photo.js';
import { pickDateRange } from '../../shared/date-range-modal.js';
import { toastError, toastSuccess, toastWarning } from '../../shared/toast.js';


const CHECK_SVG = (on) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:${on ? 1 : 0}"><path d="m5 12 5 5 9-10"/></svg>`;

/**
 * Riga di scelta (uguale per effettuati e da effettuare): spunta dell'intervento, sotto-testo,
 * "Dettagli" (se l'intervento ne ha) e miniatura con "Foto" (se ha una foto).
 * st = { selected, photoSel, detailSel, urls }; chiedere foto o dettagli di un intervento vuol dire volerlo nel PDF.
 */
function buildPickRow(st, r, repaint, sub) {
  const on = st.selected.has(r.id);
  const photoPath = pdfPhotoPath(r);
  const photoOn = !!photoPath && st.photoSel.has(r.id);
  const hasDet = dettagliPdf(r).length > 0;
  const detOn = hasDet && st.detailSel.has(r.id);
  const chip = (attr, checked, label) => `
        <button type="button" ${attr} role="checkbox" aria-checked="${checked}" class="press-spring flex items-center gap-1.5 min-h-[32px] text-[11px] font-display font-semibold uppercase tracking-wide text-graphite-300">
          <span class="int-check">${CHECK_SVG(checked)}</span>${label}
        </button>`;
  const row = document.createElement('div');
  row.className = 'int-card card-plate rounded-xl p-3 flex items-start gap-3';
  row.innerHTML = `
      <div class="min-w-0 flex-1 flex flex-col gap-1">
        <button type="button" data-pick role="checkbox" aria-checked="${on}" class="press-spring flex items-start gap-3 text-left">
          <span class="int-check mt-0.5">${CHECK_SVG(on)}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-graphite-100 leading-snug line-clamp-2">${escapeHtml(r.descrizione)}</span>
            ${sub ? `<span class="block text-xs text-graphite-400 mt-0.5 truncate">${escapeHtml(sub)}</span>` : ''}
          </span>
        </button>
        ${hasDet ? `<span class="pl-8">${chip('data-detail-pick', detOn, 'Includi dettagli')}</span>` : ''}
      </div>
      ${photoPath ? `
      <span class="shrink-0 flex flex-col items-center gap-1.5">
        <button type="button" data-thumb-open aria-label="Ingrandisci la foto" class="press-spring w-16 h-16 rounded-lg overflow-hidden bg-graphite-800 border border-graphite-700 flex items-center justify-center">
          <img data-pdf-thumb data-id="${r.id}" alt="" class="w-full h-full object-cover ${st.urls[photoPath] ? '' : 'hidden'}" ${st.urls[photoPath] ? `src="${st.urls[photoPath]}"` : ''}>
        </button>
        ${chip('data-photo-pick', photoOn, 'Foto')}
      </span>` : ''}`;
  const toggle = (set, withRow) => {
    if (set.has(r.id)) set.delete(r.id);
    else {
      set.add(r.id);
      if (withRow) st.selected.add(r.id);
    }
    feedback.presetPick();
    repaint();
  };
  row.querySelector('[data-pick]').addEventListener('click', () => toggle(st.selected, false));
  row.querySelector('[data-detail-pick]')?.addEventListener('click', () => toggle(st.detailSel, true));
  row.querySelector('[data-photo-pick]')?.addEventListener('click', () => toggle(st.photoSel, true));
  row.querySelector('[data-thumb-open]')?.addEventListener('click', () => {
    const url = st.urls[photoPath];
    if (url) openPhotoViewer(url);
  });
  return row;
}

/** Miniature delle foto di un elenco (URL firmati in un'unica richiesta, poi tenuti in memoria) */
async function loadThumbs(st, rows, listEl) {
  const missing = rows.map(pdfPhotoPath).filter((p) => p && !st.urls[p]);
  if (missing.length) {
    try {
      Object.assign(st.urls, await signedUrls(missing));
    } catch (err) {
      console.warn('Anteprime foto non disponibili.', err);
      return;
    }
  }
  rows.forEach((r) => {
    const p = pdfPhotoPath(r);
    const url = p && st.urls[p];
    const img = url && listEl.querySelector(`[data-pdf-thumb][data-id="${r.id}"]`);
    if (img && !img.getAttribute('src')) {
      img.src = url;
      img.classList.remove('hidden');
    }
  });
}

/** Riepilogo della scelta: "5 di 8 selezionati · 2 con foto · 1 con dettagli" */
function countText(st, rows) {
  const sel = rows.filter((r) => st.selected.has(r.id));
  const nP = sel.filter((r) => st.photoSel.has(r.id) && pdfPhotoPath(r)).length;
  const nD = sel.filter((r) => st.detailSel.has(r.id) && dettagliPdf(r).length).length;
  return `${sel.length} di ${rows.length} selezionati${nP ? ` · ${nP} con foto` : ''}${nD ? ` · ${nD} con dettagli` : ''}`;
}

// ---------------------------------------------------------------
// PDF DEGLI INTERVENTI EFFETTUATI: scelta del giorno e degli interventi da inserire
// ---------------------------------------------------------------
const pdf = { from: null, to: null, rows: [], selected: new Set(), photoSel: new Set(), detailSel: new Set(), urls: {}, busy: false };

/** La foto che finisce nel PDF: quella dell'esito, altrimenti quella del promemoria (come la miniatura dell'elenco) */
const pdfPhotoPath = (r) => r.foto_esito_path || r.foto_promemoria_path || '';

const fmtDay = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const periodLabel = () => (pdf.from.toDateString() === pdf.to.toDateString() ? fmtDay(pdf.from) : `${fmtDay(pdf.from)} - ${fmtDay(pdf.to)}`);

export function initPdfSheet() {
  els.pdfModal = $('int-pdf-modal');
  const close = () => closeOverlay(els.pdfModal);
  $('int-pdf-close').addEventListener('click', close);
  els.pdfModal.addEventListener('click', (e) => e.target === els.pdfModal && close());
  enableSheetDrag(els.pdfModal.querySelector('.modal-panel'), close);
  $('int-pdf-change').addEventListener('click', async () => {
    const range = await pickDateRange({ from: pdf.from, to: pdf.to, marks: state.doneDays });
    if (range) await loadPdfRange(range);
  });
  $('int-pdf-all').addEventListener('click', () => {
    const all = pdf.selected.size !== pdf.rows.length;
    pdf.selected = new Set(all ? pdf.rows.map((r) => r.id) : []);
    feedback.modeSelect();
    paintPdfSheet();
  });
  $('int-pdf-go').addEventListener('click', generatePdf);

  // Foglio di scelta del PDF degli interventi da effettuare
  els.pdfTodoModal = $('int-pdf-todo-modal');
  const closeTodo = () => closeOverlay(els.pdfTodoModal);
  $('int-pdf-todo-close').addEventListener('click', closeTodo);
  els.pdfTodoModal.addEventListener('click', (e) => e.target === els.pdfTodoModal && closeTodo());
  enableSheetDrag(els.pdfTodoModal.querySelector('.modal-panel'), closeTodo);
  $('int-pdf-todo-all').addEventListener('click', () => {
    const all = todo.selected.size !== todo.rows.length;
    todo.selected = new Set(all ? todo.rows.map((r) => r.id) : []);
    feedback.modeSelect();
    paintTodoSheet();
  });
  $('int-pdf-todo-go').addEventListener('click', generateTodoPdf);
}

// ---------------------------------------------------------------
// PDF DEGLI INTERVENTI DA EFFETTUARE: scelta dei lavori da inserire (come per gli effettuati)
// ---------------------------------------------------------------
const todo = { rows: [], selected: new Set(), photoSel: new Set(), detailSel: new Set(), urls: {}, busy: false };

/** Stesso ordine del PDF: linea, poi macchina (come scelto dall'admin), poi data di inserimento */
function todoRowSort(a, b) {
  const orderIdx = new Map(state.machineOrder.map((n, i) => [n.toLowerCase(), i]));
  const idxOf = (m) => (orderIdx.has(m.toLowerCase()) ? orderIdx.get(m.toLowerCase()) : 9999);
  const lineaIdx = (v) => (LINEE.findIndex((l) => l.value === v) + 1 || 99);
  return lineaIdx(a.linea) - lineaIdx(b.linea) || idxOf(a.macchina) - idxOf(b.macchina) || a.macchina.localeCompare(b.macchina, 'it') || new Date(a.created_at) - new Date(b.created_at);
}

/** Apre l'elenco dei lavori ancora da effettuare: di partenza sono tutti selezionati, si tolgono quelli da non stampare */
export function onExportTodoPdf() {
  if (!state.open.length) return;
  feedback.tap();
  todo.rows = [...state.open].sort(todoRowSort);
  todo.selected = new Set(todo.rows.map((r) => r.id));
  todo.photoSel = new Set(); // foto e dettagli vanno scelti uno per uno: di partenza non inclusi
  todo.detailSel = new Set();
  paintTodoSheet();
  openOverlay(els.pdfTodoModal);
}

function paintTodoSheet() {
  const total = todo.rows.length;
  const n = todo.selected.size;
  $('int-pdf-todo-count').textContent = countText(todo, todo.rows);
  $('int-pdf-todo-all').textContent = n === total ? 'Deseleziona tutti' : 'Seleziona tutti';
  const go = $('int-pdf-todo-go');
  go.disabled = n === 0 || todo.busy;
  $('int-pdf-todo-go-label').textContent = n === 0 ? 'Scegli almeno un intervento' : `Genera PDF (${n})`;

  const list = $('int-pdf-todo-list');
  list.innerHTML = '';
  let lastLinea = null;
  let lastMachine = null;
  todo.rows.forEach((r) => {
    if (r.linea !== lastLinea) {
      lastLinea = r.linea;
      lastMachine = null;
      const h = document.createElement('p');
      h.className = 'font-display font-bold text-sm uppercase tracking-wider text-white bg-amber-400 rounded-lg px-3 py-1.5 mt-1.5';
      h.textContent = lineaLabel(r.linea);
      list.appendChild(h);
    }
    if (r.macchina !== lastMachine) {
      lastMachine = r.macchina;
      const h = document.createElement('p');
      h.className = 'font-display font-bold text-xs uppercase tracking-wider text-graphite-400 pt-1';
      h.textContent = r.macchina; // testo, mai HTML
      list.appendChild(h);
    }
    const ops = operatoriDi(r);
    const row = buildPickRow(todo, r, paintTodoSheet, ops.length ? ops.join(', ') : 'Non assegnato');
    list.appendChild(row);
  });
  loadThumbs(todo, todo.rows, list);
}

/** Genera il PDF per operatore con i soli lavori scelti */
async function generateTodoPdf() {
  const chosen = todo.rows.filter((r) => todo.selected.has(r.id));
  if (!chosen.length || todo.busy) return;
  todo.busy = true;
  const go = $('int-pdf-todo-go');
  setButtonBusy(go, true, 'Preparo il PDF…');
  try {
    const res = await exportDaFarePdf(chosen, {
      photoIds: todo.photoSel,
      detailIds: todo.detailSel,
      onPhotosSkipped: (n) => toastWarning(`${n} ${n === 1 ? 'foto non è stata inclusa' : 'foto non sono state incluse'}: non disponibili.`),
    });
    if (res === true) {
      feedback.confirmAction();
      toastSuccess('PDF generato.', 2500);
      closeOverlay(els.pdfTodoModal);
    }
    // 'cancelled': l'invio è stato annullato, la scelta resta aperta per riprovare
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Impossibile generare il PDF.');
  } finally {
    todo.busy = false;
    setButtonBusy(go, false);
    paintTodoSheet();
  }
}

export async function onExportPdf() {
  feedback.tap();
  const range = await pickDateRange({ from: state.doneDay ? keyToDate(state.doneDay) : new Date(), to: state.doneDay ? keyToDate(state.doneDay) : new Date(), marks: state.doneDays });
  if (!range) return;
  await loadPdfRange(range, { open: true });
}

/** Legge gli interventi effettuati nel periodo e apre l'elenco da cui scegliere */
async function loadPdfRange(range, { open = false } = {}) {
  const btn = $('int-pdf-btn');
  btn.disabled = true;
  try {
    const rows = await listEffettuatiRange(range.from.toISOString(), range.to.toISOString());
    if (!rows.length) {
      feedback.cancelAction();
      toastWarning('Nessun intervento effettuato nel periodo scelto.');
      return;
    }
    // Stesso ordine del PDF: per macchina (ordine dell'admin), poi per linea e ora di esecuzione
    rows.sort(machineRowSort);
    pdf.from = range.from;
    pdf.to = range.to;
    pdf.rows = rows;
    pdf.selected = new Set(rows.map((r) => r.id)); // di partenza sono tutti selezionati
    pdf.photoSel = new Set(); // foto e dettagli vanno scelti uno per uno: di partenza non inclusi
    pdf.detailSel = new Set();
    paintPdfSheet();
    if (open) openOverlay(els.pdfModal);
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Impossibile leggere gli interventi. Controlla la connessione.');
  } finally {
    btn.disabled = !state.done.length;
  }
}

/** Ordine di elenco e PDF: linea, poi macchina (come scelto dall'admin), poi ora di esecuzione */
function machineRowSort(a, b) {
  const orderIdx = new Map(state.machineOrder.map((n, i) => [n.toLowerCase(), i]));
  const idxOf = (m) => (orderIdx.has(m.toLowerCase()) ? orderIdx.get(m.toLowerCase()) : 9999);
  const lineaIdx = (v) => (LINEE.findIndex((l) => l.value === v) + 1 || 99);
  return lineaIdx(a.linea) - lineaIdx(b.linea) || idxOf(a.macchina) - idxOf(b.macchina) || a.macchina.localeCompare(b.macchina, 'it') || new Date(a.esito_at) - new Date(b.esito_at);
}

function paintPdfSheet() {
  $('int-pdf-period').textContent = periodLabel();
  const total = pdf.rows.length;
  const n = pdf.selected.size;
  $('int-pdf-count').textContent = countText(pdf, pdf.rows);
  $('int-pdf-all').textContent = n === total ? 'Deseleziona tutti' : 'Seleziona tutti';
  const go = $('int-pdf-go');
  go.disabled = n === 0 || pdf.busy;
  $('int-pdf-go-label').textContent = n === 0 ? 'Scegli almeno un intervento' : `Genera PDF (${n})`;

  const list = $('int-pdf-list');
  list.innerHTML = '';
  let lastLinea = null;
  let lastMachine = null;
  pdf.rows.forEach((r) => {
    if (r.linea !== lastLinea) {
      lastLinea = r.linea;
      lastMachine = null;
      const h = document.createElement('p');
      h.className = 'font-display font-bold text-sm uppercase tracking-wider text-white bg-amber-400 rounded-lg px-3 py-1.5 mt-1.5';
      h.textContent = lineaLabel(r.linea);
      list.appendChild(h);
    }
    if (r.macchina !== lastMachine) {
      lastMachine = r.macchina;
      const h = document.createElement('p');
      h.className = 'font-display font-bold text-xs uppercase tracking-wider text-graphite-400 pt-1';
      h.textContent = r.macchina; // testo, mai HTML
      list.appendChild(h);
    }
    list.appendChild(buildPickRow(pdf, r, paintPdfSheet, ''));
  });
  loadThumbs(pdf, pdf.rows, list);
}

async function generatePdf() {
  const chosen = pdf.rows.filter((r) => pdf.selected.has(r.id));
  if (!chosen.length || pdf.busy) return;
  pdf.busy = true;
  const go = $('int-pdf-go');
  setButtonBusy(go, true, 'Preparo il PDF…');
  try {
    const result = await exportGiornoPdf(pdf.from, pdf.to, {
      rows: chosen,
      photoIds: pdf.photoSel,
      detailIds: pdf.detailSel,
      onPhotosSkipped: (n) => toastWarning(`${n} ${n === 1 ? 'foto non è stata inclusa' : 'foto non sono state incluse'}: non disponibili.`),
    });
    if (result === true) {
      feedback.confirmAction();
      toastSuccess('PDF pronto.', 2500);
      closeOverlay(els.pdfModal);
    }
    // 'cancelled': l'invio è stato annullato, la scelta resta aperta per riprovare
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(err?.message || 'Impossibile creare il PDF.');
  } finally {
    pdf.busy = false;
    setButtonBusy(go, false);
    paintPdfSheet();
  }
}
