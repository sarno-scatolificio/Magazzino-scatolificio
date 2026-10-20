// =============================================================
// products-table.js — Magazzino su desktop (≥1024px): tabella articoli + pannello di dettaglio a destra.
// - Gli articoli sono RAGGRUPPATI: per scaffale (modalità «Scaffalatura») o per macchina (modalità «Macchina»);
//   ogni gruppo ha la sua testata, con numero di articoli e pezzi, e si chiude/apre come un accordion.
// - Le colonne si RIDIMENSIONANO trascinando il bordo nella testata (doppio clic = larghezza iniziale);
//   le larghezze restano salvate per la volta dopo.
// I dati sono quelli già caricati (state.currentList, con ricerca e filtri applicati): qui si disegnano soltanto.
// Scheda completa, Deposito e Prelievo usano gli stessi flussi di sempre (openDetail, startMovement).
// Tastiera: ↑ ↓ scorrono · Invio apre la scheda · P prelievo · D deposito
// =============================================================

import { escapeHtml } from './products-shared.js';
import { openDetail } from './products-detail.js';
import { startMovement } from '../movimenti/scanner.js';
import { staggerIndex } from '../../shared/ui-utils.js';
import feedback from '../../shared/feedback.js';

const MQ = window.matchMedia('(min-width: 1024px)');
export const isDesktopTable = () => MQ.matches;

const COLS_KEY = 'mate.pt.cols.v1';
const COL_DEFAULT = [170, 420, 220]; // codice, macchina · punto di utilizzo, scaffale/linea (l'ultima, «Giac.», prende il resto)
const COL_MIN = 80;
const COL_MAX = 800;

let host = null;
let entries = []; // [{ key, p, group, third, qty, low, locs }]
let selKey = null;
let wired = false;
let mode = 'shelf';
const collapsed = new Set(); // `${mode}|${gruppo}` chiusi

const natural = (a, b) => String(a || '').localeCompare(String(b || ''), 'it', { numeric: true, sensitivity: 'base' });

function loadCols() {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY));
    if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))) return v.map((n) => Math.min(COL_MAX, Math.max(COL_MIN, n)));
  } catch {
    /* si usano i valori di default */
  }
  return [...COL_DEFAULT];
}
const saveCols = (cols) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  } catch {
    /* archivio pieno o bloccato: le larghezze valgono solo per questa sessione */
  }
};
function applyCols(card, cols) {
  cols.forEach((w, i) => card.style.setProperty(`--pt-c${i + 1}`, `${w}px`));
  card.style.setProperty('--pt-min', `${cols.reduce((s, w) => s + w, 0) + 90}px`);
}

/** Disegna la tabella. `m`: 'shelf' raggruppa per scaffale, 'machine' per macchina. `locsOf`: scaffali dell'articolo nell'area scelta. */
export function renderProductTable({ list, mode: m, locsOf }) {
  host = host || document.getElementById('product-table-view');
  if (!host) return;
  mode = m === 'machine' ? 'machine' : 'shelf';

  entries = [];
  list.forEach((p) => {
    const locs = locsOf(p);
    const low = p.quantita_disponibile < p.scorta_minima;
    if (mode === 'shelf') {
      // Un articolo presente su più scaffali compare in ognuno, con la quantità di quello scaffale
      (locs.length ? locs : [{ locazione: null, quantita: p.quantita_disponibile }]).forEach((l) => {
        entries.push({ key: `${p.id}|${l.locazione || ''}`, p, locs, low, group: l.locazione || 'Non assegnata', third: p.linea || '—', qty: Number(l.quantita) || 0 });
      });
    } else {
      entries.push({
        key: String(p.id),
        p,
        locs,
        low,
        group: p.macchina || 'Senza macchina',
        third: locs.map((l) => (l.locazione ? (locs.length > 1 ? `${l.locazione} (${l.quantita})` : l.locazione) : 'Non assegnata')).join(' · ') || '—',
        qty: locs.reduce((s, l) => s + (Number(l.quantita) || 0), 0),
      });
    }
  });
  const lastGroup = (g) => (g === 'Non assegnata' || g === 'Senza macchina' ? 1 : 0);
  entries.sort((a, b) => lastGroup(a.group) - lastGroup(b.group) || natural(a.group, b.group) || natural(a.p.codice_articolo, b.p.codice_articolo));
  if (!entries.some((e) => e.key === selKey)) selKey = entries[0]?.key ?? null;

  const cols = loadCols();
  const grip = (n) => `<i class="pt-grip" data-col="${n}" role="separator" aria-orientation="vertical" title="Trascina per ridimensionare · doppio clic per ripristinare"></i>`;
  const head = `<div class="pt-row pt-head"><span class="pt-h">Codice${grip(1)}</span><span class="pt-h">Macchina · punto di utilizzo${grip(2)}</span><span class="pt-h">${mode === 'shelf' ? 'Linea' : 'Scaffale'}${grip(3)}</span><span class="pt-h pt-num">Giac.</span></div>`;

  // Gruppi in ordine: testata + corpo che si chiude con un accordion
  let i = 0;
  let body = '';
  for (let s = 0; s < entries.length; ) {
    const g = entries[s].group;
    let e = s;
    while (e < entries.length && entries[e].group === g) e += 1;
    const chunk = entries.slice(s, e);
    const pieces = chunk.reduce((t, x) => t + x.qty, 0);
    const isClosed = collapsed.has(`${mode}|${g}`);
    const rowsHtml = chunk
      .map((r) => {
        const sub = [r.p.macchina, r.p.punto_utilizzo_standard].filter(Boolean).join(' · ');
        return `<div class="pt-row pt-item list-item-in${r.key === selKey ? ' pt-sel' : ''}" data-key="${escapeHtml(r.key)}" style="--i:${staggerIndex(Math.min(i++, 14))}">
          <span class="pt-code">${escapeHtml(r.p.codice_articolo)}</span><span class="pt-sub">${escapeHtml(sub) || '—'}</span>
          <span class="pt-shelf">${escapeHtml(r.third)}</span><span class="pt-num${r.low ? ' pt-low' : ''}">${r.qty}${r.low ? ' ▾' : ''}</span></div>`;
      })
      .join('');
    body += `<div class="pt-g${isClosed ? ' is-collapsed' : ''}" data-g="${escapeHtml(g)}">
      <button type="button" class="pt-group" aria-expanded="${!isClosed}"><span class="pt-chev" aria-hidden="true">▾</span><b>${mode === 'shelf' && g !== 'Non assegnata' ? 'Scaffale ' : ''}${escapeHtml(g)}</b><span class="pt-gcount">${chunk.length} ${chunk.length === 1 ? 'articolo' : 'articoli'} · ${pieces} pezzi</span></button>
      <div class="pt-gtrack"><div class="pt-gbody">${rowsHtml}</div></div></div>`;
    s = e;
  }

  host.innerHTML = `<div class="pt-main"><div class="pt-card" role="grid" aria-label="Articoli">${head}${body}</div>
    <p class="pt-hint"><kbd>↑</kbd><kbd>↓</kbd> scorri &nbsp; <kbd>Invio</kbd> scheda completa &nbsp; <kbd>P</kbd> prelievo &nbsp; <kbd>D</kbd> deposito &nbsp; Trascina i bordi della testata per allargare le colonne</p></div>
    <aside class="pt-panel" id="pt-panel" aria-live="polite"></aside>`;
  applyCols(host.querySelector('.pt-card'), cols);
  host.classList.remove('hidden');
  paintPanel();
  wire();
  window.lucide?.createIcons();
}

