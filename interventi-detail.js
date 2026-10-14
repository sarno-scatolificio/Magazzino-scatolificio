// =============================================================
// interventi-detail.js — Dettaglio intervento ed esito (stato, orario, operatori, foto)
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, STATO_CHIP, authorName, els, state } from './interventi-shared.js';
import { STATI, dayKey, deleteIntervento, formatOperatore, lineaLabel, operatoriDi, ricambiDi, signedUrls, sortOperatori, updateEsito, updateRicambi } from './interventi-data.js';
import { applyRicambi, pickRicambi } from './interventi-ricambi.js';
import { authState, isAdmin } from './auth.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy, syncSegIndicator } from './ui-utils.js';
import { confirmDialog } from './ui-modal.js';
import { dayLabel, ensureOperatori, fmtDateTime, refreshDays, renderList } from './interventi-list.js';
import feedback from './feedback.js';
import { openPhotoViewer, wirePhoto } from './interventi-photo.js';
import { markSeen } from './interventi-unseen.js';
import { pickDateRange } from './date-range-modal.js';
import { pickTime } from './time-picker.js';
import { toastError, toastInfo, toastSuccess, toastWarning } from './toast.js';
import { infinitoAPassato } from './verbi-passato.js';

let detail = null; // intervento aperto nel foglio dell'esito: { row, stato, foto, fotoUrl, rimuovi }

/** Chiude lo stato del foglio dell'esito (usata quando si esce dalla sezione) */
export function resetDetail() {
  detail = null;
}

