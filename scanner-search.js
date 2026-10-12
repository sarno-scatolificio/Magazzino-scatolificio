// =============================================================
// scanner-search.js — Ricerca manuale per codice articolo
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { CATEGORY_BADGE_CLASSES, els, ss } from './scanner-shared.js';
import { CATEGORY_LABELS } from './products.js';
import { escapeHtml } from './html-utils.js';
import { isNetworkError } from './offline-queue.js';
import { listProducts, searchCachedProducts } from './supabase.js';
import { onProductMatched } from './scanner-result.js';
import { shelfLabel } from './products-shared.js';

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

  renderCodeSearchResults(results, offline);
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
    const subtitleParts = [shelfLabel(product), product.macchina].filter(Boolean);
    row.innerHTML = `
      <span class="min-w-0">
        <span class="block font-mono font-semibold text-graphite-100 truncate">${escapeHtml(product.codice_articolo)}</span>
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
