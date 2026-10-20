// =============================================================
// interventi-desktop.js — Interventi su desktop (≥1024px)
//   Da fare:    elenco per stato + pannello di riepilogo a destra (schermata A)
//   Effettuati: calendario del mese + elenco del giorno scelto (schermata D)
// Disegna solo: i dati, i filtri e i flussi (scheda/modale, giorno scelto) sono quelli di sempre.
// Tastiera: ↑ ↓ scorrono · Invio apre la scheda · ← → giorno prima/dopo (Effettuati)
// =============================================================

import { els, state } from './interventi-shared.js';
import { LINEE, dayKey, formatOperatore, keyToDate, lineaLabel, operatoriDi, ricambiDi, ricambiLabel, signedUrls, sortOperatori } from './interventi-data.js';
import { escapeHtml } from '../magazzino/products-shared.js';
import { openDetail } from './interventi-detail.js';
import { isUnseen, markSeen } from './interventi-unseen.js';
import feedback from '../../shared/feedback.js';
import { staggerIndex } from '../../shared/ui-utils.js';

const MQ = window.matchMedia('(min-width: 1024px)');
export const isDesktopInterventi = () => MQ.matches;
/** `cb` viene chiamata quando si attraversa la soglia desktop (finestra ridimensionata) */
export const bindDesktopChange = (cb) => MQ.addEventListener('change', cb);

let ctx = null;
let rows = [];
let sel = null;
let calMonth = null;
let lastDay = '';
let wired = false;