// ---------------------------------------------------------------
// DETTAGLIO + ESITO
// ---------------------------------------------------------------
export function initDetailSheet() {
  els.detModal = $('int-detail-modal');
  els.detSeg = $('int-esito-seg');
  els.detNote = $('int-esito-note');
  els.detSave = $('int-detail-save');
  // Titolo (testo) dell'intervento: la matita lo trasforma in un campo da modificare
  $('int-detail-desc-edit').addEventListener('click', () => {
    if (!detail) return;
    feedback.tap();
    setDescEditing(true);
    $('int-detail-desc-input').focus();
  });

  const close = () => closeOverlay(els.detModal);
  $('int-detail-close').addEventListener('click', close);
  els.detModal.addEventListener('click', (e) => e.target === els.detModal && close());
  enableSheetDrag(els.detModal.querySelector('.modal-panel'), close);

  els.detSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stato]');
    if (!btn || !detail) return;
    const prevStato = detail.stato;
    detail.stato = btn.dataset.stato;
    // Appena si sceglie "Effettuato" il giorno e l'ora partono da adesso (modificabili)
    if (detail.stato === 'effettuato' && !detail.esitoAt) detail.esitoAt = new Date();
    if (detail.stato !== prevStato) adattaTitoloAlloStato(prevStato);
    feedback.modeSelect();
    paintDetail();
  });

  wirePhotoDetail = wirePhoto('int-esito', (blob, url) => {
    if (!detail) return;
    if (detail.fotoUrl?.startsWith('blob:')) URL.revokeObjectURL(detail.fotoUrl);
    detail.foto = blob;
    detail.fotoUrl = url;
    detail.rimuovi = !blob; // tolta la foto: va rimossa anche dal database
    paintDetail();
  });

  $('int-detail-photo').addEventListener('click', () => detail?.promemoriaUrl && openPhotoViewer(detail.promemoriaUrl));
  // Giorno (calendario con i pallini blu) e ora (ruote) in cui l'intervento è stato effettuato
  $('int-quando-day').addEventListener('click', async () => {
    if (!detail?.esitoAt) return;
    feedback.tap();
    const range = await pickDateRange({ from: detail.esitoAt, single: true, marks: state.doneDays, title: 'Giorno di esecuzione' });
    if (!range || !detail) return;
    const d = new Date(detail.esitoAt);
    d.setFullYear(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
    detail.esitoAt = d;
    paintQuando();
  });
  $('int-quando-time').addEventListener('click', async () => {
    if (!detail?.esitoAt) return;
    feedback.tap();
    const t = detail.esitoAt;
    const picked = await pickTime({ value: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` });
    if (!picked || !detail) return;
    const d = new Date(detail.esitoAt);
    d.setHours(Number(picked.slice(0, 2)), Number(picked.slice(3, 5)), 0, 0);
    detail.esitoAt = d;
    paintQuando();
  });

  // Tendina degli operatori: si apre e si chiude dal campo
  $('int-operatore-btn').addEventListener('click', () => {
    if (!detail) return;
    detail.opOpen = !detail.opOpen;
    feedback.tap();
    paintOperatore();
  });
  $('int-detail-ricambi-btn').addEventListener('click', indicaRicambi);
  els.detSave.addEventListener('click', saveDetail);
  $('int-detail-delete').addEventListener('click', removeDetail);
}
let wirePhotoDetail = null;

export async function openDetail(row) {
  markSeen(row); // aperto da qualunque percorso: non è più «nuovo»
  detail = { row, stato: row.stato, operatori: operatoriDi(row), opOpen: false, esitoAt: row.stato === 'effettuato' && row.esito_at ? new Date(row.esito_at) : null, foto: null, fotoUrl: '', rimuovi: false, promemoriaUrl: '' };
  ensureOperatori().then(() => detail?.row === row && paintDetail());
  els.detNote.value = row.note_esito || '';
  $('int-detail-title').textContent = row.macchina;
  $('int-detail-linea').textContent = lineaLabel(row.linea);
  $('int-detail-desc').textContent = row.descrizione;
  $('int-detail-desc-input').value = row.descrizione;
  setDescEditing(false);
  $('int-detail-meta').textContent = `Annotato ${fmtDateTime(row.created_at)}${row.created_by_name ? ` da ${row.created_by_name}` : ''}`;
  $('int-detail-photo').classList.add('hidden');
  // L'eliminazione è di chi l'ha creato o dell'Admin (stessa regola del database)
  $('int-detail-delete').classList.toggle('hidden', !(isAdmin() || row.created_by === authState.profile?.id));
  paintDetail();
  openOverlay(els.detModal);

  // Foto (promemoria ed esito) con URL firmati
  const paths = [row.foto_promemoria_path, row.foto_esito_path].filter(Boolean);
  if (paths.length) {
    try {
      const urls = await signedUrls(paths);
      if (detail?.row !== row) return;
      if (row.foto_promemoria_path && urls[row.foto_promemoria_path]) {
        detail.promemoriaUrl = urls[row.foto_promemoria_path];
        $('int-detail-photo-img').src = detail.promemoriaUrl;
        $('int-detail-photo').classList.remove('hidden');
      }
      if (row.foto_esito_path && urls[row.foto_esito_path]) {
        detail.fotoUrl = urls[row.foto_esito_path];
        paintDetail();
      }
    } catch (err) {
      console.warn('Foto non disponibili.', err);
    }
  }
}

/**
 * Passando a "Effettuato" i verbi all'infinito del titolo diventano participi ("Sostituire cuscinetto" →
 * "Sostituito cuscinetto"). Il nuovo titolo si vede subito e si può correggere con la matita prima di salvare;
 * tornando a "Da fare" senza averlo toccato, si ripristina quello di prima.
 */
function adattaTitoloAlloStato(prevStato) {
  const input = $('int-detail-desc-input');
  if (detail.stato === 'effettuato' && prevStato !== 'effettuato') {
    const { testo, cambiato } = infinitoAPassato(input.value);
    if (!cambiato) return;
    detail.titoloPrima = input.value;
    detail.titoloConvertito = testo;
    input.value = testo;
    $('int-detail-desc').textContent = testo;
    toastInfo('Titolo scritto al passato. Per correggerlo tocca la matita.', 3500);
  } else if (prevStato === 'effettuato' && detail.stato !== 'effettuato' && detail.titoloConvertito && input.value === detail.titoloConvertito) {
    input.value = detail.titoloPrima;
    $('int-detail-desc').textContent = detail.titoloPrima;
    detail.titoloPrima = null;
    detail.titoloConvertito = null;
  }
}

/** Mostra il titolo come testo oppure come campo modificabile */
function setDescEditing(on) {
  $('int-detail-desc').classList.toggle('hidden', on);
  $('int-detail-desc-input').classList.toggle('hidden', !on);
  $('int-detail-desc-edit').classList.toggle('hidden', on);
}

function paintDetail() {
  if (!detail) return;
  els.detSeg.querySelectorAll('[data-stato]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.stato === detail.stato));
  requestAnimationFrame(() => syncSegIndicator(els.detSeg));
  syncSegIndicator(els.detSeg);
  const chip = $('int-detail-stato');
  chip.textContent = STATI[detail.row.stato];
  chip.className = `ui-label font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATO_CHIP[detail.row.stato]}`;
  wirePhotoDetail?.show(detail.fotoUrl);
  paintQuando();
  paintOperatore();
  paintRicambi();
}

/** Ricambi prelevati dal magazzino: elenco (interventi effettuati) e, se non indicati, avviso + pulsante per indicarli ora */
function paintRicambi() {
  const row = detail.row;
  const list = ricambiDi(row);
  const missing = !!row.ricambi_mancanti;
  const show = row.stato === 'effettuato' && (list.length > 0 || missing);
  $('int-detail-ricambi').classList.toggle('hidden', !show);
  $('int-detail-ricambi-warn').classList.toggle('hidden', !missing);
  $('int-detail-ricambi-btn').classList.toggle('hidden', !missing);
  const ul = $('int-detail-ricambi-list');
  ul.innerHTML = '';
  list.forEach((x) => {
    const li = document.createElement('li');
    li.className = 'text-sm leading-snug';
    li.innerHTML = '<span class="font-mono font-semibold text-graphite-100 break-all" data-code></span> <span class="font-mono text-graphite-300" data-qty></span><span class="block ui-note text-graphite-500" data-more></span>';
    li.querySelector('[data-code]').textContent = x.codice;
    li.querySelector('[data-qty]').textContent = `×${x.quantita}`;
    li.querySelector('[data-more]').textContent = [x.descrizione, x.locazione ? `Scaffale ${x.locazione}` : ''].filter(Boolean).join(' · ');
    li.querySelector('[data-more]').classList.toggle('hidden', !li.querySelector('[data-more]').textContent);
    ul.appendChild(li);
  });
  window.lucide?.createIcons();
}

/** Sostituisce l'intervento aggiornato in tutti gli elenchi in memoria */
function replaceRow(updated) {
  const swap = (arr) => arr.map((r) => (r.id === updated.id ? updated : r));
  state.open = swap(state.open);
  state.done = swap(state.done);
  state.doneRecent = swap(state.doneRecent);
}

/** "Indica ricambi": sceglie ora i ricambi di un intervento rimasto senza, li scala dal magazzino e toglie l'avviso */
async function indicaRicambi() {
  if (!detail) return;
  const row = detail.row;
  feedback.tap();
  const picked = await pickRicambi({
    context: `${lineaLabel(row.linea)} · ${row.macchina}`,
    linea: row.linea,
    macchina: row.macchina,
    titolo: row.descrizione,
    emptyLabel: 'Nessun ricambio è stato usato',
    emptyNote: 'Toccando il pulsante l\'avviso "Ricambi da indicare" viene tolto.',
  });
  if (!picked || detail?.row !== row) return;
  const btn = $('int-detail-ricambi-btn');
  setButtonBusy(btn, true, 'Salvataggio…');
  try {
    const applied = picked.length ? await applyRicambi(picked, { linea: row.linea, macchina: row.macchina, descrizione: row.descrizione }) : { done: [], failed: [] };
    const updated = await updateRicambi(row, { ricambi: [...ricambiDi(row), ...applied.done], ricambiMancanti: picked.length ? applied.failed.length > 0 : false });
    replaceRow(updated);
    detail.row = updated;
    paintDetail();
    renderList();
    if (applied.failed.length) {
      feedback.errorAction();
      toastError(`Ricambi NON scalati: ${applied.failed.map((f) => `${f.sel.product.codice_articolo} (${f.message})`).join(', ')}. Riprova.`, 8000);
    } else {
      feedback.confirmAction();
      toastSuccess(picked.length ? 'Ricambi registrati e scalati dal magazzino.' : 'Avviso tolto: nessun ricambio usato.', 3000);
    }
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Aggiornamento non riuscito. Se i ricambi risultano già scalati, controlla in Movimenti prima di riprovare.', 8000);
  } finally {
    setButtonBusy(btn, false);
  }
}

/** Giorno e ora di esecuzione: visibili solo con esito "Effettuato" */
function paintQuando() {
  const show = detail.stato === 'effettuato' && !!detail.esitoAt;
  $('int-quando-step').classList.toggle('hidden', !show);
  if (!show) return;
  $('int-quando-day-value').textContent = dayLabel(dayKey(detail.esitoAt));
  $('int-quando-time-value').textContent = detail.esitoAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Tendina "Operatori": compare solo con esito "Effettuato" (con "Da effettuare" o "Da completare" non si vede) e permette di sceglierne più d'uno. I nomi non finiscono nel PDF. */
function paintOperatore() {
  const show = detail.stato === 'effettuato';
  $('int-operatore-step').classList.toggle('hidden', !show);
  if (!show) {
    detail.opOpen = false;
    return;
  }
  const names = [...state.operatori];
  detail.operatori.forEach((n) => {
    if (!names.includes(n)) names.push(n); // operatore tolto dall'elenco ma già registrato su questo intervento
  });
  const sortedNames = sortOperatori(names); // alfabetico per cognome
  names.length = 0;
  names.push(...sortedNames);
  const open = !!detail.opOpen && names.length > 0;

  const value = $('int-operatore-value');
  value.textContent = detail.operatori.length ? sortOperatori(detail.operatori).map(formatOperatore).join(', ') : 'Seleziona operatori…';
  value.classList.toggle('text-graphite-400', !detail.operatori.length);
  value.classList.toggle('text-graphite-100', !!detail.operatori.length);
  $('int-operatore-btn').setAttribute('aria-expanded', String(open));
  $('int-operatore-chevron').style.transform = open ? 'rotate(180deg)' : '';

  const list = $('int-operatore-list');
  list.classList.toggle('hidden', !open);
  list.innerHTML = '';
  names.forEach((n, idx) => {
    if (idx > 0) {
      const d = document.createElement('div');
      d.setAttribute('role', 'separator');
      d.className = 'h-px bg-graphite-700/70 mx-3.5';
      list.appendChild(d);
    }
    const on = detail.operatori.includes(n);
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-checked', String(on));
    row.className = 'w-full flex items-center gap-3 px-3.5 min-h-[48px] text-left text-sm text-graphite-100';
    row.innerHTML = `<span class="int-check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:${on ? 1 : 0}"><path d="m5 12 5 5 9-10"/></svg></span><span class="min-w-0 truncate" data-name></span>`;
    row.querySelector('[data-name]').textContent = formatOperatore(n); // es. "N. VORRARO" (testo, mai HTML)
    row.addEventListener('click', () => {
      // Selezione multipla: la tendina resta aperta, ogni tocco aggiunge o toglie quel nome
      detail.operatori = on ? detail.operatori.filter((x) => x !== n) : [...detail.operatori, n];
      feedback.presetPick();
      paintOperatore();
    });
    list.appendChild(row);
  });
  $('int-operatore-empty').classList.toggle('hidden', names.length > 0 || !detail.opOpen);
}

const sameMinute = (date, iso) => !!date && !!iso && Math.floor(date.getTime() / 60000) === Math.floor(new Date(iso).getTime() / 60000);

async function saveDetail() {
  if (!detail) return;
  const { row } = detail;
  const note = els.detNote.value.trim();
  const descrizione = $('int-detail-desc-input').value.trim();
  if (!descrizione) {
    feedback.errorAction();
    toastWarning('Il titolo dell\'intervento non può essere vuoto.');
    return;
  }
  const unchanged = descrizione === row.descrizione && detail.stato === row.stato && note === (row.note_esito || '') && !detail.foto && !detail.rimuovi && (detail.stato !== 'effettuato' || ([...detail.operatori].sort().join('|') === [...operatoriDi(row)].sort().join('|') && sameMinute(detail.esitoAt, row.esito_at)));
  // Il giorno e l'ora di esecuzione non possono essere nel futuro
  if (detail.stato === 'effettuato' && detail.esitoAt && detail.esitoAt.getTime() > Date.now() + 60000) {
    feedback.errorAction();
    toastWarning('Il giorno e l\'ora di esecuzione non possono essere nel futuro.');
    return;
  }
  if (unchanged) {
    closeOverlay(els.detModal);
    return;
  }
  setButtonBusy(els.detSave, true, 'Salvataggio…');
  try {
    const updated = await updateEsito(row, { stato: detail.stato, note, descrizione, operatori: detail.operatori, esitoAt: detail.stato === 'effettuato' ? detail.esitoAt : null, foto: detail.foto, rimuoviFoto: detail.rimuovi, authorName: authorName() });
    state.open = state.open.filter((r) => r.id !== updated.id);
    state.done = state.done.filter((r) => r.id !== updated.id);
    state.doneRecent = state.doneRecent.filter((r) => r.id !== updated.id);
    if (updated.stato === 'effettuato') {
      state.doneRecent.unshift(updated);
      state.doneRecent.sort((a, b) => new Date(b.esito_at) - new Date(a.esito_at));
      const k = dayKey(new Date(updated.esito_at));
      state.doneDays.add(k);
      // Se è stato eseguito nel giorno mostrato compare subito lì
      if (k === state.doneDay) state.done.push(updated);
      if (row.stato === 'effettuato') {
        feedback.confirmAction(); // era già effettuato: si è solo modificato qualcosa (titolo, note, orario…)
        toastSuccess('Intervento aggiornato.', 2500);
      } else {
        feedback.interventoDone();
        toastSuccess('Intervento effettuato.', 2500);
      }
    } else {
      state.open.push(updated);
      state.open.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (row.stato === updated.stato) {
        feedback.confirmAction();
        toastSuccess('Intervento aggiornato.', 2500);
      } else {
        feedback.interventoReopen();
        toastSuccess(updated.stato === 'sospeso' ? 'Segnato da completare.' : 'Rimesso da effettuare.', 2500);
      }
    }
    closeOverlay(els.detModal);
    renderList();
    refreshDays(); // un giorno senza più interventi perde il pallino blu
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Aggiornamento non riuscito. Riprova.', 6000);
  } finally {
    setButtonBusy(els.detSave, false);
  }
}

async function removeDetail() {
  if (!detail) return;
  const { row } = detail;
  const ok = await confirmDialog({ title: 'Eliminare l\'intervento?', message: `"${row.descrizione}" su ${row.macchina} verrà cancellato con le sue foto.`, confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  try {
    await deleteIntervento(row);
    state.open = state.open.filter((r) => r.id !== row.id);
    state.done = state.done.filter((r) => r.id !== row.id);
    state.doneRecent = state.doneRecent.filter((r) => r.id !== row.id);
    closeOverlay(els.detModal);
    renderList();
    refreshDays();
    toastSuccess('Intervento eliminato.', 2500);
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Eliminazione non riuscita.');
  }
}
