// =============================================================
// scanner-idle.js — Pannello iniziale: sotto-scorta e ultimi movimenti
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { animateNumber, emptyStateHtml } from '../../shared/ui-utils.js';
import { els } from './scanner-shared.js';
import { listProducts, listTransactions } from '../../data/supabase.js';
import { refreshPrestitiCount } from './prestiti.js';
import { movementRow } from './movements.js';

const RECENT_VISIBLE = 4; // voci viste senza scorrere: Deposito e Prelievo restano visibili
const RECENT_DAYS = 30; // l'elenco scorre e contiene i movimenti degli ultimi 30 giorni
const RECENT_MAX = 1000; // tetto di righe per richiesta del server

/**
 * Riempie il pannello mostrato prima di scegliere Deposito/Prelievo, cosí
 * la schermata iniziale non resta vuota: conteggio sotto-scorta e ultimi
 * movimenti registrati, a colpo d'occhio prima ancora di scansionare.
 */
export async function loadIdlePanel() {
  if (!els.recentListEl) return; // non ancora inizializzato (caso limite)
  try {
    const [lowStock, recent] = await Promise.all([listProducts({ onlyLowStock: true }), listTransactions({ from: new Date(Date.now() - RECENT_DAYS * 86400000).toISOString(), limit: RECENT_MAX })]);
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
  fitRecentList();
}

/**
 * L'elenco mostra 4 voci per intero e scorre per le altre: l'altezza si misura sulle prime 4 righe reali
 * (hanno altezze diverse a seconda dei testi). Se la scheda non è visibile la misura vale 0 e resta
 * l'altezza di ripiego del CSS. Una sfumatura in fondo segnala che c'è altro da scorrere.
 */
function fitRecentList() {
  const el = els.recentListEl;
  if (!el) return;
  const kids = [...el.children];
  el.dataset.more = '0';
  if (kids.length <= RECENT_VISIBLE) {
    el.style.maxHeight = 'none'; // poche voci: nessun limite, il dettaglio aperto può allungare la scheda
    return;
  }
  const last = kids[RECENT_VISIBLE - 1];
  const h = last.offsetTop + last.offsetHeight - kids[0].offsetTop;
  if (h > 0 && el.clientWidth > 0) {
    el.style.maxHeight = `${h}px`;
    el.dataset.fitW = String(el.clientWidth);
  } else {
    el.style.maxHeight = ''; // scheda non visibile: vale l'altezza di ripiego del CSS, si rimisura appena compare
  }
  paintRecentMore();
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('scroll', paintRecentMore, { passive: true });
    // Aprendo il dettaglio di una voce in basso, l'elenco scorre quanto basta per mostrarlo tutto
    el.addEventListener('click', () => {
      setTimeout(() => {
        const open = el.querySelector('.acc-track.acc-open');
        if (!open) return;
        const over = open.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
        if (over > 0) el.scrollBy({ top: over + 8, behavior: 'smooth' });
      }, 260);
    });
    // La scheda può comparire dopo il caricamento (vista Movimenti nascosta) o cambiare larghezza (rotazione): si rimisura
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (el.clientWidth > 0 && el.dataset.fitW !== String(el.clientWidth)) fitRecentList();
      }).observe(el);
    }
  }
}

function paintRecentMore() {
  const el = els.recentListEl;
  if (!el) return;
  const more = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
  el.dataset.more = more ? '1' : '0';
}
