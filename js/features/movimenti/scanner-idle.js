// =============================================================
// scanner-idle.js — Pannello iniziale: sotto-scorta e ultimi movimenti
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { animateNumber, emptyStateHtml } from '../../shared/ui-utils.js';
import { els } from './scanner-shared.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { listProducts, listTransactions } from '../../data/supabase.js';

/**
 * Riempie il pannello mostrato prima di scegliere Deposito/Prelievo, cosí
 * la schermata iniziale non resta vuota: conteggio sotto-scorta e ultimi
 * movimenti registrati, a colpo d'occhio prima ancora di scansionare.
 */
export async function loadIdlePanel() {
  if (!els.recentListEl) return; // non ancora inizializzato (caso limite)
  try {
    const [lowStock, recent] = await Promise.all([listProducts({ onlyLowStock: true }), listTransactions({ limit: 5 })]);
    animateNumber(els.lowStockCountEl, lowStock.length, { duration: 500 });
    renderRecent(recent);
  } catch (err) {
    console.error(err);
  }
}

function renderRecent(rows) {
  els.recentListEl.innerHTML = '';
  if (!rows || rows.length === 0) {
    els.recentEmptyEl.innerHTML = emptyStateHtml('history', 'Nessun movimento', 'I depositi e i prelievi registrati compariranno qui.');
    els.recentEmptyEl.classList.remove('hidden');
    window.lucide?.createIcons();
    return;
  }
  els.recentEmptyEl.classList.add('hidden');

  rows.forEach((r, i) => {
    const date = new Date(r.data_ora);
    const row = document.createElement('div');
    row.className = 'list-item-in flex items-center justify-between gap-3 py-1.5 border-t border-graphite-800 first:border-t-0 first:pt-0';
    row.style.setProperty('--i', i);
    row.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm text-graphite-100 truncate font-medium">${escapeHtml(r.products?.codice_articolo || '—')}</p>
        <p class="ui-note text-graphite-500 mt-0.5 truncate">${escapeHtml(r.profiles?.full_name || 'Utente')} · ${date.toLocaleString('it-IT', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}</p>
      </div>
      <span class="shrink-0 font-mono text-xs font-semibold px-2 py-0.5 rounded-full ${
        r.tipo === 'deposito' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-300'
      }">${r.tipo === 'deposito' ? '+' : '−'}${r.quantita}</span>
    `;
    els.recentListEl.appendChild(row);
  });
}
