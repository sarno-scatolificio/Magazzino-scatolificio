// =============================================================
// interventi-new.js — Nuovo intervento: Linea → Macchina → Intervento
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, authorName, draft, els, state } from './interventi-shared.js';
import { closeOverlay, enableSheetDrag, openOverlay, setButtonBusy, syncSegIndicator } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import { createIntervento, dayKey, deleteIntervento, lineaLabel, rapidoMatches, updateEsito } from './interventi-data.js';
import { ensureOperatori, ensureRapidi, loadDay, paintTabs, renderList } from './interventi-list.js';
import { applyRicambi, askRicambi, pickRicambi } from './interventi-ricambi.js';
import feedback from '../../shared/feedback.js';
import { listDistinctMacchine } from '../../data/supabase.js';
import { createOperatoriPicker, operatoriLabelHtml } from './interventi-operatori-pick.js';
import { openPicker } from '../../shared/picker.js';
import { toastError, toastSuccess, toastWarning } from '../../shared/toast.js';
import { wirePhoto } from './interventi-photo.js';

// ---------------------------------------------------------------
// NUOVO INTERVENTO — Linea → Macchina → Intervento
// ---------------------------------------------------------------
export function initNewSheet() {
  els.newModal = $('int-new-modal');
  els.newModeSeg = $('int-new-mode-seg');
  els.newSeg = $('int-new-linea-seg');
  els.newMacchinaBtn = $('int-new-macchina-btn');
  els.newMacchinaValue = $('int-new-macchina-value');
  els.newDesc = $('int-new-desc');
  els.newSave = $('int-new-save');
  els.newReset = $('int-new-reset');

  const close = () => closeOverlay(els.newModal);
  $('int-new-close').addEventListener('click', close);
  els.newModal.addEventListener('click', (e) => e.target === els.newModal && close());
  enableSheetDrag(els.newModal.querySelector('.modal-panel'), close);

  // Tipo: da effettuare (promemoria) oppure già effettuato (inserimento rapido, non preventivato)
  els.newModeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fatto]');
    if (!btn) return;
    draft.fatto = btn.dataset.fatto === '1';
    feedback.modeSelect();
    paintNew({ keepText: true });
  });

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

  // Dettagli (facoltativi, solo per gli interventi da effettuare)
  els.newDettagli = $('int-new-dettagli');
  els.newDettagli.addEventListener('input', () => {
    draft.dettagli = els.newDettagli.value;
    paintNew({ keepText: true });
  });

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

  // Operatori: scelti già qui (da elenco o scritti a mano, senza salvarli in elenco)
  opPicker = createOperatoriPicker('int-new-operatore', {
    get: () => draft.operatori,
    set: (v) => {
      draft.operatori = v;
    },
    onChange: () => paintNew({ keepText: true }),
  });

  $('int-new-rapidi-btn').addEventListener('click', () => {
    rapidiOpen = !rapidiOpen;
    feedback.tap();
    paintNew({ keepText: true });
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
let opPicker = null;

function clearDraft() {
  if (draft.fotoUrl) URL.revokeObjectURL(draft.fotoUrl);
  draft.linea = draft.macchina = draft.desc = draft.dettagli = '';
  draft.foto = null;
  draft.fotoUrl = '';
  draft.fatto = false;
  draft.operatori = [];
  rapidiOpen = false;
  opPicker?.close();
}

export async function openNew() {
  feedback.tap();
  rapidiOpen = false;
  opPicker?.close();
  paintNew();
  openOverlay(els.newModal);
  // Interventi rapidi e operatori in memoria: si caricano (una volta) e compaiono come scelte
  await Promise.all([ensureRapidi(), ensureOperatori()]);
  paintNew({ keepText: true });
}

let rapidiOpen = false; // tendina aperta col pulsante «Interventi rapidi» (si apre solo da lì)
let rapidiKey = ''; // elenco già disegnato nella tendina: si rifà solo se cambia (così lo scorrimento non riparte da capo)

/** Interventi rapidi della linea e macchina scelte: prima i più usati su quella macchina, poi in ordine alfabetico */
function rapidiForDraft() {
  if (!draft.linea || !draft.macchina) return [];
  const mac = draft.macchina.toLowerCase();
  const uses = new Map();
  [...state.open, ...state.doneRecent].forEach((r) => {
    if ((r.macchina || '').toLowerCase() !== mac) return;
    const k = (r.descrizione || '').trim().toLowerCase();
    uses.set(k, (uses.get(k) || 0) + 1);
  });
  const titles = [...new Set(state.rapidi.filter((r) => rapidoMatches(r, draft.linea, draft.macchina)).map((r) => r.titolo))];
  const n = (t) => uses.get(t.trim().toLowerCase()) || 0;
  return titles.sort((a, b) => n(b) - n(a) || a.localeCompare(b, 'it'));
}

function pickRapido(t) {
  draft.desc = t;
  els.newDesc.value = t;
  rapidiOpen = false;
  feedback.stepDone();
  paintNew({ keepText: true });
}

/** Tendina «Interventi rapidi», prima del punto 3: si apre solo dal pulsante e scorre se le voci sono tante */
function paintRapidi() {
  const box = $('int-new-rapidi');
  const all = rapidiForDraft();
  box.classList.toggle('hidden', !all.length);
  if (!all.length) {
    rapidiOpen = false;
    rapidiKey = '';
    return;
  }
  $('int-new-rapidi-label').textContent = `Interventi rapidi (${all.length})`;
  const list = $('int-new-rapidi-list');
  const key = all.join('\u0001');
  if (key !== rapidiKey) {
    rapidiKey = key;
    list.innerHTML = '';
    const rowCls = 'w-full text-left px-3.5 py-2.5 text-sm text-graphite-100 border-t border-graphite-700/70 first:border-t-0 active:bg-[var(--accent-tint-soft)] min-h-[44px]';
    all.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.className = rowCls;
      b.textContent = t; // testo, mai HTML
      b.addEventListener('click', () => pickRapido(t));
      list.appendChild(b);
    });
  }
  const open = rapidiOpen;
  $('int-new-rapidi-wrap').classList.toggle('is-open', open);
  $('int-new-rapidi-wrap').setAttribute('aria-hidden', String(!open));
  $('int-new-rapidi-wrap').inert = !open; // chiusa: le voci non si raggiungono né con la tastiera né con la voce
  $('int-new-rapidi-btn').setAttribute('aria-expanded', String(open));
  $('int-new-rapidi-chev').classList.toggle('rotate-180', open);
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
  paintNew();
  // Scelta la macchina si va dritti alla scrittura
  if (changed && !draft.desc) els.newDesc.focus();
}

