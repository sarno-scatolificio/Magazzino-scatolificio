// =============================================================
// lifespan-due.js — Scheda «Vita utile in scadenza» (Movimenti, solo Admin)
// =============================================================
// Avvisa quando un ricambio di cui è calcolata la vita media (stesse regole del Report › Vita utile) ha consumato almeno il
// 90% della sua durata media dall'ultima sostituzione. Discreta: la scheda compare SOLO se c'è qualcosa in scadenza, resta
// chiusa (si vede solo il numero) e si apre al tocco. Per ogni voce:
//   • percentuale di vita media già trascorsa e barra di avanzamento;
//   • data prevista del prossimo cambio (o, se superata, di quanti giorni);
//   • «Posticipa 7 giorni» per far tacere un avviso già noto (si azzera da solo se il ricambio viene sostituito).
// Non scrive nulla sul database: usa gli stessi prelievi già letti dal Report.

import { listPrelieviForLifespan } from '../../data/supabase.js';
import { computeLifespan, fmtDays, fmtDate, placeLabel } from '../report/lifespan.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { isAdmin } from '../../core/auth.js';
import feedback from '../../shared/feedback.js';

export const DUE_THRESHOLD = 0.9; // «in scadenza» = almeno il 90% della vita media già trascorsa
const MIN_REPLACEMENTS = 3; // servono almeno 3 sostituzioni (come nel Report) perché la media sia affidabile
const STALE_FACTOR = 3; // oltre 3 volte la media senza sostituzioni: ricambio non più in uso, niente avviso
const SNOOZE_DAYS = 7;
const CACHE_MS = 2 * 60 * 1000; // il calcolo si rifà al massimo ogni 2 minuti (legge tutti i prelievi)
const DAY_MS = 86400000;
const SNOOZE_KEY = 'lifedue_snooze_v1';

const els = {};
let items = [];
let loadedAt = 0;
let loading = null;

/** Ricambi in scadenza a partire dal calcolo del Report. Funzione pura (testabile). */
export function computeDue(summaries, now = Date.now(), snooze = {}) {
  const out = [];
  for (const s of summaries) {
    if (s.replacements < MIN_REPLACEMENTS || !(s.avg >= 1)) continue;
    const elapsed = (now - s.lastDate) / DAY_MS;
    const pct = elapsed / s.avg;
    if (pct < DUE_THRESHOLD || pct > STALE_FACTOR) continue;
    const sn = snooze[s.g.key];
    if (sn && sn.last === s.lastDate && sn.until > now) continue; // posticipato (e nessuna nuova sostituzione da allora)
    out.push({ g: s.g, key: s.g.key, avg: s.avg, lastDate: s.lastDate, elapsed, pct, dueDate: s.lastDate + s.avg * DAY_MS, replacements: s.replacements });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

function readSnooze() {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function writeSnooze(map) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* memoria piena o non disponibile: l'avviso tornerà alla prossima apertura */
  }
}

export function initLifespanDue() {
  els.card = document.getElementById('scanner-lifedue-card');
  els.btn = document.getElementById('scanner-lifedue-btn');
  els.track = document.getElementById('lifedue-track');
  els.count = document.getElementById('scanner-lifedue-count');
  els.list = document.getElementById('lifedue-list');
  if (!els.card || !els.btn) return;

  els.btn.addEventListener('click', () => {
    const open = !els.track.classList.contains('acc-open');
    feedback.tap();
    els.track.classList.toggle('acc-open', open);
    els.card.classList.toggle('lowstock-card-open', open);
    els.btn.setAttribute('aria-expanded', String(open));
  });
  els.list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-snooze]');
    if (!b) return;
    feedback.tap();
    const it = items.find((x) => x.key === b.dataset.snooze);
    if (!it) return;
    const map = readSnooze();
    map[it.key] = { until: Date.now() + SNOOZE_DAYS * DAY_MS, last: it.lastDate };
    writeSnooze(map);
    items = items.filter((x) => x.key !== it.key);
    render();
  });
}

/** Ricalcola (al massimo ogni 2 minuti, salvo force) e aggiorna la scheda; errori ignorati: la scheda è solo un avviso. */
export async function refreshLifespanDue({ force = false } = {}) {
  if (!els.card || !isAdmin()) return;
  if (!force && Date.now() - loadedAt < CACHE_MS) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const rows = await listPrelieviForLifespan();
      const { summaries } = computeLifespan(rows);
      items = computeDue(summaries, Date.now(), readSnooze());
      loadedAt = Date.now();
      render();
    } catch (err) {
      console.warn('Vita utile in scadenza non disponibile.', err);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function render() {
  if (!els.card) return;
  els.card.classList.toggle('hidden', items.length === 0);
  els.count.textContent = String(items.length);
  els.list.innerHTML = items
    .map((it) => {
      const over = it.pct >= 1;
      const pct = Math.round(it.pct * 100);
      const when = over
        ? `Oltre la media di ${fmtDays(it.elapsed - it.avg)}`
        : `Cambio previsto entro il ${fmtDate(it.dueDate)}`;
      return `
      <div class="lifedue-row">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-medium text-graphite-100 truncate">${escapeHtml(it.g.codice)}</p>
            <p class="text-xs text-graphite-500 mt-0.5">${placeLabel(it.g)}</p>
          </div>
          <span class="lifedue-pct ${over ? 'lifedue-pct--over' : ''} shrink-0 font-display">${pct}%</span>
        </div>
        <div class="lifedue-bar ${over ? 'lifedue-bar--over' : ''}" role="img" aria-label="${pct}% della vita media trascorsa"><span style="width:${Math.min(100, pct)}%"></span></div>
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-graphite-400 min-w-0">${when} · media ${fmtDays(it.avg)} · ultima ${fmtDate(it.lastDate)}</p>
          <button type="button" data-snooze="${escapeHtml(it.key)}" class="shrink-0 min-h-[32px] px-2 text-[11px] font-display font-semibold uppercase tracking-wide text-amber-400">Posticipa ${SNOOZE_DAYS} gg</button>
        </div>
      </div>`;
    })
    .join('');
}
