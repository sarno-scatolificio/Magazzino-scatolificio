// =============================================================
// supabase-products.js — Articoli (con relative scaffali e codici a barre) e cache locale per l'uso offline
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase } from './supabase-client.js';

// --- CACHE LOCALE PRODOTTI (per consultazione offline) --------------
// Copia "best effort" dell'ultimo stato noto degli articoli, salvata in
// localStorage ogni volta che una lettura va a buon fine. Non sostituisce
// mai una query online riuscita: serve solo come ultima spiaggia quando
// la rete manca (scanner in modalità offline, coda transazioni).
const PRODUCT_CACHE_KEY = 'magazzino-product-cache';

function loadProductCache() {
  try {
    return JSON.parse(localStorage.getItem(PRODUCT_CACHE_KEY) || '{}');
  } catch (err) {
    return {};
  }
}
function saveProductCache(cache) {
  try {
    localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Impossibile salvare la cache offline dei prodotti.', err);
  }
}
/** Aggiorna la cache con un elenco di prodotti appena letto dal server */
export function cacheProductsList(list) {
  if (!Array.isArray(list) || !list.length) return;
  const cache = loadProductCache();
  for (const p of list) {
    cache.byId = cache.byId || {};
    cache.byId[p.id] = p;
    cache.byBarcode = cache.byBarcode || {};
    for (const b of getProductBarcodes(p)) cache.byBarcode[b.codice_barre] = p.id;
  }
  saveProductCache(cache);
}
/** Cerca un prodotto nella cache locale per barcode, quando la rete non risponde */
export function getCachedProductByBarcode(codiceBarre) {
  const cache = loadProductCache();
  const id = cache.byBarcode?.[codiceBarre];
  return id != null ? cache.byId?.[id] || null : null;
}
/** Cerca prodotti nella cache locale per codice articolo (o barcode),
 *  quando la rete non risponde — fallback offline della ricerca manuale
 *  per codice articolo nello scanner. */
export function searchCachedProducts(term) {
  const q = (term || '').trim().toLowerCase();
  if (!q) return [];
  const cache = loadProductCache();
  const all = Object.values(cache.byId || {});
  return all.filter(
    (p) =>
      (p.codice_articolo || '').toLowerCase().includes(q) ||
      getProductBarcodes(p).some((b) => b.codice_barre.toLowerCase().includes(q))
  );
}
/**
 * Aggiorna otticamente la giacenza di un prodotto in cache dopo una
 * transazione messa in coda offline, cosí lo scanner mostra un valore
 * coerente anche prima della sincronizzazione.
 */
// Contatore condiviso: aumenta ogni volta che una giacenza cambia (movimento registrato,
// movimento offline sincronizzato). Il Magazzino lo confronta con l'ultimo valore visto
// per sapere se la lista in memoria va aggiornata (in silenzio) al rientro nella sezione.
let productsVersion = 0;
export function getProductsVersion() {
  return productsVersion;
}
export function bumpProductsVersion() {
  productsVersion += 1;
}

export function adjustCachedProductQuantity(id, delta, locationId = null) {
  const cache = loadProductCache();
  const p = cache.byId?.[id];
  if (!p) return;
  p.quantita_disponibile = (p.quantita_disponibile || 0) + delta;
  // Aggiorna anche lo scaffale interessato (quello scelto, o l'unico se l'articolo ne ha uno solo)
  if (Array.isArray(p.locations)) {
    const loc = locationId ? p.locations.find((l) => l.id === locationId) : p.locations.length === 1 ? p.locations[0] : null;
    if (loc) loc.quantita = Math.max(0, (loc.quantita || 0) + delta);
  }
  saveProductCache(cache);
}

// --- PRODUCTS ----------------------------------------------------
// Ogni articolo può stare su più scaffali, ciascuno con la sua quantità (tabella
// `product_locations`). products.quantita_disponibile è sempre il TOTALE e
// products.locazione un riepilogo testuale degli scaffali: entrambi li aggiorna il
// database da solo. Nel codice, ogni articolo letto porta `locations`:
// [{ id, locazione, quantita }], ordinate per scaffale (senza scaffale in fondo).
const PRODUCT_SELECT = '*, product_locations(id, locazione, quantita), product_barcodes(id, codice_barre, produttore, ordine)';

const shelfCompare = (a, b) =>
  (a.locazione == null) - (b.locazione == null) ||
  String(a.locazione || '').localeCompare(String(b.locazione || ''), 'it', { numeric: true, sensitivity: 'base' });

/** Scaffali di un articolo: sempre un array, anche per articoli letti dalla cache di prima della gestione multi-scaffale */
export function getProductLocations(p) {
  if (Array.isArray(p?.locations)) return p.locations;
  const locazione = (p?.locazione || '').trim() || null;
  return [{ id: null, locazione, quantita: p?.quantita_disponibile || 0 }];
}

