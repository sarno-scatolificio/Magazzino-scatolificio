// =============================================================
// scanner-idle.js — Pannello iniziale: sotto-scorta e ultimi movimenti
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { animateNumber, emptyStateHtml } from '../../shared/ui-utils.js';
import { els } from './scanner-shared.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { listProducts, listTransactions } from '../../data/supabase.js';
import { refreshPrestitiCount } from './prestiti.js';
import { movementRow } from './movements.js';

const RECENT_COUNT = 3; // poche voci: Deposito e Prelievo restano visibili senza scorrere

/**
 * Riempie il pannello mostrato prima di scegliere Deposito/Prelievo, cosí
 * la schermata iniziale non resta vuota: conteggio sotto-scorta e ultimi
 * movimenti registrati, a colpo d'occhio prima ancora di scansionare.
 */
export async function loadIdlePanel() {
  if (!els.recentListEl) return; // non ancora inizializzato (caso limite)
  try {
    const [lowStock, recent] = await Promise.all([listProducts({ onlyLowStock: true }), listTransactions({ limit: RECENT_COUNT })]);
    animateNumber(els.lowStockCountEl, lowStock.length, { duration: 500 });
    renderRecent(recent);
    refreshPrestitiCount();
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

  // Ogni voce si apre al tocco con i dettagli (scaffale, linea, macchina, note), come nell'elenco completo
  rows.forEach((r, i) => {
    const row = movementRow(r, i, els.recentListEl, { compact: true });
    row.classList.remove('border-b');
    els.recentListEl.appendChild(row);
  });
  window.lucide?.createIcons();
}