const STATO = { da_effettuare: ['da', 'Da effettuare'], sospeso: ['co', 'Da completare'], effettuato: ['ok', 'Effettuato'] };
const tag = (r) => `<span class="id-tag id-tag--${STATO[r.stato]?.[0] || 'da'}">${STATO[r.stato]?.[1] || ''}</span>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function sortOpen(list) {
  const lineaIdx = (v) => LINEE.findIndex((l) => l.value === v) + 1 || 99;
  const order = new Map(state.machineOrder.map((n, i) => [n.toLowerCase(), i]));
  const mIdx = (m) => (order.has(m.toLowerCase()) ? order.get(m.toLowerCase()) : 9999);
  const grp = (r) => (r.stato === 'sospeso' ? 1 : 0);
  return [...list].sort((a, b) => grp(a) - grp(b) || lineaIdx(a.linea) - lineaIdx(b.linea) || mIdx(a.macchina) - mIdx(b.macchina) || new Date(b.created_at) - new Date(a.created_at));
}
const sortDone = (list) => [...list].sort((a, b) => new Date(a.esito_at) - new Date(b.esito_at));

function cardHtml(r, i) {
  const ops = operatoriDi(r);
  const names = sortOperatori(ops).map(formatOperatore).join(', ');
  const foot = r.stato === 'effettuato' ? `Fatto ${ctx.fmtDateTime(r.esito_at)}${names ? ` · ${names}` : r.esito_by_name ? ` · ${r.esito_by_name}` : ''}` : names ? `Assegnato a ${names}` : `Creato ${ctx.fmtDateTime(r.created_at)}${r.created_by_name ? ` · ${r.created_by_name}` : ''}`;
  const chips = `${r.rapido_id && r.stato !== 'effettuato' ? '<span class="id-tag id-tag--prog">Programmato</span>' : ''}${r.ricambi_mancanti ? '<span class="id-tag id-tag--warn">Ricambi da indicare</span>' : ''}`;
  return `<div class="id-card list-item-in${r.id === sel ? ' id-sel' : ''}" data-id="${escapeHtml(r.id)}" style="--i:${staggerIndex(Math.min(i, 12))}">
    <div class="id-card-top"><span class="id-card-m"><span class="id-line">${escapeHtml(lineaLabel(r.linea))}</span><b>${escapeHtml(r.macchina)}</b></span><span class="id-chips">${chips}${tag(r)}</span></div>
    <p class="id-card-d">${escapeHtml(r.descrizione)}</p>
    <p class="id-card-f">${isUnseen(r) ? '<i class="id-new" title="Nuovo"></i>' : ''}${escapeHtml(foot)}</p></div>`;
}

function openHtml() {
  if (!rows.length) {
    const e = ctx.empty;
    return `<div class="id-empty"><b>${escapeHtml(e.title)}</b><span>${escapeHtml(e.sub)}</span></div>`;
  }
  let i = 0;
  const section = (title, list) => (list.length ? `<p class="id-kicker">${title} · ${list.length}</p><div class="id-stack">${list.map((r) => cardHtml(r, i++)).join('')}</div>` : '');
  return `<div class="id-wrap id-wrap--open"><div class="id-col"><div data-banner></div>${section('Da effettuare', rows.filter((r) => r.stato !== 'sospeso'))}${section('Da completare', rows.filter((r) => r.stato === 'sospeso'))}
    <p class="id-hint"><kbd>↑</kbd><kbd>↓</kbd> scorri &nbsp; <kbd>Invio</kbd> apri la scheda &nbsp; <kbd>N</kbd> nuovo intervento</p></div><aside class="id-panel" id="id-panel" aria-live="polite"></aside></div>`;
}

function calHtml() {
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const today = dayKey(new Date());
  let cells = '<i></i>'.repeat(offset);
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d += 1) {
    const key = dayKey(new Date(y, m, d));
    const has = state.doneDays.has(key);
    cells += `<button type="button" class="id-day${key === state.doneDay ? ' id-day--sel' : ''}${key === today ? ' id-day--today' : ''}${has ? ' id-day--has' : ''}" data-day="${key}"${has ? '' : ' disabled'} aria-label="${d}"><span>${d}</span></button>`;
  }
  const title = cap(calMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }));
  return `<div class="id-cal"><div class="id-cal-head"><b>${title}</b><span><button type="button" data-cal="-1" aria-label="Mese precedente">‹</button><button type="button" data-cal="1" aria-label="Mese successivo">›</button></span></div>
    <div class="id-cal-wd"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div><div class="id-cal-grid">${cells}</div>
    <p class="id-cal-note">Il pallino blu indica i giorni con interventi effettuati.</p></div>`;
}

function doneHtml() {
  const head = state.doneDay ? `${ctx.dayLabel(state.doneDay)} · ${rows.length} ${rows.length === 1 ? 'effettuato' : 'effettuati'}` : 'Scegli un giorno';
  const list = rows.length ? `<div class="id-stack">${rows.map((r, i) => cardHtml(r, i)).join('')}</div>` : `<div class="id-empty"><b>${escapeHtml(ctx.empty.title)}</b><span>${escapeHtml(ctx.empty.sub)}</span></div>`;
  return `<div class="id-wrap id-wrap--done">${calHtml()}<div class="id-col"><div data-banner></div><p class="id-kicker">${escapeHtml(head)}</p>${list}
    <p class="id-hint"><kbd>←</kbd><kbd>→</kbd> giorno prima / dopo &nbsp; <kbd>↑</kbd><kbd>↓</kbd> scorri &nbsp; <kbd>Invio</kbd> apri la scheda</p></div></div>`;
}

function paintPanel() {
  const panel = document.getElementById('id-panel');
  const r = rows.find((x) => x.id === sel);
  if (!panel) return;
  if (!r) {
    panel.innerHTML = '';
    return;
  }
  const names = sortOperatori(operatoriDi(r)).map(formatOperatore).join(', ');
  const row = (k, v) => (v ? `<p class="id-prow"><span>${k}</span>${escapeHtml(v)}</p>` : '');
  panel.classList.remove('id-panel-in');
  void panel.offsetWidth; // rilancia la piccola animazione d'ingresso
  panel.classList.add('id-panel-in');
  panel.innerHTML = `<p class="id-kicker">Riepilogo</p><h3 class="id-ptitle">${escapeHtml(r.macchina)} <span class="id-line">${escapeHtml(lineaLabel(r.linea))}</span></h3>
    <p class="id-pdesc">${escapeHtml(r.descrizione)}</p><div class="id-chips">${tag(r)}${r.rapido_id ? '<span class="id-tag id-tag--prog">Programmato</span>' : ''}</div>
    <div class="id-prows">${row('Operatori', names)}${row('Dettagli', r.dettagli)}${row(r.stato === 'sospeso' ? 'Da completare' : 'Note', r.note_esito)}${row('Ricambi', ricambiDi(r).map(ricambiLabel).join(', '))}${row('Creato', `${ctx.fmtDateTime(r.created_at)}${r.created_by_name ? ` · ${r.created_by_name}` : ''}`)}</div>
    <img class="id-photo hidden" alt="" data-photo><button type="button" class="id-open" data-act="open">Apri scheda <kbd>Invio</kbd></button>`;
  const path = r.foto_promemoria_path || r.foto_esito_path;
  if (path) {
    signedUrls([path]).then((u) => {
      const img = panel.querySelector('[data-photo]');
      if (img && u[path] && sel === r.id) {
        img.src = u[path];
        img.classList.remove('hidden');
      }
    }).catch(() => {});
  }
}

export function renderInterventiDesktop(c) {
  ctx = c;
  const done = state.tab === 'done';
  rows = done ? sortDone(c.rows) : sortOpen(c.rows);
  if (!rows.some((r) => r.id === sel)) sel = rows[0]?.id ?? null;
  if (done && state.doneDay && (state.doneDay !== lastDay || !calMonth)) {
    const d = keyToDate(state.doneDay);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    lastDay = state.doneDay;
  }
  if (done && !calMonth) calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  els.list.innerHTML = done ? doneHtml() : openHtml();
  if (c.banner) els.list.querySelector('[data-banner]')?.appendChild(c.banner);
  if (!done) paintPanel();
  wire();
}

const selectedRow = () => rows.find((r) => r.id === sel) || null;

function select(id, { scroll = false } = {}) {
  if (id === sel) return;
  sel = id;
  els.list.querySelectorAll('.id-card').forEach((el) => el.classList.toggle('id-sel', el.dataset.id === String(id)));
  const r = selectedRow();
  if (r && isUnseen(r)) {
    markSeen(r); // presa visione: il pallino «nuovo» sparisce
    els.list.querySelector(`.id-card[data-id="${CSS.escape(String(id))}"] .id-new`)?.remove();
  }
  if (scroll) els.list.querySelector('.id-sel')?.scrollIntoView({ block: 'nearest' });
  if (state.tab === 'open') paintPanel();
}

function openSelected() {
  const r = selectedRow();
  if (!r) return;
  feedback.tap();
  openDetail(r);
}

function wire() {
  if (wired) return;
  wired = true;
  els.list.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="open"]')) return openSelected();
    const cal = e.target.closest('[data-cal]');
    if (cal) {
      feedback.tap();
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(cal.dataset.cal), 1);
      els.list.querySelector('.id-cal').outerHTML = calHtml();
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) return ctx.selectDay(day.dataset.day);
    const card = e.target.closest('.id-card');
    if (!card) return;
    select(card.dataset.id);
    if (state.tab === 'done') openSelected(); // negli Effettuati un clic apre subito la scheda
  });
  els.list.addEventListener('dblclick', (e) => e.target.closest('.id-card') && state.tab === 'open' && openSelected());
  document.addEventListener('keydown', (e) => {
    if (!MQ.matches || !ctx || els.list.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-overlay.modal-visible')) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const i = rows.findIndex((r) => r.id === sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (next) select(next.id, { scroll: true });
    } else if (e.key === 'Enter' && !t?.closest('button, a')) {
      e.preventDefault();
      openSelected();
    } else if (state.tab === 'done' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      ctx.stepDay(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
}