function paintNew({ keepText = false } = {}) {
  // Tipo (da effettuare / già effettuato) e testi che cambiano di conseguenza
  els.newModeSeg.querySelectorAll('[data-fatto]').forEach((b) => b.classList.toggle('category-tab-active', (b.dataset.fatto === '1') === draft.fatto));
  syncSegIndicator(els.newModeSeg);
  requestAnimationFrame(() => syncSegIndicator(els.newModeSeg));
  $('int-new-title').textContent = draft.fatto ? 'Intervento effettuato' : 'Nuovo intervento';
  $('int-new-desc-label').textContent = draft.fatto ? '3 · Cosa è stato fatto' : '3 · Intervento';
  els.newDesc.placeholder = draft.fatto ? 'Cosa hai fatto?' : 'Cosa va fatto?';
  $('int-new-photo-label').textContent = draft.fatto ? 'Foto del lavoro svolto' : 'Foto promemoria';
  const saveLabel = $('int-new-save-label'); // letto ogni volta: setButtonBusy rifà il contenuto del pulsante
  if (saveLabel) saveLabel.textContent = draft.fatto ? 'Salva intervento effettuato' : 'Salva intervento';

  // Linea
  els.newSeg.querySelectorAll('[data-linea]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.linea === draft.linea));
  syncSegIndicator(els.newSeg);

  // Passi
  $('int-step-macchina').dataset.locked = String(!draft.linea);
  const hasMacc = !!draft.linea && !!draft.macchina;
  $('int-step-desc').dataset.locked = String(!hasMacc);
  $('int-step-photo').dataset.locked = String(!hasMacc);
  // I dettagli servono a chi farà il lavoro: si chiedono solo per gli interventi da effettuare
  $('int-step-dettagli').classList.toggle('hidden', draft.fatto);
  $('int-step-dettagli').dataset.locked = String(!hasMacc);
  $('int-step-operatori').dataset.locked = String(!hasMacc);
  $('int-new-operatore-label').innerHTML = operatoriLabelHtml(draft.fatto);
  if (document.activeElement !== els.newDettagli) els.newDettagli.value = draft.dettagli;

  els.newMacchinaValue.textContent = draft.macchina || 'Seleziona…';
  els.newMacchinaValue.classList.toggle('text-graphite-400', !draft.macchina);
  els.newMacchinaValue.classList.toggle('text-graphite-100', !!draft.macchina);

  // La descrizione si riscrive solo se non si sta digitando
  if (!keepText && document.activeElement !== els.newDesc) els.newDesc.value = draft.desc;

  paintRapidi();
  opPicker?.paint();
  wirePhotoNew?.show(draft.fotoUrl);

  const valid = hasMacc && draft.desc.trim().length > 0;
  els.newSave.disabled = !valid;
  const dirty = !!(draft.linea || draft.macchina || draft.desc || draft.dettagli || draft.foto || draft.operatori.length);
  els.newReset.classList.toggle('hidden', !dirty);
}

async function saveNew() {
  if (!draft.linea || !draft.macchina || !draft.desc.trim()) {
    feedback.errorAction();
    toastWarning('Servono linea, macchina e descrizione.');
    return;
  }
  if (draft.fatto) return saveFatto();
  setButtonBusy(els.newSave, true, 'Salvataggio…');
  try {
    const row = await createIntervento({
      linea: draft.linea,
      macchina: draft.macchina,
      descrizione: draft.desc.trim(),
      dettagli: draft.dettagli,
      foto: draft.foto,
      authorName: authorName(),
      operatori: draft.operatori,
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

// ---------------------------------------------------------------
// INTERVENTO GIÀ EFFETTUATO (rapido, non preventivato) + ricambi dal magazzino
// ---------------------------------------------------------------
async function saveFatto() {
  // 1 · Hai prelevato ricambi dal magazzino? (Indietro = non si salva nulla, il modulo resta com'è)
  const answer = await askRicambi();
  if (!answer) return;
  let selections = [];
  if (answer === 'si') {
    const picked = await pickRicambi({
      context: `${lineaLabel(draft.linea)} · ${draft.macchina}`,
      linea: draft.linea,
      macchina: draft.macchina,
      titolo: draft.desc,
      emptyLabel: 'Salva senza ricambi',
      emptyNote: 'Nessun ricambio selezionato: l\'intervento si salva comunque e resta segnalato come "Ricambi da indicare" tra gli effettuati.',
    });
    if (!picked) return; // foglio chiuso: si torna al modulo
    selections = picked;
  }
  // "Sì" ma nessun ricambio scelto: si salva e resta il promemoria
  let mancanti = answer === 'si' && !selections.length;
  const { linea, macchina } = draft;
  const descrizione = draft.desc.trim();
  const operatori = [...draft.operatori]; // la bozza si azzera prima della fine: se li tiene da parte

  setButtonBusy(els.newSave, true, 'Salvataggio…');
  let created = null;
  let applied = { done: [], failed: [] };
  try {
    // 2 · L'intervento nasce come riga normale (stessa strada già collaudata), poi passa a "Effettuato"
    created = await createIntervento({ linea, macchina, descrizione, authorName: authorName(), operatori });
    // 3 · Scalo dei ricambi dal magazzino (un prelievo per ricambio, con linea e nota dell'intervento)
    if (selections.length) {
      applied = await applyRicambi(selections, { linea, macchina, descrizione });
      mancanti = applied.failed.length > 0;
    }
    // 4 · Esito: effettuato adesso, con foto del lavoro e ricambi registrati
    const row = await updateEsito(created, {
      stato: 'effettuato',
      note: '',
      operatori,
      esitoAt: new Date(),
      foto: draft.foto,
      authorName: authorName(),
      extra: { ricambi: applied.done, ricambi_mancanti: mancanti },
    });
    clearDraft();
    const key = dayKey(new Date(row.esito_at));
    state.doneRecent.unshift(row);
    state.doneDays.add(key);
    state.doneDay = key;
    try {
      await loadDay();
    } catch (err) {
      state.done = [row];
    }
    feedback.interventoDone();
    closeOverlay(els.newModal);
    state.tab = 'done';
    paintTabs();
    renderList();
    if (applied.failed.length) {
      toastError(`Intervento salvato, ma ricambi NON scalati: ${applied.failed.map((f) => `${f.sel.product.codice_articolo} (${f.message})`).join(', ')}. Aprilo e tocca "Indica ricambi".`, 9000);
    } else if (mancanti) {
      toastWarning('Intervento salvato: ricambi da indicare.', 4000);
    } else {
      toastSuccess(applied.done.length ? `Intervento effettuato registrato, ${applied.done.length} ${applied.done.length === 1 ? 'ricambio scalato' : 'ricambi scalati'} dal magazzino.` : 'Intervento effettuato registrato.', 3500);
    }
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    if (created && applied.done.length) {
      // Ricambi già scalati ma esito non salvato: la riga resta tra i "Da effettuare" e il modulo si chiude,
      // così non si può ripetere (e scalare due volte) lo stesso prelievo.
      clearDraft();
      state.open.unshift(created);
      closeOverlay(els.newModal);
      state.tab = 'open';
      paintTabs();
      renderList();
      toastError('Ricambi scalati dal magazzino, ma l\'esito non è stato salvato: l\'intervento è tra i "Da effettuare". Aprilo e segnalo come effettuato.', 9000);
    } else {
      if (created) await deleteIntervento(created).catch(() => {}); // nulla è stato scalato: si toglie la riga rimasta a metà
      toastError(err?.message?.includes('fetch') ? 'Connessione assente: l\'intervento NON è stato salvato. Riprova.' : 'Salvataggio non riuscito. Riprova.', 6000);
    }
  } finally {
    setButtonBusy(els.newSave, false);
  }
}
