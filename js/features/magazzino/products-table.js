// =============================================================
// products-table.js — Magazzino su desktop (≥1024px): tabella articoli + pannello di dettaglio a destra.
// - Gli articoli sono RAGGRUPPATI come su mobile: in «Scaffalatura» per sigla (Scaffale SA → SA001, SA002...) con
//   gli scaffali dentro, ognuno a sua volta chiudibile (uno solo aperto per gruppo); in «Macchina» per macchina.
//   Si parte sempre con tutto chiuso; ogni testata ha numero di articoli e pezzi e si apre/chiude come un accordion.
// - Le colonne si RIDIMENSIONANO trascinando il bordo nella testata (doppio clic = larghezza iniziale);
//   le larghezze restano salvate per la volta dopo. Inizio e fine di ogni colonna sono sempre ben visibili.
// I dati sono quelli già caricati (state.currentList, con ricerca e filtri applicati): qui si disegnano soltanto.
// Scheda completa, Deposito e Prelievo usano gli stessi flussi di sempre (openDetail, startMovement).
// Tastiera: ↑ ↓ scorrono · Invio apre la scheda · P prelievo · D deposito
// =============================================================

import { els, escapeHtml } from './products-shared.js';
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
const opened = new Set(); // chiavi dei gruppi/scaffali APERTI: di partenza (e a ogni cambio di sezione) è tutto chiuso
let allOpen = false; // con una ricerca attiva tutto si mostra aperto, come su mobile

/** Sigla di serie di uno scaffale (SD002 → SD): stessa regola del Magazzino su mobile. 'Non assegnata' ha la sua. */
const UNASSIGNED = 'Non assegnata';
const seriesOf = (shelf) => (shelf === UNASSIGNED ? '~' : (String(shelf).match(/^([A-Za-z]+)/)?.[1] || '').toUpperCase());

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
  allOpen = (els.searchInput?.value || '').trim().length > 0;

  entries = [];
  list.forEach((p) => {
    const locs = locsOf(p);
    const low = p.quantita_disponibile < p.scorta_minima;
    if (mode === 'shelf') {
      // Un articolo presente su più scaffali compare in ognuno, con la quantità di quello scaffale
      (locs.length ? locs : [{ locazione: null, quantita: p.quantita_disponibile }]).forEach((l) => {
        entries.push({ key: `${p.id}|${l.locazione || ''}`, p, locs, low, group: l.locazione || UNASSIGNED, third: p.linea || '—', qty: Number(l.quantita) || 0 });
      });
    } else {
      entries.push({
        key: String(p.id),
        p,
        locs,
        low,
        group: p.macchina || 'Senza macchina',
        third: locs.map((l) => (l.locazione ? (locs.length > 1 ? `${l.locazione} (${l.quantita})` : l.locazione) : UNASSIGNED)).join(' · ') || '—',
        qty: locs.reduce((s, l) => s + (Number(l.quantita) || 0), 0),
      });
    }
  });
  const lastGroup = (g) => (g === UNASSIGNED || g === 'Senza macchina' ? 1 : 0);
  entries.sort((a, b) => lastGroup(a.group) - lastGroup(b.group) || natural(a.group, b.group) || natural(a.p.codice_articolo, b.p.codice_articolo));
  if (!entries.some((e) => e.key === selKey)) selKey = null; // tutto chiuso: nessuna riga scelta finché non si apre qualcosa

  // Livelli: [sigla →] scaffale (o macchina) → righe. Una sigla con un solo scaffale (o «Non assegnata») resta una testata sola.
  const series = new Map(); // sigla -> Map(scaffale -> voci)
  entries.forEach((e) => {
    const sg = mode === 'shelf' ? seriesOf(e.group) : e.group;
    if (!series.has(sg)) series.set(sg, new Map());
    const shelves = series.get(sg);
    if (!shelves.has(e.group)) shelves.set(e.group, []);
    shelves.get(e.group).push(e);
  });
  const isSolo = (sg) => mode !== 'shelf' || series.get(sg).size === 1;
  const shelfKey = (g) => `${mode}|s|${g}`;
  const groupKey = (sg) => `${mode}|g|${sg}`;
  entries.forEach((e) => {
    const sg = mode === 'shelf' ? seriesOf(e.group) : e.group;
    e.keys = isSolo(sg) ? [shelfKey(e.group)] : [groupKey(sg), shelfKey(e.group)];
  });

  const cols = loadCols();
  const grip = (n) => `<i class="pt-grip" data-col="${n}" role="separator" aria-orientation="vertical"></i>`;
  const head = `<div class="pt-row pt-head"><span class="pt-h"><span class="pt-ht">Codice</span>${grip(1)}</span><span class="pt-h"><span class="pt-ht">Macchina · punto di utilizzo</span>${grip(2)}</span><span class="pt-h"><span class="pt-ht">${mode === 'shelf' ? 'Linea' : 'Scaffale'}</span>${grip(3)}</span><span class="pt-h pt-num"><span class="pt-ht">Giac.</span></span></div>`;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const groupHtml = ({ k, level, titleHtml, countTxt, inner }) => {
    const isOpen = allOpen || opened.has(k);
    return `<div class="pt-g pt-lv${level}${isOpen ? '' : ' is-collapsed'}" data-k="${escapeHtml(k)}">
      <button type="button" class="pt-group" aria-expanded="${isOpen}"><span class="pt-chev" aria-hidden="true">▾</span><b>${titleHtml}</b><span class="pt-gcount">${countTxt}</span></button>
      <div class="pt-gtrack"><div class="pt-gbody">${inner}</div></div></div>`;
  };

  let i = 0;
  const rowsHtml = (chunk) =>
    chunk
      .map((r) => {
        const sub = [r.p.macchina, r.p.punto_utilizzo_standard].filter(Boolean).join(' · ');
        return `<div class="pt-row pt-item list-item-in${r.key === selKey ? ' pt-sel' : ''}" data-key="${escapeHtml(r.key)}" style="--i:${staggerIndex(Math.min(i++, 14))}">
          <span class="pt-code">${escapeHtml(r.p.codice_articolo)}</span><span class="pt-sub">${escapeHtml(sub) || '—'}</span>
          <span class="pt-shelf">${escapeHtml(r.third)}</span><span class="pt-num${r.low ? ' pt-low' : ''}">${r.qty}${r.low ? ' ▾' : ''}</span></div>`;
      })
      .join('');
  const sum = (chunk) => chunk.reduce((t, x) => t + x.qty, 0);
  const countOf = (chunk) => `${plural(chunk.length, 'articolo', 'articoli')} · ${sum(chunk)} pezzi`;

  let body = '';
  series.forEach((shelves, sg) => {
    if (isSolo(sg)) {
      const [g, chunk] = [...shelves.entries()][0];
      body += groupHtml({
        k: shelfKey(g),
        level: 0,
        titleHtml: `${mode === 'shelf' && g !== UNASSIGNED ? 'Scaffale ' : ''}${escapeHtml(g)}`,
        countTxt: countOf(chunk),
        inner: rowsHtml(chunk),
      });
      return;
    }
    const all = [...shelves.values()].flat();
    const articles = new Set(all.map((x) => x.p.id)).size;
    const inner = [...shelves.entries()]
      .map(([g, chunk]) => groupHtml({ k: shelfKey(g), level: 1, titleHtml: escapeHtml(g), countTxt: countOf(chunk), inner: rowsHtml(chunk) }))
      .join('');
    body += groupHtml({
      k: groupKey(sg),
      level: 0,
      titleHtml: sg ? `Scaffale ${escapeHtml(sg)}` : 'Senza sigla',
      countTxt: `${plural(shelves.size, 'scaffale', 'scaffali')} · ${plural(articles, 'articolo', 'articoli')} · ${sum(all)} pezzi`,
      inner,
    });
  });

  host.innerHTML = `<div class="pt-main"><div class="pt-card" role="grid" aria-label="Articoli">${head}${body}</div>
    <p class="pt-hint"><kbd>↑</kbd><kbd>↓</kbd> scorri &nbsp; <kbd>Invio</kbd> scheda completa &nbsp; <kbd>P</kbd> prelievo &nbsp; <kbd>D</kbd> deposito</p></div>
    <aside class="pt-panel" id="pt-panel" aria-live="polite"></aside>`;
  applyCols(host.querySelector('.pt-card'), cols);
  host.classList.remove('hidden');
  paintPanel();
  wire();
  window.lucide?.createIcons();
}