/**
 * Tutti i codici a barre di un articolo, il principale per primo: [{ codice_barre, produttore, principale }].
 * Funziona anche con articoli letti dalla cache di prima dei codici multipli.
 */
export function getProductBarcodes(p) {
  const list = [];
  const main = (p?.codice_barre || '').trim();
  if (main) list.push({ codice_barre: main, produttore: (p.produttore_barcode || '').trim() || null, principale: true });
  for (const b of Array.isArray(p?.barcodes_extra) ? p.barcodes_extra : []) {
    const code = (b?.codice_barre || '').trim();
    if (code) list.push({ codice_barre: code, produttore: (b.produttore || '').trim() || null, principale: false });
  }
  return list;
}

/** Trasforma una riga letta dal database (con product_locations e product_barcodes incorporate) nell'articolo usato dall'app */
function normalizeProduct(row) {
  if (!row) return row;
  const { product_locations: embedded, product_barcodes: embeddedBarcodes, ...p } = row;
  const rawBarcodes = Array.isArray(embeddedBarcodes) ? embeddedBarcodes : Array.isArray(p.barcodes_extra) ? p.barcodes_extra : [];
  p.barcodes_extra = rawBarcodes
    .map((b) => ({ id: b.id ?? null, codice_barre: b.codice_barre, produttore: b.produttore || null, ordine: b.ordine ?? 0 }))
    .sort((a, b) => a.ordine - b.ordine);
  const raw = Array.isArray(embedded) ? embedded : Array.isArray(p.locations) ? p.locations : null;
  p.locations = raw
    ? raw.map((l) => ({ id: l.id ?? null, locazione: l.locazione || null, quantita: l.quantita || 0 })).sort(shelfCompare)
    : getProductLocations(p);
  return p;
}

/**
 * Rende sicuro il testo cercato dall'utente dentro un filtro ilike.
 *  - `\`, `%` e `_` valgono come caratteri normali (non come jolly di LIKE);
 *  - con `quoted` il valore è tra virgolette: dentro un filtro `.or()` virgole, punti e parentesi
 *    non vengono più scambiati per la sintassi del filtro (es. "6204,2RS" prima dava errore).
 */
function ilikeContains(text, { quoted = false } = {}) {
  const literal = String(text).replace(/[\\%_]/g, '\\$&');
  if (!quoted) return `%${literal}%`;
  return `"%${literal.replace(/[\\"]/g, '\\$&')}%"`;
}

