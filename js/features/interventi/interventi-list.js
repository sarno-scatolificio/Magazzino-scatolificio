// =============================================================
// interventi-list.js — Elenco (Da fare / Effettuati), giorni, filtri e disegno delle righe
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, CHIP_RICAMBI, STATO_CHIP, els, state } from './interventi-shared.js';
import { LINEE, STATI, dayKey, formatOperatore, keyToDate, lineaLabel, listEffettuatiDays, listEffettuatiRange, listOperatori, listRapidi, operatoriDi, ricambiDi, ricambiLabel, signedUrls, sortOperatori } from './interventi-data.js';
import { emptyStateHtml, modalCloseMs, staggerIndex, syncSegIndicator } from '../../shared/ui-utils.js';
import { escapeHtml } from '../magazzino/products-shared.js';
import feedback from '../../shared/feedback.js';
import { openDetail } from './interventi-detail.js';
import { openPhotoViewer } from './interventi-photo.js';
import { UNSEEN_DOT_HTML, dismissDot, isUnseen, markSeen } from './interventi-unseen.js';
import { toastError } from '../../shared/toast.js';

export function defaultDay() {
  const today = dayKey(new Date());
  if (state.doneDays.has(today) || !state.doneDays.size) return today;
  return [...state.doneDays].sort().pop();
}

/** Effettuati del giorno scelto, in ordine di esecuzione */
export async function loadDay() {
  if (!state.doneDay) {
    state.done = [];
    return;
  }
  const d = keyToDate(state.doneDay);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  state.done = await listEffettuatiRange(from.toISOString(), to.toISOString());
}

export async function selectDay(key) {
  if (!key || key === state.doneDay) return;
  const previous = state.doneDay;
  state.doneDay = key;
  try {
    await loadDay();
  } catch (err) {
    console.error(err);
    state.doneDay = previous;
    feedback.errorAction();
    toastError('Impossibile caricare gli interventi del giorno.');
    return;
  }
  feedback.filterChange();
  renderList();
}

/** Ricalcola i giorni con interventi (dopo aver chiuso, riaperto o eliminato un intervento) */
export async function refreshDays() {
  try {
    state.doneDays = new Set(await listEffettuatiDays());
    renderList();
  } catch (err) {
    console.warn('Giorni con interventi non aggiornati.', err);
  }
}

