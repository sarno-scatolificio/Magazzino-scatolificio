// =============================================================
// products-table.js — Magazzino su desktop (≥1024px): tabella articoli + pannello di dettaglio a destra.
// Sostituisce, solo su schermi larghi, le schede per scaffale/macchina. I dati sono quelli già caricati
// (state.currentList, con ricerca e filtri applicati): qui si disegnano soltanto. Scheda completa,
// Deposito e Prelievo usano gli stessi flussi di sempre (openDetail, startMovement).
// Tastiera: ↑ ↓ scorrono · Invio apre la scheda · P prelievo · D deposito
// =============================================================

import { escapeHtml } from './products-shared.js';
import { openDetail } from './products-detail.js';
import { startMovement } from '../movimenti/scanner.js';
import { staggerIndex } from '../../shared/ui-utils.js';
import feedback from '../../shared/feedback.js';

const MQ = window.matchMedia('(min-width: 1024px)');
export const isDesktopTable = () => MQ.matches;

let host = null;
let rows = []; // [{ p, shelf, qty, low }]
let selId = null;
let wired = false;

const natural = (a, b) => String(a || '').localeCompare(String(b || ''), 'it', { numeric: true, sensitivity: 'base' });
const firstLoc = (r) => r.locs.find((l) => l.locazione)?.locazione || '';

/** Disegna la tabella. `mode`: 'shelf' ordina per scaffale, 'machine' per macchina. `locsOf`: scaffali dell'articolo nell'area scelta. */
export function renderProductTable({ list, mode, locsOf }) {
  host = host || document.getElementById('product-table-view');
  if (!host) return;
  rows = list.map((p) => {
    const locs = locsOf(p);
    return {
      p,
      locs,
      shelf: locs.map((l) => (l.locazione ? (locs.length > 1 ? `${l.locazione} (${l.quantita})` : l.locazione) : 'Non assegnata')).join(' · '),
      qty: locs.reduce((s, l) => s + (Number(l.quantita) || 0), 0),
      low: p.quantita_disponibile < p.scorta_minima,
    };
  });
  rows.sort(mode === 'machine' ? (a, b) => natural(a.p.macchina, b.p.macchina) || natural(a.p.codice_articolo, b.p.codice_articolo) : (a, b) => natural(firstLoc(a), firstLoc(b)) || natural(a.p.codice_articolo, b.p.codice_articolo));
  if (!rows.some((r) => r.p.id === selId)) selId = rows[0]?.p.id ?? null;

  const head = `<div class="pt-row pt-head"><span>Codice</span><span>Macchina · punto di utilizzo</span><span>Scaffale</span><span class="pt-num">Giac.</span></div>`;
  const body = rows
    .map((r, i) => {
      const sub = [r.p.macchina, r.p.punto_utilizzo_standard, r.p.linea].filter(Boolean).join(' · ');
      return `<div class="pt-row pt-item list-item-in${r.p.id === selId ? ' pt-sel' : ''}" data-pid="${escapeHtml(r.p.id)}" style="--i:${staggerIndex(Math.min(i, 14))}">
        <span class="pt-code">${escapeHtml(r.p.codice_articolo)}</span><span class="pt-sub">${escapeHtml(sub) || '—'}</span>
        <span class="pt-shelf">${escapeHtml(r.shelf) || '—'}</span><span class="pt-num${r.low ? ' pt-low' : ''}">${r.qty}${r.low ? ' ▾' : ''}</span></div>`;
    })
    .join('');
  host.innerHTML = `<div class="pt-main"><div class="pt-card" role="grid" aria-label="Articoli">${head}${body}</div>
    <p class="pt-hint"><kbd>↑</kbd><kbd>↓</kbd> scorri &nbsp; <kbd>Invio</kbd> scheda completa &nbsp; <kbd>P</kbd> prelievo &nbsp; <kbd>D</kbd> deposito</p></div>
    <aside class="pt-panel" id="pt-panel" aria-live="polite"></aside>`;
  host.classList.remove('hidden');
  paintPanel();
  wire();
  window.lucide?.createIcons();
}

export function hideProductTable() {
  (host || document.getElementById('product-table-view'))?.classList.add('hidden');
}

const selected = () => rows.find((r) => r.p.id === selId) || null;

function paintPanel() {
  const panel = document.getElementById('pt-panel');
  if (!panel) return;
  const r = selected();
  if (!r) {
    panel.innerHTML = '';
    return;
  }
  const { p } = r;
  const locs = r.locs.map((l) => `<li><span>${escapeHtml(l.locazione || 'Non assegnata')}</span><b>${Number(l.quantita) || 0}</b></li>`).join('');
  panel.classList.remove('pt-panel-in');
  void panel.offsetWidth; // rilancia la piccola animazione d'ingresso
  panel.classList.add('pt-panel-in');
  panel.innerHTML = `<p class="pt-kicker">Dettaglio</p>
    <h3 class="pt-title">${escapeHtml(p.codice_articolo)}</h3>
    <p class="pt-desc">${escapeHtml([p.macchina, p.punto_utilizzo_standard].filter(Boolean).join(' · ')) || '—'}</p>
    <div class="pt-stats"><div><span>Giacenza totale</span><b class="${r.low ? 'pt-low' : ''}">${Number(p.quantita_disponibile) || 0}</b></div><div><span>Scorta minima</span><b>${p.scorta_minima ?? '—'}</b></div></div>
    ${p.linea ? `<p class="pt-line"><span>Linea</span>${escapeHtml(p.linea)}</p>` : ''}
    <p class="pt-kicker">Scaffali</p><ul class="pt-locs">${locs || '<li><span>Non assegnata</span></li>'}</ul>
    <div class="pt-actions"><button type="button" data-act="prelievo" class="pt-btn pt-btn--primary">Prelievo <kbd>P</kbd></button><button type="button" data-act="deposito" class="pt-btn">Deposito <kbd>D</kbd></button></div>
    <button type="button" data-act="scheda" class="pt-link">Scheda completa <kbd>Invio</kbd></button>`;
}

function select(id, { scroll = false } = {}) {
  if (id === selId) return;
  selId = id;
  host.querySelectorAll('.pt-item').forEach((el) => el.classList.toggle('pt-sel', el.dataset.pid === String(id)));
  if (scroll) host.querySelector('.pt-sel')?.scrollIntoView({ block: 'nearest' });
  paintPanel();
}

function act(kind) {
  const r = selected();
  if (!r) return;
  feedback.tap();
  if (kind === 'scheda') openDetail(r.p);
  else startMovement(r.p, kind);
}

function wire() {
  if (wired) return;
  wired = true;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) return act(btn.dataset.act);
    const row = e.target.closest('.pt-item');
    if (row) {
      feedback.tap();
      select(rows.find((r) => String(r.p.id) === row.dataset.pid)?.p.id ?? selId);
    }
  });
  host.addEventListener('dblclick', (e) => e.target.closest('.pt-item') && act('scheda'));
  document.addEventListener('keydown', (e) => {
    // Solo con la tabella a vista, nessuna modale aperta e senza scrivere in un campo
    if (!MQ.matches || !host || host.classList.contains('hidden') || host.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-overlay.modal-visible')) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const i = rows.findIndex((r) => r.p.id === selId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (next) select(next.p.id, { scroll: true });
    } else if (e.key === 'Enter' && !t?.closest('button, a')) {
      e.preventDefault();
      act('scheda');
    } else if (e.key.toLowerCase() === 'p') act('prelievo');
    else if (e.key.toLowerCase() === 'd') act('deposito');
  });
}
