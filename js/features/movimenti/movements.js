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

// Icone di categoria (al posto del vecchio tag testuale): cuscinetto, cinghia ad anello a «8», ingranaggio
const CAT_ICONS = {
  cuscinetti: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3"/><circle cx="18.2" cy="12" r="1.1"/><circle cx="15.1" cy="17.4" r="1.1"/><circle cx="8.9" cy="17.4" r="1.1"/><circle cx="5.8" cy="12" r="1.1"/><circle cx="8.9" cy="6.6" r="1.1"/><circle cx="15.1" cy="6.6" r="1.1"/>',
  // Cinghia ad anello chiuso a «8»: due linee parallele (fascia) con sovrapposizione al centro; il colore del riquadro (--mv-tile) fa da sfondo
  cinghie: '<g transform="rotate(-45 12 12)"><path d="M21.70 12.00 L21.66 12.76 L21.54 13.50 L21.35 14.19 L21.09 14.84 L20.78 15.41 L20.42 15.90 L20.03 16.31 L19.60 16.64 L19.17 16.88 L18.72 17.04 L18.27 17.13 L17.83 17.14 L17.40 17.10 L16.98 17.00 L16.57 16.85 L16.18 16.66 L15.81 16.44 L15.45 16.18 L15.10 15.90 L14.77 15.60 L14.45 15.28 L14.15 14.95 L13.86 14.60 L13.57 14.25 L13.30 13.88 L13.03 13.51 L12.77 13.14 L12.51 12.76 L12.25 12.38 L12.00 12.00 L11.75 11.62 L11.49 11.24 L11.23 10.86 L10.97 10.49 L10.70 10.12 L10.43 9.75 L10.14 9.40 L9.85 9.05 L9.55 8.72 L9.23 8.40 L8.90 8.10 L8.55 7.82 L8.19 7.56 L7.82 7.34 L7.43 7.15 L7.02 7.00 L6.60 6.90 L6.17 6.86 L5.73 6.87 L5.28 6.96 L4.83 7.12 L4.40 7.36 L3.97 7.69 L3.58 8.10 L3.22 8.59 L2.91 9.16 L2.65 9.81 L2.46 10.50 L2.34 11.24 L2.30 12.00 L2.34 12.76 L2.46 13.50 L2.65 14.19 L2.91 14.84 L3.22 15.41 L3.58 15.90 L3.97 16.31 L4.40 16.64 L4.83 16.88 L5.28 17.04 L5.73 17.13 L6.17 17.14 L6.60 17.10 L7.02 17.00 L7.43 16.85 L7.82 16.66 L8.19 16.44 L8.55 16.18 L8.90 15.90 L9.23 15.60 L9.55 15.28 L9.85 14.95 L10.14 14.60 L10.43 14.25 L10.70 13.88 L10.97 13.51 L11.23 13.14 L11.49 12.76 L11.75 12.38 L12.00 12.00 L12.25 11.62 L12.51 11.24 L12.77 10.86 L13.03 10.49 L13.30 10.12 L13.57 9.75 L13.86 9.40 L14.15 9.05 L14.45 8.72 L14.77 8.40 L15.10 8.10 L15.45 7.82 L15.81 7.56 L16.18 7.34 L16.57 7.15 L16.98 7.00 L17.40 6.90 L17.83 6.86 L18.27 6.87 L18.72 6.96 L19.17 7.12 L19.60 7.36 L20.03 7.69 L20.42 8.10 L20.78 8.59 L21.09 9.16 L21.35 9.81 L21.54 10.50 L21.66 11.24 L21.70 12.00Z" stroke="currentColor" stroke-width="2.7"/><path d="M21.70 12.00 L21.66 12.76 L21.54 13.50 L21.35 14.19 L21.09 14.84 L20.78 15.41 L20.42 15.90 L20.03 16.31 L19.60 16.64 L19.17 16.88 L18.72 17.04 L18.27 17.13 L17.83 17.14 L17.40 17.10 L16.98 17.00 L16.57 16.85 L16.18 16.66 L15.81 16.44 L15.45 16.18 L15.10 15.90 L14.77 15.60 L14.45 15.28 L14.15 14.95 L13.86 14.60 L13.57 14.25 L13.30 13.88 L13.03 13.51 L12.77 13.14 L12.51 12.76 L12.25 12.38 L12.00 12.00 L11.75 11.62 L11.49 11.24 L11.23 10.86 L10.97 10.49 L10.70 10.12 L10.43 9.75 L10.14 9.40 L9.85 9.05 L9.55 8.72 L9.23 8.40 L8.90 8.10 L8.55 7.82 L8.19 7.56 L7.82 7.34 L7.43 7.15 L7.02 7.00 L6.60 6.90 L6.17 6.86 L5.73 6.87 L5.28 6.96 L4.83 7.12 L4.40 7.36 L3.97 7.69 L3.58 8.10 L3.22 8.59 L2.91 9.16 L2.65 9.81 L2.46 10.50 L2.34 11.24 L2.30 12.00 L2.34 12.76 L2.46 13.50 L2.65 14.19 L2.91 14.84 L3.22 15.41 L3.58 15.90 L3.97 16.31 L4.40 16.64 L4.83 16.88 L5.28 17.04 L5.73 17.13 L6.17 17.14 L6.60 17.10 L7.02 17.00 L7.43 16.85 L7.82 16.66 L8.19 16.44 L8.55 16.18 L8.90 15.90 L9.23 15.60 L9.55 15.28 L9.85 14.95 L10.14 14.60 L10.43 14.25 L10.70 13.88 L10.97 13.51 L11.23 13.14 L11.49 12.76 L11.75 12.38 L12.00 12.00 L12.25 11.62 L12.51 11.24 L12.77 10.86 L13.03 10.49 L13.30 10.12 L13.57 9.75 L13.86 9.40 L14.15 9.05 L14.45 8.72 L14.77 8.40 L15.10 8.10 L15.45 7.82 L15.81 7.56 L16.18 7.34 L16.57 7.15 L16.98 7.00 L17.40 6.90 L17.83 6.86 L18.27 6.87 L18.72 6.96 L19.17 7.12 L19.60 7.36 L20.03 7.69 L20.42 8.10 L20.78 8.59 L21.09 9.16 L21.35 9.81 L21.54 10.50 L21.66 11.24 L21.70 12.00Z" style="stroke:var(--mv-tile)" stroke-width="1.2"/><g stroke-linecap="butt"><path d="M8.61 16.14 L8.98 15.83 L9.33 15.50 L9.66 15.15 L9.99 14.79 L10.30 14.41 L10.60 14.02 L10.89 13.63 L11.17 13.22 L11.45 12.82 L11.73 12.41 L12.00 12.00 L12.27 11.59 L12.55 11.18 L12.83 10.78 L13.11 10.37 L13.40 9.98 L13.70 9.59 L14.01 9.21 L14.34 8.85 L14.67 8.50 L15.02 8.17 L15.39 7.86" style="stroke:var(--mv-tile)" stroke-width="3.9"/><path d="M6.92 17.03 L7.37 16.88 L7.79 16.68 L8.20 16.43 L8.59 16.16 L8.96 15.85 L9.31 15.52 L9.65 15.17 L9.98 14.80 L10.29 14.42 L10.59 14.03 L10.88 13.63 L11.17 13.23 L11.45 12.82 L11.72 12.41 L12.00 12.00 L12.28 11.59 L12.55 11.18 L12.83 10.77 L13.12 10.37 L13.41 9.97 L13.71 9.58 L14.02 9.20 L14.35 8.83 L14.69 8.48 L15.04 8.15 L15.41 7.84 L15.80 7.57 L16.21 7.32 L16.63 7.12 L17.08 6.97" stroke="currentColor" stroke-width="2.7"/><path d="M6.92 17.03 L7.37 16.88 L7.79 16.68 L8.20 16.43 L8.59 16.16 L8.96 15.85 L9.31 15.52 L9.65 15.17 L9.98 14.80 L10.29 14.42 L10.59 14.03 L10.88 13.63 L11.17 13.23 L11.45 12.82 L11.72 12.41 L12.00 12.00 L12.28 11.59 L12.55 11.18 L12.83 10.77 L13.12 10.37 L13.41 9.97 L13.71 9.58 L14.02 9.20 L14.35 8.83 L14.69 8.48 L15.04 8.15 L15.41 7.84 L15.80 7.57 L16.21 7.32 L16.63 7.12 L17.08 6.97" style="stroke:var(--mv-tile)" stroke-width="1.2"/></g></g>',
  pezzi_ricambio: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};
