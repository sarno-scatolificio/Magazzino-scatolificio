// =============================================================
// activity-log.js — Registro attività (Impostazioni, solo nunziodoria96@gmail.com)
// Mostra, dal più recente, gli accessi (con data e ora e dispositivo) e le
// azioni svolte da ogni utente, raggruppati per giorno. Filtri: tipo, utente,
// periodo. La lettura è bloccata dal database per chiunque altro: la voce
// nelle Impostazioni è nascosta agli altri solo per pulizia (vedi auth.js).
// =============================================================

import { listActivityLog, listProfiles } from '../../data/supabase.js';
import { toastError } from '../../shared/toast.js';
import { staggerIndex, emptyStateHtml, openOverlay, closeOverlay, setButtonBusy } from '../../shared/ui-utils.js';
import { enhanceSelect } from '../../shared/ui-select.js';
import { escapeHtml } from '../../shared/html-utils.js';

const PAGE_SIZE = 50;
const els = {};
const state = { tipo: 'tutto', userId: '', period: '7', rows: [], hasMore: false };
let userSelectUi = null;
let periodSelectUi = null;
let loadSeq = 0; // scarta le risposte arrivate in ritardo dopo un cambio di filtro

export function initActivityLog() {
  els.modal = document.getElementById('activity-log-modal');
  els.openBtn = document.getElementById('activity-log-btn');
  els.closeBtn = document.getElementById('activity-log-close');
  els.refreshBtn = document.getElementById('activity-log-refresh');
  els.tabs = document.querySelectorAll('[data-activity-tab]');
  els.userSelect = document.getElementById('activity-log-user');
  els.periodSelect = document.getElementById('activity-log-period');
  els.count = document.getElementById('activity-log-count');
  els.skeleton = document.getElementById('activity-log-skeleton');
  els.list = document.getElementById('activity-log-list');
  if (!els.modal || !els.openBtn) return;

  userSelectUi = enhanceSelect(els.userSelect);
  periodSelectUi = enhanceSelect(els.periodSelect);

  els.openBtn.addEventListener('click', () => {
    openOverlay(els.modal);
    loadUsers();
    load({ append: false });
  });
  els.closeBtn?.addEventListener('click', () => closeOverlay(els.modal));
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeOverlay(els.modal);
  });
  els.refreshBtn?.addEventListener('click', async () => {
    setButtonBusy(els.refreshBtn, true);
    await load({ append: false });
    setButtonBusy(els.refreshBtn, false);
  });
  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tipo = btn.dataset.activityTab;
      els.tabs.forEach((b) => b.classList.toggle('history-tab-active', b === btn));
      load({ append: false });
    });
  });
  els.userSelect.addEventListener('change', () => {
    state.userId = els.userSelect.value;
    load({ append: false });
  });
  els.periodSelect.addEventListener('change', () => {
    state.period = els.periodSelect.value;
    load({ append: false });
  });
}

/** Elenco degli utenti nel filtro: si aggiorna a ogni apertura (così compaiono subito i nuovi) */
async function loadUsers() {
  try {
    const profiles = await listProfiles();
    const current = els.userSelect.value;
    els.userSelect.innerHTML = '<option value="">Tutti gli utenti</option>';
    profiles
      .slice()
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b), 'it'))
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = userLabel(p);
        els.userSelect.appendChild(opt);
      });
    els.userSelect.value = [...els.userSelect.options].some((o) => o.value === current) ? current : '';
    state.userId = els.userSelect.value;
    userSelectUi?.rebuild();
  } catch (err) {
    console.error(err); // senza l'elenco il filtro per utente resta "Tutti": il registro funziona lo stesso
  }
}

function userLabel(p) {
  return (p.full_name || '').trim() || p.email || 'Utente';
}