export async function listProducts({ search = '', onlyLowStock = false, categoria = null } = {}) {
  let query = supabase.from('products').select(PRODUCT_SELECT).order('codice_articolo', { ascending: true });

  if (categoria) query = query.eq('categoria', categoria);
  if (search) {
    // I codici a barre secondari stanno in un'altra tabella: si cercano prima lì e gli articoli trovati si aggiungono al filtro
    let extraIds = [];
    try {
      const { data: hits } = await supabase.from('product_barcodes').select('product_id').ilike('codice_barre', ilikeContains(search));
      extraIds = [...new Set((hits || []).map((h) => h.product_id))];
    } catch (err) {
      console.warn('Ricerca nei codici a barre secondari non riuscita.', err);
    }
    // `locazione` è il riepilogo testuale degli scaffali: cercare "SB002" trova anche gli articoli che ci stanno insieme ad altri scaffali
    const like = ilikeContains(search, { quoted: true });
    const campi = ['codice_articolo', 'codice_barre', 'locazione', 'punto_utilizzo_standard', 'descrizione', 'macchina'];
    query = query.or(
      campi.map((c) => `${c}.ilike.${like}`).join(',') + (extraIds.length ? `,id.in.(${extraIds.join(',')})` : '')
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const list = data.map(normalizeProduct);
  cacheProductsList(list);
  // La scorta minima vale sul totale di tutti gli scaffali (quantita_disponibile è il totale)
  if (onlyLowStock) return list.filter((p) => p.quantita_disponibile < p.scorta_minima);
  return list;
}

export async function getProductByBarcode(codiceBarre) {
  const { data, error } = await supabase.rpc('get_product_by_barcode', {
    p_codice_barre: codiceBarre,
  });
  if (error) throw error;
  const row = data?.[0] ?? null;
  if (!row) return null;
  const [{ data: locs, error: locErr }, { data: codes, error: codesErr }] = await Promise.all([
    supabase.from('product_locations').select('id, locazione, quantita').eq('product_id', row.id),
    supabase.from('product_barcodes').select('id, codice_barre, produttore, ordine').eq('product_id', row.id),
  ]);
  if (locErr) throw locErr;
  if (codesErr) throw codesErr;
  const product = normalizeProduct({ ...row, product_locations: locs, product_barcodes: codes });
  cacheProductsList([product]);
  return product;
}

export async function getProductById(id) {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single();
  if (error) throw error;
  return normalizeProduct(data);
}

/**
 * Sostituisce gli scaffali di un articolo con l'elenco dato (solo admin, in modo atomico):
 * quelli presenti si aggiornano, i nuovi si aggiungono, quelli non più in elenco si tolgono.
 * @param {string} productId
 * @param {{locazione: string|null, quantita: number}[]} locations
 */
export async function setProductLocations(productId, locations) {
  const rows = (locations || []).map((l) => ({
    locazione: (l.locazione || '').trim() || null,
    quantita: Math.max(0, parseInt(l.quantita, 10) || 0),
  }));
  const { error } = await supabase.rpc('set_product_locations', { p_product_id: productId, p_rows: rows });
  if (error) throw error;
}

/**
 * Imposta il codice a barre principale (con il suo produttore) e gli altri codici dell'articolo,
 * in modo atomico (solo admin). Il database rifiuta i codici già usati da un altro articolo.
 * @param {string} productId
 * @param {{primary: string|null, primaryMaker?: string|null, extras?: {codice_barre: string, produttore?: string|null}[]}} barcodes
 */
export async function setProductBarcodes(productId, { primary = null, primaryMaker = null, extras = [] } = {}) {
  const rows = (extras || [])
    .map((b) => ({ codice_barre: (b.codice_barre || '').trim(), produttore: (b.produttore || '').trim() || null }))
    .filter((b) => b.codice_barre);
  const { error } = await supabase.rpc('set_product_barcodes', {
    p_product_id: productId,
    p_primary: (primary || '').trim() || null,
    p_primary_maker: (primaryMaker || '').trim() || null,
    p_extras: rows,
  });
  if (error) throw error;
}

// I codici a barre (principale, produttore, altri) li scrive solo set_product_barcodes: tolgono i conflitti
// tra principale e secondari quando si scambiano, e il database controlla l'unicità.
function withoutBarcodeColumns(row) {
  const { codice_barre, produttore_barcode, barcodes_extra, product_barcodes, ...rest } = row || {};
  return { rest, codice_barre, produttore_barcode, barcodes_extra };
}
/** Se non arrivano codici espliciti ma la riga ne contiene (annulla/ripeti, chiamate vecchie), li si ricava da lì */
function barcodesFromRow(row, explicit) {
  if (explicit) return explicit;
  const { codice_barre, produttore_barcode, barcodes_extra } = withoutBarcodeColumns(row);
  if (codice_barre === undefined && barcodes_extra === undefined) return null;
  return { primary: codice_barre ?? null, primaryMaker: produttore_barcode ?? null, extras: barcodes_extra ?? [] };
}

// Giacenza totale e riepilogo scaffali di `products` li gestisce il database a partire dagli
// scaffali: i campi `locazione` / `quantita_disponibile` non si scrivono più direttamente.
function withoutStockColumns(row) {
  const { locazione, quantita_disponibile, locations, product_locations, ...rest } = row || {};
  return { rest, locazione, quantita_disponibile };
}

/**
 * Crea un articolo. `locations` = scaffali con quantità; se manca, si usano (per compatibilità)
 * gli eventuali `locazione` / `quantita_disponibile` presenti nell'articolo.
 */
export async function createProduct(product, locations = null, barcodes = null) {
  const codes = barcodesFromRow(product, barcodes);
  const { rest: noStock, locazione, quantita_disponibile } = withoutStockColumns(product);
  const { rest } = withoutBarcodeColumns(noStock);
  const locs =
    locations ?? (locazione || quantita_disponibile ? [{ locazione: locazione || null, quantita: quantita_disponibile || 0 }] : []);
  const { data, error } = await supabase.from('products').insert(rest).select('id').single();
  if (error) throw error;
  try {
    await setProductLocations(data.id, locs);
    if (codes) await setProductBarcodes(data.id, codes);
  } catch (err) {
    // Articolo senza i suoi scaffali (o con codici a barre rifiutati) = dati incompleti: lo si toglie e si segnala l'errore
    await supabase.from('products').delete().eq('id', data.id);
    throw err;
  }
  return getProductById(data.id);
}

export async function updateProduct(id, patch, locations = null, barcodes = null) {
  const codes = barcodesFromRow(patch, barcodes);
  const { rest: noStock } = withoutStockColumns(patch);
  const { rest } = withoutBarcodeColumns(noStock);
  if (Object.keys(rest).length) {
    const { error } = await supabase.from('products').update(rest).eq('id', id).select('id').single();
    if (error) throw error;
  }
  if (locations) await setProductLocations(id, locations);
  if (codes) await setProductBarcodes(id, codes);
  return getProductById(id);
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Importa/aggiorna in massa gli articoli di una categoria (upsert su
 * categoria + codice_articolo) tramite la funzione SQL bulk_upsert_products.
 * @param {'cuscinetti'|'cinghie'|'pezzi_ricambio'} categoria
 * @param {object[]} rows righe già mappate ai campi della tabella products
 */
export async function bulkUpsertProducts(categoria, rows) {
  const { data, error } = await supabase.rpc('bulk_upsert_products', {
    p_categoria: categoria,
    p_rows: rows,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}
