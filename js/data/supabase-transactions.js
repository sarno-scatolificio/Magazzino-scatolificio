// =============================================================
// supabase-transactions.js — Movimenti di magazzino (deposito/prelievo), storico e statistiche
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase } from './supabase-client.js';

// --- TRANSAZIONI (deposito/prelievo) ------------------------------
/**
 * Esegue in modo atomico deposito o prelievo tramite la funzione SQL
 * process_transaction (SECURITY DEFINER): aggiorna la giacenza e
 * registra il log in una singola transazione DB.
 */
export async function processTransaction({ productId, tipo, quantita, puntoUtilizzo, note, linea, macchinario, locationId }) {
  const params = {
    p_product_id: productId,
    p_tipo: tipo,
    p_quantita: quantita,
    p_punto_utilizzo: puntoUtilizzo || null,
    p_note: note || null,
  };
  // Linea e macchinario si inviano solo se presenti (prelievi): i depositi restano identici a prima.
  if (linea) params.p_linea = linea;
  if (macchinario) params.p_macchinario = macchinario;
  // Scaffale del movimento: obbligatorio per gli articoli su più scaffali, ininfluente se ne hanno uno solo
  if (locationId) params.p_location_id = locationId;
  const { data, error } = await supabase.rpc('process_transaction', params);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function listTransactions({ from, to, productId, limit = 200 } = {}) {
  let query = supabase
    .from('transactions')
    .select('id, tipo, quantita, data_ora, punto_utilizzo_specifico, linea, macchinario, locazione, note, product_id, user_id, products(codice_articolo), profiles(full_name)')
    .order('data_ora', { ascending: false })
    .limit(limit);

  if (from) query = query.gte('data_ora', from);
  if (to) query = query.lte('data_ora', to);
  if (productId) query = query.eq('product_id', productId);

  const { data, error } = await query;
  if (error) throw error;
  return withAdminNames(data);
}

/**
 * Tutti i movimenti di un tipo ('deposito' | 'prelievo') in un intervallo di date, dal più
 * recente al più vecchio, con i dati utili alla scheda di dettaglio del Report.
 * Legge a pagine da 1000 righe (tetto del server), cosí nessun movimento viene tagliato.
 */
export async function listTransactionsRange({ tipo, from, to } = {}) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('transactions')
      .select('id, tipo, quantita, data_ora, punto_utilizzo_specifico, linea, macchinario, locazione, note, product_id, user_id, products(codice_articolo, categoria, punto_utilizzo_standard), profiles(full_name)')
      .order('data_ora', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (tipo) query = query.eq('tipo', tipo);
    if (from) query = query.gte('data_ora', from);
    if (to) query = query.lte('data_ora', to);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return withAdminNames(rows);
}

// Un operatore può leggere i movimenti degli admin ma non i loro profili (RLS su profiles):
// l'incorporamento profiles(full_name) torna vuoto per quelle righe. I nomi degli admin
// (solo id e nome) arrivano da una funzione dedicata, letta una volta sola per sessione.
let adminNamesCache = null;
async function getAdminNames() {
  if (adminNamesCache) return adminNamesCache;
  try {
    const { data, error } = await supabase.rpc('admin_display_names');
    if (error) throw error;
    adminNamesCache = new Map((data || []).map((r) => [r.id, r.full_name]));
    return adminNamesCache;
  } catch (err) {
    console.warn('Nomi degli admin non disponibili.', err);
    return new Map(); // non si memorizza il fallimento: alla prossima lettura si riprova
  }
}

async function withAdminNames(rows) {
  if (!rows?.some((r) => r.user_id && !r.profiles)) return rows; // admin: i nomi ci sono già, nessuna chiamata extra
  const names = await getAdminNames();
  return rows.map((r) => (!r.profiles && names.has(r.user_id) ? { ...r, profiles: { full_name: names.get(r.user_id) } } : r));
}

/**
 * Tutti i prelievi (senza limite di periodo) per calcolare la vita utile dei ricambi.
 * Legge a pagine da 1000 righe, dal più vecchio al più recente.
 */
export async function listPrelieviForLifespan() {
  const pageSize = 1000;
  const rows = [];
  // I prestiti non sono sostituzioni su macchina: restano fuori dalla vita utile (per id del prestito e, in ogni caso, per la nota "Prestito a …")
  let loanIds = new Set();
  try {
    const { data, error } = await supabase.from('prestiti').select('transaction_id').not('transaction_id', 'is', null);
    if (error) throw error;
    loanIds = new Set(data.map((r) => r.transaction_id));
  } catch (err) {
    console.warn('Elenco prestiti non disponibile: si escludono dalla nota.', err);
  }
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, quantita, data_ora, punto_utilizzo_specifico, linea, macchinario, note, product_id, products(codice_articolo, categoria)')
      .eq('tipo', 'prelievo')
      .order('data_ora', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data.filter((r) => !loanIds.has(r.id) && !String(r.note || '').startsWith('Prestito a ')));
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * Elimina permanentemente TUTTI i movimenti (depositi/prelievi) di TUTTI
 * gli articoli, senza eccezioni. Non tocca la giacenza attuale sui
 * products: rimuove solo il log storico. Azione riservata a Impostazioni
 * (solo admin) — irreversibile, va confermata esplicitamente dal chiamante.
 */
export async function deleteAllTransactions() {
  // "not is null" sull'id (chiave primaria, mai nulla) equivale a "tutte le
  // righe": il client Supabase richiede comunque un filtro esplicito, non
  // accetta un .delete() completamente senza condizioni.
  const { error } = await supabase.from('transactions').delete().not('id', 'is', null);
  if (error) throw error;
}

/** Elimina uno o più movimenti specifici dallo storico (per la Gestione cronologia in Impostazioni). Non tocca la giacenza. */
export async function deleteTransactions(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from('transactions').delete().in('id', ids);
  if (error) throw error;
}

/** Aggregazione consumi (prelievi) per articolo, lato client su dataset filtrato */
export async function getConsumptionStats({ from, to } = {}) {
  const rows = await listTransactions({ from, to, limit: 2000 });
  const prelievi = rows.filter((r) => r.tipo === 'prelievo');
  const byProduct = new Map();
  for (const r of prelievi) {
    const key = r.product_id;
    const cur = byProduct.get(key) || {
      product_id: key,
      codice_articolo: r.products?.codice_articolo || '—',
      totale: 0,
    };
    cur.totale += r.quantita;
    byProduct.set(key, cur);
  }
  return Array.from(byProduct.values()).sort((a, b) => b.totale - a.totale);
}
