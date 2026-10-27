// =============================================================
// scanner-search.js — Ricerca manuale per codice articolo
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { CATEGORY_BADGE_CLASSES, els, ss } from './scanner-shared.js';
import { CATEGORY_LABELS } from '../magazzino/products.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { isNetworkError } from '../../core/offline-queue.js';
import { listProducts, searchCachedProducts } from '../../data/supabase.js';
import { onProductMatched } from './scanner-result.js';
import { shelfLabel } from '../magazzino/products-shared.js';
import { getProductBarcodes } from '../../data/supabase.js';

// --- RICERCA PER CODICE ARTICOLO --------------------------------------
// Alternativa alla scansione: filtro dinamico mentre si scrive, selezione
// di un risultato dalla tendina obbligatoria per procedere — non esiste un
// modo di "inviare" il testo digitato cosí com'è, quindi non si può
// procedere con un codice che non esiste davvero a magazzino.

export function initCodeSearch() {
  els.codeSearchInput.addEventListener('input', () => {
    clearTimeout(ss.codeSearchDebounce);
    const term = els.codeSearchInput.value.trim();
    if (!term) {
      closeCodeSearchPanel();
      return;
    }
    ss.codeSearchDebounce = setTimeout(() => runCodeSearch(term), 250);
  });
  els.codeSearchInput.addEventListener('focus', () => {
    if (els.codeSearchInput.value.trim()) openCodeSearchPanel();
  });
  document.addEventListener('click', (e) => {
    if (!els.codeSearchWrap.contains(e.target)) closeCodeSearchPanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.codeSearchWrap.classList.contains('custom-select-open')) closeCodeSearchPanel();
  });
}

export function resetCodeSearch() {
  els.codeSearchInput.value = '';
  closeCodeSearchPanel();
}

function openCodeSearchPanel() {
  els.codeSearchWrap.classList.add('custom-select-open');
}
export function closeCodeSearchPanel() {
  els.codeSearchWrap.classList.remove('custom-select-open');
}

async function runCodeSearch(term) {
  const seq = ++ss.codeSearchSeq;
  els.codeSearchResults.innerHTML = '<p class="text-center text-xs text-graphite-500 py-4">Ricerca…</p>';
  openCodeSearchPanel();

  let results = [];
  let offline = false;
  try {
    results = await listProducts({ search: term });
  } catch (err) {
    if (!isNetworkError(err)) console.error(err);
    results = searchCachedProducts(term);
    offline = true;
  }
  if (seq !== ss.codeSearchSeq) return; // l'utente ha digitato altro nel frattempo, risposta obsoleta

  renderCodeSearchResults(rankResults(results, term), offline);
}

// --- ORDINE PER PERTINENZA --------------------------------------------
// La lista non è più solo per codice: conta DOVE la parola cercata compare. Codice e codice a barre contano di più, poi il
// punto di utilizzo e la descrizione (a inizio testo più che a metà), poi macchina e scaffale. I cuscinetti si cercano per
// codice: se compaiono solo perché il loro punto di utilizzo contiene la parola, vanno dopo cinghie e ricambi, che invece
// si riconoscono proprio da quel testo.
const startsWith = (text, t) => String(text || '').toLowerCase().startsWith(t);
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordStart = (text, t) => new RegExp(`(^|[\\s\\-/.(_,;:])${escapeRe(t)}`, 'i').test(String(text || ''));

function relevance(product, tokens) {
  const bearing = product.categoria === 'cuscinetti';
  const barcodes = [product.codice_barre, ...getProductBarcodes(product).map((b) => b.codice_barre)];
  let total = 0;
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    let best = 0;
    const consider = (score, ok) => {
      if (ok && score > best) best = score;
    };
    consider(100, startsWith(product.codice_articolo, t));
    consider(90, wordStart(product.codice_articolo, t));
    consider(95, barcodes.some((b) => startsWith(b, t)));
    for (const text of [product.punto_utilizzo_standard, product.descrizione]) {
      consider(bearing ? 55 : 70, startsWith(text, t));
      consider(bearing ? 45 : 60, wordStart(text, t));
    }
    consider(40, wordStart(product.macchina, t));
    consider(30, wordStart(product.locazione, t));
    total += best;
  }
  return total;
}

function rankResults(results, term) {
  const tokens = String(term || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return results;
  return results.map((p) => ({ p, r: relevance(p, tokens) })).sort((a, b) => b.r - a.r).map((x) => x.p); // a parità resta l'ordine per codice
}

function renderCodeSearchResults(results, offline) {
  els.codeSearchResults.innerHTML = '';

  if (offline && results.length) {
    const notice = document.createElement('p');
    notice.className = 'px-3.5 pt-2.5 ui-note text-amber-300';
    notice.textContent = 'Offline: risultati dall\'ultima sincronizzazione.';
    els.codeSearchResults.appendChild(notice);
  }

  if (!results.length) {
    els.codeSearchResults.innerHTML += `<p class="text-center text-xs text-graphite-500 py-4">Nessun articolo trovato.</p>`;
    return;
  }

  results.slice(0, 30).forEach((product) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'custom-select-option w-full text-left px-3.5 py-2.5 text-sm flex items-center justify-between gap-2 border-t border-graphite-700 first:border-t-0';
    const badgeClass = CATEGORY_BADGE_CLASSES[product.categoria] || 'bg-graphite-700 text-graphite-200';
    const label = CATEGORY_LABELS[product.categoria] || product.categoria;
    // Ricambi tecnici: il codice (es. 64M-456393) non dice nulla, si legge il testo scritto (descrizione / punto di utilizzo).
    // Cuscinetti e cinghie: codice in evidenza e, sotto, il punto di utilizzo.
    const described = [product.descrizione, product.punto_utilizzo_standard]
      .map((x) => String(x || '').trim())
      .filter((x, i, all) => x && all.indexOf(x) === i);
    const byText = product.categoria === 'pezzi_ricambio' && described.length > 0;
    const subtitleParts = [...(byText ? [] : described.slice(0, 1)), shelfLabel(product), product.macchina].filter(Boolean);
    const title = byText
      ? `<span class="block font-display font-semibold text-graphite-100 leading-snug" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(described.join(' · '))}</span>`
      : `<span class="block font-mono font-semibold text-graphite-100 truncate">${escapeHtml(product.codice_articolo)}</span>`;
    row.innerHTML = `
      <span class="min-w-0">
        ${title}
        ${subtitleParts.length ? `<span class="block ui-note text-graphite-500 truncate">${escapeHtml(subtitleParts.join(' · '))}</span>` : ''}
      </span>
      <span class="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full ui-label font-display font-semibold uppercase tracking-wide ${badgeClass}">${escapeHtml(label)}</span>
    `;
    row.addEventListener('click', () => {
      resetCodeSearch();
      onProductMatched(product);
    });
    els.codeSearchResults.appendChild(row);
  });
}