/** Riquadro con l'icona della categoria (stessa degli ultimi movimenti; usata anche dai risultati della ricerca rapida) */
export function catIconHtml(cat) {
  return CAT_ICONS[cat]
    ? `<span class="mv-ic mv-ic--${cat}" role="img" aria-label="${CAT_LABELS[cat]}" title="${CAT_LABELS[cat]}"><svg viewBox="0 0 24 24" aria-hidden="true">${CAT_ICONS[cat]}</svg></span>`
    : '';
}
/** Fa scorrere da solo un titolo `.mv-title` troppo lungo per lo spazio disponibile (si ricalcola da solo se il riquadro cambia dimensione) */
export function observeMarquee(box) {
  if (box && mvResize) mvResize.observe(box);
}

/**
 * Titolo lungo: scorre da solo avanti e indietro (CSS .mv-title.is-marquee). Si ricalcola quando il riquadro cambia
 * dimensione (rotazione, apertura dell'elenco), perché a elemento nascosto la larghezza è zero.
 */
function fitMarquee(box) {
  const inner = box.firstElementChild;
  if (!inner) return;
  if (!box.isConnected) { mvResize?.unobserve(box); return; }
  const w = box.clientWidth;
  if (!w) return;
  const dist = Math.ceil(inner.offsetWidth - w);
  if (dist > 2) {
    box.style.setProperty('--mv-d', `-${dist}px`);
    box.style.setProperty('--mv-t', `${Math.min(28, Math.max(6, dist / 9))}s`); // ~28 px/s, con una sosta a ogni estremo
    box.classList.add('is-marquee');
  } else {
    box.classList.remove('is-marquee');
  }
}
const mvResize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => fitMarquee(e.target))) : null;

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
  const icon = catIconHtml(cat);
  // Ricambio tecnico: in evidenza (grassetto) la descrizione al posto del codice; il codice si legge in piccolo aprendo il movimento
  // Il nome di un ricambio è il «punto di utilizzo» (come nell'elenco articoli); la colonna «descrizione» c'è solo se compilata
  const desc = cat === 'pezzi_ricambio' ? (r.products?.punto_utilizzo_standard || r.products?.descrizione || '').trim() : '';
  const code = r.products?.codice_articolo || '';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = `w-full flex items-center gap-3 ${compact ? 'py-1.5' : 'py-2.5'} px-1 text-left`;
  head.innerHTML = `
    ${icon}
    <div class="min-w-0 flex-1">
      <p class="mv-title text-sm text-graphite-100 ${desc ? 'font-normal' : 'font-medium'}"><span class="mv-title-in">${escapeHtml(desc || code || '—')}</span></p>
      <p class="ui-note text-graphite-500 mt-0.5 truncate">${escapeHtml(r.profiles?.full_name || 'Utente')} · ${date.toLocaleString('it-IT', {
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
    .map(([label, val]) => `<span class="ui-note text-graphite-500">${escapeHtml(label)}</span><span class="${label === 'Codice' ? 'font-mono text-xs text-graphite-400' : 'text-sm text-graphite-200'} min-w-0 break-words">${escapeHtml(val)}</span>`)
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
  const title = head.querySelector('.mv-title');
  if (title && mvResize) mvResize.observe(title); // calcola se serve lo scorrimento automatico (anche appena l'elenco diventa visibile)
  return wrap;
}