/** Richiude tutto di scatto (uscendo dal Magazzino o cambiando categoria): al rientro è tutto chiuso, senza animazioni visibili. */
export function resetProductTable() {
  opened.clear();
  selKey = null;
  if (!host) return;
  host.classList.add('pt-instant');
  host.querySelectorAll('.pt-g').forEach((g) => {
    g.classList.add('is-collapsed');
    g.querySelector(':scope > .pt-group')?.setAttribute('aria-expanded', 'false');
  });
  host.querySelectorAll('.pt-item.pt-sel').forEach((el) => el.classList.remove('pt-sel'));
  paintPanel();
  void host.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => host.classList.remove('pt-instant')));
}

export function hideProductTable() {
  (host || document.getElementById('product-table-view'))?.classList.add('hidden');
}

const selected = () => entries.find((r) => r.key === selKey) || null;
/** Voci a vista (quelle con tutti i livelli aperti), nell'ordine in cui compaiono */
const visibleEntries = () => entries.filter((e) => allOpen || e.keys.every((k) => opened.has(k)));

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

function setOpen(g, open) {
  g.classList.toggle('is-collapsed', !open);
  g.querySelector(':scope > .pt-group')?.setAttribute('aria-expanded', String(open));
  if (open) opened.add(g.dataset.k);
  else opened.delete(g.dataset.k);
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
      // Accordion: apre/chiude con animazione. Dentro a una sigla resta aperto un solo scaffale alla volta (come su mobile)
      const g = head.closest('.pt-g');
      const willOpen = g.classList.contains('is-collapsed');
      setOpen(g, willOpen);
      if (willOpen && g.classList.contains('pt-lv1') && !allOpen) {
        g.parentElement.querySelectorAll(':scope > .pt-g').forEach((o) => o !== g && setOpen(o, false));
      }
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
