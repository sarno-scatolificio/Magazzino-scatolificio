// =============================================================
// movements.js — Modale "Movimenti" (Admin e Operatore, sola lettura)
// Tutti i depositi/prelievi con tab Tutti/Depositi/Prelievi, chi li ha
// effettuati, e un dettaglio a comparsa (accordion) toccando la riga.
// La cancellazione dei movimenti resta uno strumento distinto, riservato
// all'Admin (Impostazioni → Zona pericolosa → history-admin.js).
// =============================================================

import { listTransactions } from '../../data/supabase.js';
import { toastError } from '../../shared/toast.js';
import { staggerIndex, emptyStateHtml, openOverlay, closeOverlay, enableSheetDrag, animatePanelHeight, syncSegIndicator } from '../../shared/ui-utils.js';
import { escapeHtml } from '../../shared/html-utils.js';

const els = {};

// Icone di categoria (al posto del vecchio tag testuale): cuscinetto, cinghia dentata ad anello, ingranaggio
const CAT_ICONS = {
  cuscinetti: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3"/><circle cx="18.2" cy="12" r="1.1"/><circle cx="15.1" cy="17.4" r="1.1"/><circle cx="8.9" cy="17.4" r="1.1"/><circle cx="5.8" cy="12" r="1.1"/><circle cx="8.9" cy="6.6" r="1.1"/><circle cx="15.1" cy="6.6" r="1.1"/>',
  cinghie: '<ellipse cx="12" cy="9.5" rx="10" ry="5" transform="rotate(-20 12 9.5)"/><ellipse cx="12" cy="9.5" rx="7.4" ry="3.1" transform="rotate(-20 12 9.5)"/><path d="M2.45 12.02V15.52A10 5 -20 0 0 21.55 10.48V6.98"/><path d="M17.5 5.85v1.8M15.12 5.66v1.8M12.17 6.19v1.8M9.18 7.35v1.8M6.72 8.9v1.8M5.24 10.56v1.6" stroke-width="1.3"/>',
  pezzi_ricambio: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};
const CAT_LABELS = { cuscinetti: 'Cuscinetto', cinghie: 'Cinghia', pezzi_ricambio: 'Ricambio tecnico' };
let rows = [];
let filter = 'tutti'; // 'tutti' | 'deposito' | 'prelievo'
let openId = null; // id della riga con il dettaglio aperto (una sola alla volta)

export function initMovements() {
  els.modal = document.getElementById('movements-modal');
  els.openBtn = document.getElementById('scanner-movements-viewall-btn');
  els.closeBtn = document.getElementById('movements-modal-close');
  els.tabs = document.querySelectorAll('[data-movements-tab]');
  els.seg = document.getElementById('movements-seg');
  els.skeleton = document.getElementById('movements-list-skeleton');
  els.list = document.getElementById('movements-list');

  els.openBtn?.addEventListener('click', () => {
    openOverlay(els.modal);
    syncSegIndicator(els.seg); // l'indicatore si posiziona sul pulsante attivo appena la modale è visibile
    refresh();
  });
  els.closeBtn?.addEventListener('click', () => closeOverlay(els.modal));
  els.modal?.addEventListener('click', (e) => {
    if (e.target === els.modal) closeOverlay(els.modal);
  });
  enableSheetDrag(els.modal?.querySelector('.modal-panel'), () => closeOverlay(els.modal));

  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.movementsTab;
      els.tabs.forEach((b) => b.classList.toggle('category-tab-active', b === btn));
      syncSegIndicator(els.seg); // il rettangolo blu scorre lateralmente sul nuovo pulsante
      // Il cassetto sale/scende animato alla nuova altezza invece di scattare.
      animatePanelHeight(els.modal?.querySelector('.modal-panel'), render);
    });
  });
}

async function refresh() {
  openId = null;
  els.skeleton.classList.remove('hidden');
  els.list.classList.add('hidden');
  try {
    rows = await listTransactions({ limit: 300 });
    render();
  } catch (err) {
    console.error(err);
    els.list.innerHTML = emptyStateHtml('wifi-off', 'Connessione assente', 'Controlla la rete e riprova.');
    toastError('Errore nel caricamento dei movimenti.');
  } finally {
    els.skeleton.classList.add('hidden');
    els.list.classList.remove('hidden');
  }
}

function filtered() {
  if (filter === 'tutti') return rows;
  return rows.filter((r) => r.tipo === filter);
}