export const dayLabel = (key) => {
  const d = keyToDate(key);
  const today = new Date();
  const yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const rel = key === dayKey(today) ? 'Oggi' : key === dayKey(yest) ? 'Ieri' : d.toLocaleDateString('it-IT', { weekday: 'short' }).replace(/^./, (c) => c.toUpperCase());
  return `${rel} · ${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

function paintDateRow() {
  const row = $('int-date-row');
  row.classList.toggle('hidden', state.tab !== 'done');
  if (state.tab !== 'done') return;
  $('int-date-label').textContent = state.doneDay ? dayLabel(state.doneDay) : 'Scegli il giorno';
  const days = [...state.doneDays].sort();
  $('int-date-prev').disabled = !days.some((k) => k < state.doneDay);
  $('int-date-next').disabled = !days.some((k) => k > state.doneDay);
}

export async function stepDay(delta) {
  const days = [...state.doneDays].sort();
  const target = delta < 0 ? [...days].reverse().find((k) => k < state.doneDay) : days.find((k) => k > state.doneDay);
  if (target) await selectDay(target);
}

export async function ensureRapidi(force = false) {
  if (state.rapidiLoaded && !force) return;
  try {
    const res = await listRapidi();
    state.rapidi = res.rapidi;
    state.rapidiLoaded = true;
  } catch (err) {
    console.warn('Interventi rapidi non disponibili.', err);
  }
}

export async function ensureOperatori() {
  if (state.operatoriLoaded) return;
  try {
    state.operatori = sortOperatori((await listOperatori()).operatori.map((o) => o.nome));
    state.operatoriLoaded = true;
  } catch (err) {
    console.warn('Operatori non disponibili.', err);
  }
}

// ---------------------------------------------------------------
// ELENCO
// ---------------------------------------------------------------
export function paintTabs() {
  els.seg.querySelectorAll('[data-int-tab]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.intTab === state.tab));
  syncSegIndicator(els.seg);
  paintDateRow();
}

export function paintFilters() {
  const lv = $('int-filter-linea-value');
  lv.textContent = state.filterLinea ? lineaLabel(state.filterLinea) : 'Tutte le linee';
  lv.classList.toggle('text-graphite-400', !state.filterLinea);
  lv.classList.toggle('text-graphite-100', !!state.filterLinea);
  const mv = $('int-filter-macchina-value');
  mv.textContent = state.filterMacchina || 'Tutte le macchine';
  mv.classList.toggle('text-graphite-400', !state.filterMacchina);
  mv.classList.toggle('text-graphite-100', !!state.filterMacchina);
}

function applyFilters(rows) {
  return rows.filter((r) => (!state.filterLinea || r.linea === state.filterLinea) && (!state.filterMacchina || r.macchina === state.filterMacchina));
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `oggi ${hm}` : `${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${hm}`;
}

/** Avviso negli Effettuati: interventi segnati "Ricambi da indicare" (di qualunque giorno recente). Toccandolo si va al giorno più recente. */
function ricambiBanner() {
  if (state.tab !== 'done') return null;
  const pending = state.doneRecent.filter((r) => r.ricambi_mancanti);
  if (!pending.length) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `w-full text-left rounded-lg px-3.5 py-2.5 text-xs font-medium leading-snug flex items-center gap-2 ${CHIP_RICAMBI}`;
  btn.innerHTML = '<i data-lucide="triangle-alert" class="w-4 h-4 shrink-0"></i><span data-text></span>';
  btn.querySelector('[data-text]').textContent = `${pending.length} ${pending.length === 1 ? 'intervento effettuato senza ricambi indicati' : 'interventi effettuati senza ricambi indicati'}. Tocca per vederli.`;
  btn.addEventListener('click', () => {
    feedback.tap();
    selectDay(dayKey(new Date(pending[0].esito_at))); // doneRecent è dal più recente: si va al giorno dell'ultimo
  });
  return btn;
}

export function renderList() {
  els.notice.classList.toggle('hidden', !state.tableMissing);
  // Il pulsante PDF è bianco e toccabile solo se esiste almeno un intervento effettuato
  // Due pulsanti distinti nello stesso posto: negli Effettuati il rapporto dei lavori eseguiti,
  // nei Da effettuare il foglio per operatore con le caselle da spuntare.
  const pdfBtn = $('int-pdf-btn');
  const todoBtn = $('int-pdf-todo-btn');
  pdfBtn.classList.toggle('hidden', state.tab !== 'done');
  todoBtn.classList.toggle('hidden', state.tab !== 'open');
  todoBtn.disabled = !state.open.length;
  pdfBtn.disabled = !state.doneDays.size;
  pdfBtn.title = state.doneDays.size ? 'Esporta PDF degli interventi effettuati' : 'Nessun intervento effettuato da esportare';
  paintDateRow();
  const openCount = applyFilters(state.open).length;
  $('int-count-open').textContent = openCount ? `(${openCount})` : '';
  $('int-count-done').textContent = ''; // negli Effettuati il numero non si mostra

  const rows = applyFilters(state.tab === 'open' ? state.open : state.done);
  els.list.innerHTML = '';
  if (!rows.length) {
    const filtered = state.filterLinea || state.filterMacchina;
    els.list.innerHTML = emptyStateHtml(
      state.tab === 'open' ? 'clipboard-check' : 'clipboard-list',
      filtered ? 'Nessun intervento con questi filtri' : state.tab === 'open' ? 'Nessun intervento da fare' : 'Nessun intervento effettuato in questo giorno',
      filtered ? 'Cambia o togli i filtri di linea e macchina.' : state.tab === 'open' ? 'Tocca + per annotarne uno nuovo.' : 'Scegli un giorno con il pallino blu nel calendario.'
    );
    const emptyBanner = ricambiBanner();
    if (emptyBanner) els.list.prepend(emptyBanner);
    window.lucide?.createIcons();
    return;
  }

  const banner = ricambiBanner();
  if (banner) els.list.appendChild(banner);

  // Ordine: prima per linea, poi per macchina (ordine scelto dall'admin). Ogni linea è un gruppo chiuso che si
  // apre al tocco; dentro, una macchina con più interventi è a sua volta un gruppo, con un solo intervento
  // si mostra direttamente. Con un filtro attivo i gruppi si aprono da soli (c'è già poco da cercare).
  const orderIdx = new Map(state.machineOrder.map((n, i) => [n.toLowerCase(), i]));
  const idxOf = (m) => (orderIdx.has(m.toLowerCase()) ? orderIdx.get(m.toLowerCase()) : 9999);
  const byLinea = new Map();
  rows.forEach((r) => {
    if (!byLinea.has(r.linea)) byLinea.set(r.linea, new Map());
    const machines = byLinea.get(r.linea);
    if (!machines.has(r.macchina)) machines.set(r.macchina, []);
    machines.get(r.macchina).push(r);
  });
  const lineaIdx = (v) => (LINEE.findIndex((l) => l.value === v) + 1 || 99);
  const timeSort = (a, b) => (state.tab === 'done' ? new Date(a.esito_at) - new Date(b.esito_at) : new Date(b.created_at) - new Date(a.created_at));
  const unseenIds = new Set(rows.filter(isUnseen).map((r) => r.id));
  const countNew = (items) => items.filter((r) => unseenIds.has(r.id)).length;
  const filtering = !!(state.filterLinea || state.filterMacchina);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  let i = 0;
  [...byLinea.keys()].sort((a, b) => lineaIdx(a) - lineaIdx(b)).forEach((linea) => {
    const machines = byLinea.get(linea);
    const names = [...machines.keys()].sort((a, b) => idxOf(a) - idxOf(b) || a.localeCompare(b, 'it'));
    const all = names.flatMap((n) => machines.get(n));
    const lineaKey = `${state.tab}|${linea}`;
    const group = buildGroup({
      icon: linea === 'REP' ? 'warehouse' : 'factory',
      title: lineaLabel(linea),
      sub: `${plural(all.length, 'intervento', 'interventi')} · ${plural(names.length, 'macchina', 'macchine')}`,
      newCount: countNew(all),
      open: filtering || state.openLinee.has(lineaKey),
      auto: filtering,
      set: state.openLinee,
      key: lineaKey,
      headPad: 'py-3.5',
    });
    group.el.style.setProperty('--i', staggerIndex(i++));

    names.forEach((name) => {
      const items = machines.get(name).sort(timeSort);
      if (items.length === 1) {
        // Un solo intervento: si mostra direttamente, con il nome della macchina in testa alla scheda
        const card = document.createElement('div');
        card.className = 'card-plate rounded-xl overflow-hidden';
        card.innerHTML = `
          <div class="flex items-center justify-between gap-2 px-3.5 py-2 bg-graphite-800/70">
            <h4 class="min-w-0 truncate font-display font-bold text-sm uppercase tracking-wider text-graphite-100">${escapeHtml(name)}</h4>
          </div>`;
        card.appendChild(buildRow(items[0], unseenIds.has(items[0].id)));
        group.inner.appendChild(card);
        return;
      }
      // Più interventi sulla stessa macchina: gruppo a sua volta chiuso
      const machineKey = `${state.tab}|${linea}|${name}`;
      const sub = buildGroup({
        icon: 'cog',
        title: name,
        sub: plural(items.length, 'intervento', 'interventi'),
        newCount: countNew(items),
        open: !!state.filterMacchina || state.openMacchine.has(machineKey),
        auto: !!state.filterMacchina,
        set: state.openMacchine,
        key: machineKey,
        headPad: 'py-2.5',
        flat: true,
      });
      const card = document.createElement('div');
      card.className = 'card-plate rounded-xl overflow-hidden';
      items.forEach((r, n) => {
        const row = buildRow(r, unseenIds.has(r.id));
        if (n === 0) row.classList.remove('border-t');
        card.appendChild(row);
      });
      sub.inner.appendChild(card);
      group.inner.appendChild(sub.el);
    });
    els.list.appendChild(group.el);
  });
  window.lucide?.createIcons();
  loadThumbs(rows);
}

/**
 * Gruppo che si apre e si chiude con l'animazione a cassetto degli scaffali del Magazzino
 * (.shelf-group): intestazione bianca che si tinge di blu dal centro dell'icona, chevron che ruota.
 * `set` ricorda i gruppi aperti tra un disegno dell'elenco e l'altro; con `auto` (filtri attivi) lo
 * stato non si memorizza. `newCount` = interventi nuovi (pallino) nascosti dentro il gruppo chiuso.
 */
function buildGroup({ icon, title, sub, newCount, open, auto, set, key, headPad, flat = false }) {
  const el = document.createElement('div');
  el.className = `list-item-in shelf-group${open ? ' group-open group-settled' : ''}`;
  el.innerHTML = `
    <div class="shelf-group-header flex items-center justify-between gap-3 px-4 ${headPad} border-2 border-graphite-700 rounded-xl" role="button" tabindex="0" aria-expanded="${open}">
      <div class="flex items-center gap-3 min-w-0">
        <span class="shelf-ico-box shrink-0 w-9 h-9 rounded-lg bg-graphite-700/50 flex items-center justify-center">
          <i data-lucide="${icon}" class="shelf-ico w-[18px] h-[18px] text-graphite-400" stroke-width="1.8"></i>
        </span>
        <div class="min-w-0">
          <p class="shelf-title font-display font-bold uppercase tracking-wide truncate">${escapeHtml(title)}</p>
          <p class="shelf-sub ui-note text-graphite-500 mt-0.5 flex flex-wrap gap-x-2">
            <span class="whitespace-nowrap">${escapeHtml(sub)}</span>${newCount ? `<span class="ig-new whitespace-nowrap" data-new="${newCount}">${newCount} ${newCount === 1 ? 'nuovo' : 'nuovi'}</span>` : ''}
          </p>
        </div>
      </div>
      <i data-lucide="chevron-down" class="shelf-chevron w-5 h-5 text-graphite-400 shrink-0" stroke-width="2"></i>
    </div>
    <div class="group-body-track">
      <div class="group-body-inner"><div class="group-shelves${flat ? ' group-shelves--flat' : ''} space-y-2.5"></div></div>
    </div>`;
  const head = el.querySelector('.shelf-group-header');
  const track = el.querySelector('.group-body-track');
  const inner = el.querySelector('.group-shelves');

  // A gruppo aperto del tutto si toglie il ritaglio (come per gli scaffali), così nulla resta tagliato
  let settleTimer = null;
  const settle = () => {
    clearTimeout(settleTimer);
    if (el.classList.contains('group-open')) el.classList.add('group-settled');
  };
  track.addEventListener('transitionend', (e) => {
    if (e.target === track && e.propertyName === 'grid-template-rows') settle();
  });

  const toggle = () => {
    const on = !el.classList.contains('group-open');
    if (!auto) {
      if (on) set.add(key);
      else set.delete(key);
    }
    feedback.tap();
    el.classList.toggle('group-open', on);
    head.setAttribute('aria-expanded', String(on));
    clearTimeout(settleTimer);
    if (on) settleTimer = setTimeout(settle, modalCloseMs() + 120); // ripiego se transitionend non arriva
    else el.classList.remove('group-settled');
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  return { el, inner };
}

/** Presa visione di un intervento: i contatori «N nuovi» dei gruppi che lo contengono scendono di uno */
function dropNewBadge(row) {
  for (let g = row.closest('.shelf-group'); g; g = g.parentElement?.closest('.shelf-group')) {
    const badge = g.querySelector(':scope > .shelf-group-header .ig-new');
    if (!badge) continue;
    const n = Number(badge.dataset.new || 0) - 1;
    if (n > 0) {
      badge.dataset.new = String(n);
      badge.textContent = `${n} ${n === 1 ? 'nuovo' : 'nuovi'}`;
    } else {
      badge.remove();
    }
  }
}

/** Riga di un intervento dentro la scheda della macchina */
function buildRow(r, isNew) {
  const row = document.createElement('button');
  row.type = 'button';
  row.dataset.id = r.id;
  row.className = 'int-row relative w-full text-left pl-7 pr-3.5 py-3 flex items-start gap-3 border-t border-graphite-700/70';
  let unseen = isNew;
  const ops = operatoriDi(r);
  const who = r.stato === 'effettuato' ? (ops.length ? ops.map(formatOperatore).join(', ') : r.esito_by_name) : r.created_by_name;
  const when = r.stato === 'effettuato' ? `Fatto ${fmtDateTime(r.esito_at)}${who ? ` · ${who}` : ''}` : `${fmtDateTime(r.created_at)}${who ? ` · ${who}` : ''}`;
  row.innerHTML = `
    <div class="min-w-0 flex-1">
      ${r.stato === 'sospeso' ? `<span class="inline-block ui-label font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1 mr-1 ${STATO_CHIP.sospeso}">${STATI.sospeso}</span>` : ''}
      ${r.rapido_id && r.stato !== 'effettuato' ? `<span class="inline-block ui-label font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1 mr-1 bg-sky-100 text-sky-800">Programmato</span>` : ''}
      ${r.ricambi_mancanti ? `<span class="inline-block ui-label font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1 ${CHIP_RICAMBI}">Ricambi da indicare</span>` : ''}
      <p class="text-sm font-medium text-graphite-100 leading-snug line-clamp-3">${escapeHtml(r.descrizione)}</p>
      ${r.stato !== 'effettuato' && r.dettagli ? `<p class="text-xs text-graphite-500 mt-1 line-clamp-2">Dettagli: ${escapeHtml(r.dettagli)}</p>` : ''}
      ${r.note_esito ? `<p class="text-xs text-graphite-500 mt-1 line-clamp-1">${r.stato === 'effettuato' ? 'Post intervento' : 'Da completare'}: ${escapeHtml(r.note_esito)}</p>` : ''}
      ${r.stato !== 'effettuato' && ops.length ? `<p class="text-xs text-graphite-500 mt-1 line-clamp-1">Assegnato a: ${escapeHtml(sortOperatori(ops).map(formatOperatore).join(', '))}</p>` : ''}
      ${ricambiDi(r).length ? `<p class="text-xs text-graphite-500 mt-1 line-clamp-1">Ricambi: ${escapeHtml(ricambiDi(r).map(ricambiLabel).join(', '))}</p>` : ''}
      <p class="ui-note text-graphite-500 mt-1">${escapeHtml(when)}</p>
    </div>
    <img class="int-thumb hidden" alt="" data-thumb>${unseen ? UNSEEN_DOT_HTML : ''}`;
  row.addEventListener('click', (e) => {
    const onDot = !!e.target.closest('[data-unseen-hit]');
    if (unseen) {
      unseen = false;
      markSeen(r);
      dismissDot(row); // presa visione: il pallino si ingrandisce e implode
      dropNewBadge(row);
      if (onDot) feedback.tap();
    }
    if (onDot) return; // il tocco sul pallino segna solo come visto, senza aprire l'intervento
    openDetail(r);
  });
  return row;
}

/** Miniature caricate dopo il disegno dell'elenco (URL firmati in un'unica richiesta) */
async function loadThumbs(rows) {
  const pathOf = (r) => (r.stato === 'effettuato' && r.foto_esito_path) || r.foto_promemoria_path || r.foto_esito_path;
  const paths = rows.map(pathOf).filter(Boolean);
  if (!paths.length) return;
  try {
    const urls = await signedUrls(paths);
    rows.forEach((r) => {
      const p = pathOf(r);
      const img = els.list.querySelector(`[data-id="${r.id}"] [data-thumb]`);
      if (p && urls[p] && img) {
        img.src = urls[p];
        img.classList.remove('hidden');
        img.classList.add('cursor-zoom-in');
        // Toccando la miniatura si ingrandisce la foto (senza aprire l'intervento)
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          openPhotoViewer(urls[p]);
        });
      }
    });
  } catch (err) {
    console.warn('Miniature non disponibili.', err);
  }
}
