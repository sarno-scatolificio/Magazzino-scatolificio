// =============================================================
// history-admin.js — Gestione cronologia movimenti (Impostazioni, solo
// Admin): permette di rivedere, correggere ed eliminare singoli movimenti
// dallo storico (l'eliminazione anche più di uno alla volta), al posto della
// vecchia eliminazione totale e irreversibile. La correzione tocca solo il
// registro: la giacenza degli articoli non viene ricalcolata.
// =============================================================

import { listTransactions, deleteTransactions, updateTransaction, listProducts, listProfiles } from '../../data/supabase.js';
import { toastSuccess, toastError } from '../../shared/toast.js';
import { staggerIndex, emptyStateHtml, setButtonBusy, openOverlay, closeOverlay, animatePanelHeight, enableSheetDrag, modalCloseMs } from '../../shared/ui-utils.js';
import { openPicker } from '../../shared/picker.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import feedback from '../../shared/feedback.js';
import { loadIdlePanel } from '../movimenti/scanner.js';
import { escapeHtml } from '../../shared/html-utils.js';

const els = {};
let history = [];
let filter = 'tutti'; // 'tutti' | 'deposito' | 'prelievo'
const selected = new Set();

export function initHistoryAdmin() {
  els.modal = document.getElementById('history-manage-modal');
  els.openBtn = document.getElementById('history-manage-btn');
  els.closeBtn = document.getElementById('history-manage-close');
  els.tabs = document.querySelectorAll('[data-history-manage-tab]');
  els.skeleton = document.getElementById('history-manage-skeleton');
  els.list = document.getElementById('history-manage-list');
  els.actionBar = document.getElementById('history-manage-actionbar');
  els.count = document.getElementById('history-manage-count');
  els.deleteBtn = document.getElementById('history-manage-delete-btn');

  els.openBtn?.addEventListener('click', () => {
    openOverlay(els.modal);
    refreshHistory();
  });
  els.closeBtn?.addEventListener('click', () => closeOverlay(els.modal));
  els.modal?.addEventListener('click', (e) => {
    if (e.target === els.modal) closeOverlay(els.modal);
  });
  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.historyManageTab;
      els.tabs.forEach((b) => b.classList.toggle('history-tab-active', b === btn));
      animatePanelHeight(els.modal?.querySelector('.modal-panel'), render);
    });
  });
  els.deleteBtn?.addEventListener('click', handleDeleteSelected);
}

async function refreshHistory() {
  selected.clear();
  els.skeleton.classList.remove('hidden');
  els.list.classList.add('hidden');
  els.actionBar.classList.add('hidden');
  try {
    history = await listTransactions({ limit: 500 });
    render();
  } catch (err) {
    console.error(err);
    els.list.innerHTML = emptyStateHtml('wifi-off', 'Connessione assente', 'Controlla la rete e riprova.');
    toastError('Errore nel caricamento della cronologia.');
  } finally {
    els.skeleton.classList.add('hidden');
    els.list.classList.remove('hidden');
  }
}

function filteredHistory() {
  if (filter === 'tutti') return history;
  return history.filter((h) => h.tipo === filter);
}

function render() {
  const rows = filteredHistory();
  els.list.innerHTML = '';
  if (rows.length === 0) {
    els.list.innerHTML = emptyStateHtml('inbox', 'Nessun movimento', '');
    window.lucide?.createIcons();
    updateActionBar();
    return;
  }
  rows.forEach((h, i) => els.list.appendChild(historyRow(h, i)));
  window.lucide?.createIcons();
  updateActionBar();
}

function historyRow(h, i) {
  const date = new Date(h.data_ora);
  const row = document.createElement('label');
  row.className = 'list-item-in flex items-center gap-3 py-2.5 px-1 border-b border-graphite-800 last:border-0 cursor-pointer select-none';
  row.style.setProperty('--i', staggerIndex(i));

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'shrink-0 w-5 h-5 rounded accent-amber-400';
  checkbox.checked = selected.has(h.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.add(h.id);
    else selected.delete(h.id);
    updateActionBar();
  });

  const info = document.createElement('div');
  info.className = 'min-w-0 flex-1';
  info.innerHTML = `
    <p class="text-sm text-graphite-100 truncate font-medium">${escapeHtml(h.products?.codice_articolo || '—')}</p>
    <p class="text-xs text-graphite-500 mt-0.5">${escapeHtml(h.profiles?.full_name || 'Utente')} · ${escapeHtml(
    h.punto_utilizzo_specifico || '—'
  )} · ${date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
  `;

  const badge = document.createElement('span');
  badge.className = `shrink-0 font-mono text-sm font-semibold px-2.5 py-1 rounded-full ${
    h.tipo === 'deposito' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-300'
  }`;
  badge.textContent = `${h.tipo === 'deposito' ? '+' : '−'}${h.quantita}`;

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.setAttribute('aria-label', 'Modifica movimento');
  editBtn.className = 'press-spring shrink-0 w-9 h-9 rounded-lg border border-graphite-700 flex items-center justify-center text-graphite-400 hover:bg-graphite-800 transition-colors';
  editBtn.innerHTML = '<i data-lucide="pencil" class="w-4 h-4 pointer-events-none" stroke-width="2"></i>';
  editBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); // la riga è una <label>: senza questo il tocco spunterebbe anche la casella
    ev.stopPropagation();
    feedback.tap();
    openEditSheet(h);
  });

  row.append(checkbox, info, badge, editBtn);
  return row;
}