/** Inizio del periodo scelto: "Oggi" = da mezzanotte, "7" = oggi e i 6 giorni precedenti, ecc. */
function periodStart() {
  if (state.period === 'all') return null;
  const days = Number(state.period) || 1;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

async function load({ append }) {
  const seq = ++loadSeq;
  const offset = append ? state.rows.length : 0;
  if (!append) {
    els.skeleton.classList.remove('hidden');
    els.list.classList.add('hidden');
  }
  try {
    const { rows, hasMore } = await listActivityLog({
      since: periodStart(),
      userId: state.userId || null,
      tipo: state.tipo,
      offset,
      limit: PAGE_SIZE,
    });
    if (seq !== loadSeq) return;
    state.rows = append ? state.rows.concat(rows) : rows;
    state.hasMore = hasMore;
    render(append ? offset : 0);
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error(err);
    toastError('Impossibile caricare il registro. Controlla la connessione e riprova.');
    if (!append) {
      els.list.innerHTML = emptyStateHtml('wifi-off', 'Registro non disponibile', 'Controlla la rete e tocca Aggiorna.');
      els.count.textContent = '\u00a0';
      window.lucide?.createIcons();
    }
  } finally {
    if (seq === loadSeq) {
      els.skeleton.classList.add('hidden');
      els.list.classList.remove('hidden');
    }
  }
}

// --- Aspetto delle voci -------------------------------------------------

const TONE_CLASSES = {
  ok: 'bg-emerald-500/15 text-emerald-700',
  neutral: 'bg-graphite-800 text-graphite-400',
  info: 'bg-sky-500/20 text-sky-700',
  accent: 'bg-amber-500/20 text-amber-400',
  danger: 'bg-rose-500/10 text-rose-700',
};

const CATEGORY_ICONS = {
  Movimenti: 'arrow-left-right',
  Articoli: 'package',
  Interventi: 'wrench',
  Inventario: 'clipboard-check',
  Manuali: 'book-open',
  Impostazioni: 'settings',
  Utenti: 'users',
};

function iconFor(row) {
  if (row.evento === 'accesso') return { icon: 'log-in', tone: 'ok' };
  if (row.evento === 'uscita') return { icon: 'log-out', tone: 'neutral' };
  if (/^Elimin/i.test(row.azione)) return { icon: 'trash-2', tone: 'danger' };
  const icon = CATEGORY_ICONS[row.categoria] || 'activity';
  return { icon, tone: row.categoria === 'Movimenti' ? 'info' : 'accent' };
}

const DAY_FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const FULL_FMT = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'medium' });

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const base = DAY_FMT.format(date);
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  if (same(date, today)) return `Oggi · ${label}`;
  if (same(date, yesterday)) return `Ieri · ${label}`;
  return label;
}

function render(startIndex = 0) {
  const rows = state.rows;
  if (rows.length === 0) {
    els.count.textContent = '\u00a0';
    els.list.innerHTML = emptyStateHtml(
      'clipboard-list',
      'Nessuna attività',
      state.period === 'all' && state.tipo === 'tutto' && !state.userId
        ? 'Gli accessi e le azioni vengono registrati da ora in poi.'
        : 'Prova a cambiare utente, tipo o periodo.'
    );
    window.lucide?.createIcons();
    return;
  }

  els.count.textContent = `${rows.length}${state.hasMore ? '+' : ''} ${rows.length === 1 && !state.hasMore ? 'voce' : 'voci'}, dalla più recente`;

  let html = '';
  let lastDay = '';
  rows.forEach((row, i) => {
    const date = new Date(row.created_at);
    const day = date.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      html += `<p class="activity-day sticky top-0 z-10 bg-graphite-900 pt-3 pb-1.5 text-xs font-display font-bold uppercase tracking-wide text-graphite-500">${escapeHtml(dayLabel(date))}</p>`;
    }
    const { icon, tone } = iconFor(row);
    const who = (row.user_name || '').trim() || row.user_email || 'Utente sconosciuto';
    const showEmail = row.user_name && row.user_email;
    html += `
      <div class="${i >= startIndex ? 'list-item-in ' : ''}card-plate rounded-xl p-3 mb-2 flex items-start gap-3" style="--i:${staggerIndex(i - startIndex)}">
        <span class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${TONE_CLASSES[tone]}">
          <i data-lucide="${icon}" class="w-[18px] h-[18px]" stroke-width="2"></i>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <p class="font-display font-semibold text-sm text-graphite-100 truncate" ${showEmail ? `title="${escapeHtml(row.user_email)}"` : ''}>${escapeHtml(who)}</p>
            <time class="shrink-0 text-xs font-semibold tabular-nums text-graphite-400" datetime="${escapeHtml(row.created_at)}" title="${escapeHtml(FULL_FMT.format(date))}">${TIME_FMT.format(date)}</time>
          </div>
          <p class="text-sm text-graphite-200 break-words">${escapeHtml(row.azione)}</p>
          ${row.dettagli ? `<p class="text-xs text-graphite-500 mt-0.5 break-words">${escapeHtml(row.dettagli)}</p>` : ''}
        </div>
      </div>`;
  });

  if (state.hasMore) {
    html += `
      <button id="activity-log-more" type="button" class="w-full mt-1 mb-1 rounded-lg border border-graphite-700 hover:border-amber-400 text-graphite-300 hover:text-amber-400 px-4 py-2.5 text-xs font-display font-semibold uppercase tracking-wide transition-colors min-h-[44px]">
        Mostra altre voci
      </button>`;
  }

  const scrollTop = els.list.scrollTop;
  els.list.innerHTML = html;
  els.list.scrollTop = startIndex > 0 ? scrollTop : 0;
  window.lucide?.createIcons();

  const moreBtn = document.getElementById('activity-log-more');
  moreBtn?.addEventListener('click', async () => {
    setButtonBusy(moreBtn, true);
    await load({ append: true });
  });
}
