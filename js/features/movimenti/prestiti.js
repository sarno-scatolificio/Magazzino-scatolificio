// =============================================================
// prestiti.js — Prestiti in sospeso e reintegro (Movimenti)
// =============================================================
// Un prelievo segnato come "Prestito" (con a chi è stato dato) resta qui, in sospeso,
// finché non viene reintegrato: il pezzo torna sullo scaffale con un deposito.

import { bumpProductsVersion, countPrestitiAperti, listPrestiti, reintegraPrestito } from '../../data/supabase.js';
import { closeOverlay, emptyStateHtml, enableSheetDrag, openOverlay, setButtonBusy, staggerIndex, syncSegIndicator } from '../../shared/ui-utils.js';
import { confirmDialog } from '../../shared/ui-modal.js';
import { escapeHtml } from '../../shared/html-utils.js';
import feedback from '../../shared/feedback.js';
import { isAdmin } from '../../core/auth.js';
import { toastError, toastSuccess } from '../../shared/toast.js';

const els = {};
let tab = 'aperti'; // 'aperti' | 'reintegrati'
let seq = 0;

const fmt = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function initPrestiti() {
  els.modal = document.getElementById('prestiti-modal');
  els.openBtn = document.getElementById('scanner-prestiti-btn');
  els.count = document.getElementById('scanner-prestiti-count');
  els.closeBtn = document.getElementById('prestiti-modal-close');
  els.seg = document.getElementById('prestiti-seg');
  els.skeleton = document.getElementById('prestiti-skeleton');
  els.list = document.getElementById('prestiti-list');
  if (!els.modal || !els.openBtn) return;

  els.openBtn.addEventListener('click', () => {
    if (!isAdmin()) return;
    feedback.tap();
    openOverlay(els.modal);
    syncSegIndicator(els.seg);
    load();
  });
  els.closeBtn.addEventListener('click', () => closeOverlay(els.modal));
  els.modal.addEventListener('click', (e) => e.target === els.modal && closeOverlay(els.modal));
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => closeOverlay(els.modal));
  els.seg.querySelectorAll('[data-prestiti-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      tab = btn.dataset.prestitiTab;
      els.seg.querySelectorAll('[data-prestiti-tab]').forEach((b) => b.classList.toggle('category-tab-active', b === btn));
      syncSegIndicator(els.seg);
      feedback.modeSelect();
      load();
    })
  );
  refreshPrestitiCount();
}

/** Aggiorna il numero di prestiti in sospeso mostrato nel pannello iniziale (errori ignorati) */
export async function refreshPrestitiCount() {
  if (!els.count || !isAdmin()) return; // i prestiti li vede e gestisce solo l'admin
  try {
    const n = await countPrestitiAperti();
    els.count.textContent = n ? String(n) : '0';
  } catch (err) {
    console.warn('Conteggio prestiti non disponibile.', err);
  }
}

async function load() {
  const mine = ++seq;
  els.skeleton.classList.remove('hidden');
  els.list.classList.add('hidden');
  try {
    const rows = await listPrestiti({ reintegrati: tab === 'reintegrati' });
    if (mine !== seq) return;
    render(rows);
  } catch (err) {
    if (mine !== seq) return;
    console.error(err);
    els.list.innerHTML = emptyStateHtml('wifi-off', 'Impossibile leggere i prestiti', 'Controlla la connessione e riprova.');
    window.lucide?.createIcons();
    toastError('Errore nel caricamento dei prestiti.');
  } finally {
    if (mine === seq) {
      els.skeleton.classList.add('hidden');
      els.list.classList.remove('hidden');
    }
  }
}

function render(rows) {
  els.list.innerHTML = '';
  if (!rows.length) {
    els.list.innerHTML =
      tab === 'aperti'
        ? emptyStateHtml('handshake', 'Nessun prestito in sospeso', 'Nel Prelievo attiva "Prestito" e indica a chi viene dato.')
        : emptyStateHtml('history', 'Nessun prestito reintegrato', 'I prestiti riportati in magazzino compariranno qui.');
    window.lucide?.createIcons();
    return;
  }
  rows.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'list-item-in rounded-xl border border-graphite-700 bg-graphite-800/40 p-3 mb-2';
    card.style.setProperty('--i', staggerIndex(i));
    const open = !p.reintegrato_at;
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-display font-bold leading-tight break-words">${escapeHtml(p.codice_articolo)}</p>
          <p class="text-sm text-graphite-200 mt-0.5 break-words">A: <strong>${escapeHtml(p.destinatario)}</strong></p>
          <p class="ui-note text-graphite-500 mt-1">Dato il ${escapeHtml(fmt(p.created_at))}${p.created_by_name ? ` · ${escapeHtml(p.created_by_name)}` : ''}${p.locazione ? ` · Scaffale ${escapeHtml(p.locazione)}` : ''}</p>
          ${open ? '' : `<p class="ui-note text-emerald-700 mt-0.5">Reintegrato il ${escapeHtml(fmt(p.reintegrato_at))}${p.reintegrato_by_name ? ` · ${escapeHtml(p.reintegrato_by_name)}` : ''}</p>`}
        </div>
        <span class="shrink-0 font-mono text-sm font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300">×${p.quantita}</span>
      </div>
      ${open ? '<button type="button" data-reintegra class="press-spring mt-3 w-full min-h-[44px] rounded-lg bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide text-sm">Reintegra in magazzino</button>' : ''}`;
    card.querySelector('[data-reintegra]')?.addEventListener('click', (ev) => reintegra(p, ev.currentTarget));
    els.list.appendChild(card);
  });
}

async function reintegra(p, btn) {
  feedback.tap();
  const ok = await confirmDialog({
    title: 'Reintegrare il prestito?',
    message: `${p.quantita} × ${p.codice_articolo} prestato a ${p.destinatario} torna in magazzino${p.locazione ? ` (scaffale ${p.locazione})` : ''}.`,
    confirmLabel: 'Reintegra',
  });
  if (!ok) return;
  setButtonBusy(btn, true, 'Reintegro…');
  try {
    const res = await reintegraPrestito(p.id);
    feedback.transactionDeposito();
    toastSuccess(`Reintegrato: ${res?.codice_articolo || p.codice_articolo} → nuova giacenza ${res?.nuova_giacenza ?? ''}`.trim(), 3500);
    bumpProductsVersion();
    refreshPrestitiCount();
    await load();
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    toastError(/già stato reintegrato/.test(err?.message || '') ? 'Questo prestito risulta già reintegrato.' : 'Reintegro non riuscito. Controlla la connessione e riprova.', 5000);
    setButtonBusy(btn, false);
    load();
  }
}