// ---- Modifica di un movimento ------------------------------------------------
const FIELD =
  'w-full min-h-[44px] rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 text-sm focus:border-amber-400 outline-none transition-colors';
let productsCache = null;
let profilesCache = null;

function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fieldBlock(label, inner) {
  return `<label class="block"><span class="block text-[11px] uppercase tracking-wider font-display font-semibold text-graphite-400 mb-1">${label}</span>${inner}</label>`;
}

function pickerBtn(role, text) {
  return `<button type="button" data-pick="${role}" class="${FIELD} flex items-center justify-between gap-2 text-left"><span data-val class="truncate">${escapeHtml(text)}</span><i data-lucide="chevron-down" class="w-4 h-4 shrink-0 text-graphite-400"></i></button>`;
}

function textInput(role, value, extra = '') {
  return `<input data-f="${role}" data-no-clear type="text" autocomplete="off" value="${escapeHtml(value || '')}" class="${FIELD} ${extra}" />`;
}

function openEditSheet(h) {
  const draft = {
    tipo: h.tipo,
    product_id: h.product_id,
    productLabel: h.products?.codice_articolo || '—',
    user_id: h.user_id,
    userLabel: h.profiles?.full_name || 'Utente',
  };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[93] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-md bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <h3 class="font-display font-bold text-lg uppercase tracking-wide">Modifica movimento</h3>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div class="flex gap-2">
          <button type="button" data-tipo="deposito" class="history-tab flex-1 rounded-lg py-2 px-1 text-xs font-display font-semibold uppercase tracking-wide border border-graphite-700 min-h-[44px]">Deposito</button>
          <button type="button" data-tipo="prelievo" class="history-tab flex-1 rounded-lg py-2 px-1 text-xs font-display font-semibold uppercase tracking-wide border border-graphite-700 min-h-[44px]">Prelievo</button>
        </div>
        ${fieldBlock('Articolo', pickerBtn('product', draft.productLabel))}
        <div class="grid grid-cols-2 gap-3">
          ${fieldBlock('Quantità', `<input data-f="quantita" data-no-clear type="number" inputmode="numeric" min="1" step="1" value="${h.quantita}" class="${FIELD}" />`)}
          ${fieldBlock('Data e ora', `<input data-f="data_ora" data-no-clear type="datetime-local" value="${toLocalInput(h.data_ora)}" class="${FIELD}" />`)}
        </div>
        ${fieldBlock('Operatore', pickerBtn('user', draft.userLabel))}
        ${fieldBlock('Punto di utilizzo', textInput('punto_utilizzo_specifico', h.punto_utilizzo_specifico))}
        <div class="grid grid-cols-2 gap-3">
          ${fieldBlock('Linea', textInput('linea', h.linea))}
          ${fieldBlock('Macchinario', textInput('macchinario', h.macchinario))}
        </div>
        ${fieldBlock('Scaffale', textInput('locazione', h.locazione))}
        ${fieldBlock('Note', textInput('note', h.note))}
        <p class="text-xs text-graphite-500">La correzione riguarda solo il registro: la giacenza dell'articolo non cambia.</p>
        <p data-role="err" class="hidden text-xs text-rose-700"></p>
      </div>
      <div class="shrink-0 flex gap-3 px-5 py-4 border-t border-graphite-800">
        <button type="button" data-act="close" class="flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide text-graphite-400 hover:text-graphite-200 hover:bg-graphite-800 transition-colors">Annulla</button>
        <button type="button" data-act="save" class="press-spring flex-1 rounded-lg py-3 bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide transition-colors">Salva</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const err = overlay.querySelector('[data-role="err"]');
  const saveBtn = overlay.querySelector('[data-act="save"]');
  const f = (name) => overlay.querySelector(`[data-f="${name}"]`);
  const showErr = (msg) => {
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
  };
  const paintTipo = () =>
    overlay.querySelectorAll('[data-tipo]').forEach((b) => b.classList.toggle('history-tab-active', b.dataset.tipo === draft.tipo));
  paintTipo();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  const close = () => {
    cleanup();
    closeOverlay(overlay);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.addEventListener('overlay-cancel', cleanup);
  overlay.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));
  enableSheetDrag(overlay.querySelector('.modal-panel'), close);
  overlay.querySelectorAll('[data-tipo]').forEach((b) =>
    b.addEventListener('click', () => {
      draft.tipo = b.dataset.tipo;
      paintTipo();
    })
  );

  overlay.querySelector('[data-pick="product"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      productsCache ||= await listProducts();
    } catch (ex) {
      console.error(ex);
      toastError('Elenco articoli non disponibile.');
      return;
    }
    const picked = await openPicker({ title: 'Articolo', options: productsCache.map((p) => p.codice_articolo), currentValue: draft.productLabel });
    const prod = picked && productsCache.find((p) => p.codice_articolo === picked);
    if (!prod) return;
    draft.product_id = prod.id;
    draft.productLabel = prod.codice_articolo;
    btn.querySelector('[data-val]').textContent = prod.codice_articolo;
  });

  overlay.querySelector('[data-pick="user"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      profilesCache ||= await listProfiles();
    } catch (ex) {
      console.error(ex);
      toastError('Elenco operatori non disponibile.');
      return;
    }
    const nameOf = (u) => u.full_name || u.email;
    const picked = await openPicker({ title: 'Operatore', options: profilesCache.map(nameOf), currentValue: draft.userLabel });
    const user = picked && profilesCache.find((u) => nameOf(u) === picked);
    if (!user) return;
    draft.user_id = user.id;
    draft.userLabel = nameOf(user);
    btn.querySelector('[data-val]').textContent = draft.userLabel;
  });

  saveBtn.addEventListener('click', async () => {
    showErr('');
    const qty = Number(f('quantita').value);
    if (!Number.isInteger(qty) || qty < 1) {
      showErr('La quantità deve essere un numero intero da 1 in su.');
      return;
    }
    const when = new Date(f('data_ora').value);
    if (Number.isNaN(when.getTime())) {
      showErr('Data e ora non valide.');
      return;
    }
    // Solo i campi cambiati: così non si riscrive nulla che l'Admin non ha toccato
    const patch = {};
    if (draft.tipo !== h.tipo) patch.tipo = draft.tipo;
    if (draft.product_id !== h.product_id) patch.product_id = draft.product_id;
    if (draft.user_id !== h.user_id) patch.user_id = draft.user_id;
    if (qty !== h.quantita) patch.quantita = qty;
    if (f('data_ora').value !== toLocalInput(h.data_ora)) patch.data_ora = when.toISOString();
    ['punto_utilizzo_specifico', 'linea', 'macchinario', 'locazione', 'note'].forEach((k) => {
      const v = f(k).value.trim() || null;
      if (v !== (h[k] || null)) patch[k] = v;
    });
    if (!Object.keys(patch).length) {
      close();
      return;
    }
    setButtonBusy(saveBtn, true, 'Salvataggio…');
    try {
      await updateTransaction(h.id, patch);
      feedback.confirmAction();
      toastSuccess('Movimento aggiornato.');
      close();
      loadIdlePanel(); // "ultimi movimenti" in Scanner deve aggiornarsi subito
      await refreshHistory();
    } catch (ex) {
      console.error(ex);
      feedback.errorAction();
      showErr(ex.message || 'Errore durante il salvataggio.');
    } finally {
      setButtonBusy(saveBtn, false);
    }
  });

  openOverlay(overlay);
  window.lucide?.createIcons();
}

function updateActionBar() {
  const n = selected.size;
  els.actionBar.classList.toggle('hidden', n === 0);
  if (els.count) els.count.textContent = n === 1 ? '1 selezionato' : `${n} selezionati`;
  if (els.deleteBtn) els.deleteBtn.disabled = n === 0;
}

async function handleDeleteSelected() {
  const ids = Array.from(selected);
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: ids.length === 1 ? 'Eliminare il movimento?' : `Eliminare ${ids.length} movimenti?`,
    message: 'Eliminati per sempre dallo storico. La giacenza non cambia.',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return;

  setButtonBusy(els.deleteBtn, true, 'Eliminazione…');
  try {
    await deleteTransactions(ids);
    feedback.confirmAction();
    toastSuccess(ids.length === 1 ? 'Movimento eliminato.' : `${ids.length} movimenti eliminati.`);
    loadIdlePanel(); // "ultimi movimenti" in Scanner deve aggiornarsi subito
    await refreshHistory();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError('Errore durante l\'eliminazione.');
    setButtonBusy(els.deleteBtn, false);
  }
}
