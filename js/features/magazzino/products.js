// =============================================================
// products.js — Magazzino: file principale/orchestratore. Inizializza i
// tre moduli (products-list.js, products-data.js, products-detail.js),
// e gestisce la barra di ricerca (il testo arriva dalla ricerca in testata).
// =============================================================

import { refreshManualsCache } from '../manuali/manuals.js';
import { els, state, CATEGORY_LABELS } from './products-shared.js';
import { initProductsList, setCategory, setListStatic, collapseAllShelves } from './products-list.js';
import { initProductsData, refresh, enterProducts, resetProducts } from './products-data.js';
import { initProductsDetail, stopBarcodeScan } from './products-detail.js';

export { CATEGORY_LABELS };
export { refresh, enterProducts, resetProducts };

export function initProducts() {
  // Cache dei manuali ricambi (macchina → PDF): caricata subito, non solo da Admin,
  // perché il pulsante "Apri manuale" in Ricambi tecnici serve anche agli operatori.
  refreshManualsCache();

  els.searchInput = document.getElementById('product-search-input');
  els.skeleton = document.getElementById('product-list-skeleton');
  els.emptyState = document.getElementById('product-empty-state');
  els.lowStockToggle = document.getElementById('product-lowstock-toggle');

  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(refresh, 280);
  });
  els.lowStockToggle.addEventListener('change', refresh);

  initProductsDetail();
  initProductsList();
  initProductsData();

  setCategory(state.currentCategory);
}

let searchDebounce = null;

/** Chiamata quando si esce dalla vista Magazzino: chiude eventuali fotocamere rimaste aperte */
export function teardownProducts() {
  stopBarcodeScan();
  // Uscendo dal Magazzino: al rientro gli elementi già presenti non devono rifare l'animazione d'ingresso
  setListStatic(true);
  // ...e al rientro gruppi di scaffali e scaffali devono essere tutti chiusi
  collapseAllShelves();
}