function render() {
  const list = filtered();
  els.list.innerHTML = '';
  if (list.length === 0) {
    els.list.innerHTML = emptyStateHtml('inbox', 'Nessun movimento', 'Non risultano movimenti per questo filtro.');
    window.lucide?.createIcons();
    return;
  }
  list.forEach((r, i) => els.list.appendChild(movementRow(r, i)));
  window.lucide?.createIcons();
}

/** Riga di un movimento che si apre al tocco (una sola aperta alla volta dentro `container`). Usata anche dagli ultimi movimenti. */
export function movementRow(r, i, container = els.list, { compact = false } = {}) {
  const date = new Date(r.data_ora);
  const wrap = document.createElement('div');
  wrap.className = 'list-item-in border-b border-graphite-800 last:border-0';
  wrap.style.setProperty('--i', staggerIndex(i));

  // Icona della categoria; per i ricambi tecnici anche la descrizione (il solo codice non dice di che pezzo si tratta)
  const cat = r.products?.categoria || '';
  const icon = CAT_ICONS[cat]
    ? `<span class="mv-ic mv-ic--${cat}" role="img" aria-label="${CAT_LABELS[cat]}" title="${CAT_LABELS[cat]}"><svg viewBox="0 0 24 24" aria-hidden="true">${CAT_ICONS[cat]}</svg></span>`
    : '';
  // Ricambio tecnico: in evidenza (grassetto) la descrizione al posto del codice; il codice si legge in piccolo aprendo il movimento
  // Il nome di un ricambio è il «punto di utilizzo» (come nell'elenco articoli); la colonna «descrizione» c'è solo se compilata
  const desc = cat === 'pezzi_ricambio' ? (r.products?.punto_utilizzo_standard || r.products?.descrizione || '').trim() : '';
  const code = r.products?.codice_articolo || '';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = `w-full flex items-center gap-3 ${compact ? 'py-1.5' : 'py-2.5'} px-1 text-left`;
  head.innerHTML = `
    ${icon}
    <div class="mv-text min-w-0 flex-1">
      <p class="text-sm text-graphite-100 ${desc ? 'font-bold' : 'font-medium'}">${escapeHtml(desc || code || '—')}</p>
      <p class="ui-note text-graphite-500 mt-0.5">${escapeHtml(r.profiles?.full_name || 'Utente')} · ${date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}</p>
    </div>
    <span class="shrink-0 font-mono text-sm font-semibold px-2.5 py-1 rounded-full ${
      r.tipo === 'deposito' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-300'
    }">${r.tipo === 'deposito' ? '+' : '−'}${r.quantita}</span>
    <i data-lucide="chevron-down" class="movement-chev w-4 h-4 text-graphite-500 shrink-0 transition-transform"></i>
  `;

  const track = document.createElement('div');
  track.className = 'acc-track';
  const inner = document.createElement('div');
  inner.className = 'acc-inner';
  const detailRows = [
    ['Scaffale', r.locazione],
    ['Punto di utilizzo', r.punto_utilizzo_specifico],
    ['Linea', r.linea === 'REP' ? 'Reparto' : r.linea],
    ['Macchina', r.macchinario],
    ['Note', r.note],
  ].filter(([, v]) => v);
  if (desc && code) detailRows.unshift(['Codice', code]);
  inner.innerHTML = `<div class="pl-1 pr-2 pb-3 pt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">${detailRows
    .map(([label, val]) => `<span class="ui-note text-graphite-500">${escapeHtml(label)}</span><span class="${label === 'Codice' ? 'font-mono text-xs text-graphite-400' : 'text-sm text-graphite-200'} mv-text min-w-0">${escapeHtml(val)}</span>`)
    .join('')}</div>${detailRows.length === 0 ? '<p class="ui-note text-graphite-500 pb-3 pl-1">Nessun altro dettaglio.</p>' : ''}`;
  track.appendChild(inner);

  head.addEventListener('click', () => {
    const isOpen = track.classList.contains('acc-open');
    openId = isOpen ? null : r.id;
    // Un solo dettaglio aperto alla volta: si richiudono tutti gli altri accordion visibili.
    container.querySelectorAll('.acc-track.acc-open').forEach((t) => t.classList.remove('acc-open'));
    container.querySelectorAll('.movement-chev').forEach((c) => c.classList.remove('rotate-180'));
    if (!isOpen) {
      track.classList.add('acc-open');
      head.querySelector('.movement-chev')?.classList.add('rotate-180');
    }
  });

  wrap.append(head, track);
  return wrap;
}