export function hideProductTable() {
  (host || document.getElementById('product-table-view'))?.classList.add('hidden');
}

const selected = () => entries.find((r) => r.key === selKey) || null;
/** Voci a vista (quelle dei gruppi aperti), nell'ordine in cui compaiono */
const visibleEntries = () => entries.filter((e) => !collapsed.has(`${mode}|${e.group}`));

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

function select(key, { scroll = false } = {}) {
  if (key === selKey) return;
  selKey = key;
  host.querySelectorAll('.pt-item').forEach((el) => el.classList.toggle('pt-sel', el.dataset.key === String(key)));
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

/** Ridimensionamento colonne: si trascina il bordo destro della testata (la larghezza segue il puntatore) */
function startResize(e, grip) {
  e.preventDefault();
  e.stopPropagation();
  const card = host.querySelector('.pt-card');
  const idx = Number(grip.dataset.col) - 1;
  const cols = loadCols();
  const startX = e.clientX;
  const start = cols[idx];
  grip.setPointerCapture?.(e.pointerId);
  card.classList.add('pt-resizing');
  const move = (ev) => {
    cols[idx] = Math.min(COL_MAX, Math.max(COL_MIN, Math.round(start + ev.clientX - startX)));
    applyCols(card, cols);
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    card.classList.remove('pt-resizing');
    saveCols(cols);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function wire() {
  if (wired) return;
  wired = true;
  host.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.pt-grip');
    if (grip) startResize(e, grip);
  });
  host.addEventListener('dblclick', (e) => {
    const grip = e.target.closest('.pt-grip');
    if (grip) {
      const cols = loadCols();
      cols[Number(grip.dataset.col) - 1] = COL_DEFAULT[Number(grip.dataset.col) - 1];
      applyCols(host.querySelector('.pt-card'), cols);
      saveCols(cols);
      return;
    }
    if (e.target.closest('.pt-item')) act('scheda');
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('.pt-grip')) return;
    const btn = e.target.closest('[data-act]');
    if (btn) return act(btn.dataset.act);
    const head = e.target.closest('.pt-group');
    if (head) {
      // Accordion del gruppo: apre/chiude con animazione
      const g = head.closest('.pt-g');
      const k = `${mode}|${g.dataset.g}`;
      const closed = g.classList.toggle('is-collapsed');
      head.setAttribute('aria-expanded', String(!closed));
      if (closed) collapsed.add(k);
      else collapsed.delete(k);
      feedback.tap();
      return;
    }
    const row = e.target.closest('.pt-item');
    if (row) {
      feedback.tap();
      select(entries.find((r) => String(r.key) === row.dataset.key)?.key ?? selKey);
    }
  });
  document.addEventListener('keydown', (e) => {
    // Solo con la tabella a vista, nessuna modale aperta e senza scrivere in un campo
    if (!MQ.matches || !host || host.classList.contains('hidden') || host.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-overlay.modal-visible')) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const vis = visibleEntries();
    const i = vis.findIndex((r) => r.key === selKey);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = vis[(i < 0 ? (e.key === 'ArrowDown' ? -1 : vis.length) : i) + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (next) select(next.key, { scroll: true });
    } else if (e.key === 'Enter' && !t?.closest('button, a')) {
      e.preventDefault();
      act('scheda');
    } else if (e.key.toLowerCase() === 'p') act('prelievo');
    else if (e.key.toLowerCase() === 'd') act('deposito');
  });
}
