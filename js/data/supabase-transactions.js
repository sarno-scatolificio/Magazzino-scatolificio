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
export async function processTransaction({ productId, tipo, quantita, puntoUtilizzo, note, linea, macchinario, locationId, teste, puntiTesta }) {
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
  // Teste su cui si montano le piattelle (solo prelievi di piattelle, tante quanto la quantità): senza teste la chiamata resta identica a prima
  if (teste?.length) params.p_teste = teste;
  // Torri con nome o teste superiori/inferiori: [{ torre, testa, pos }] (colonna `punti_testa`, migrazione 2026-11-11)
  if (puntiTesta?.length) params.p_punti_testa = puntiTesta;
  const { data, error } = await supabase.rpc('process_transaction', params);
  if (error) throw error;
  return data?.[0] ?? null;
}

// Colonne lette per gli elenchi dei movimenti. `teste` (teste su cui si montano le piattelle) c'è solo dopo la migrazione
// 2026-11-10-testa-piattelle.sql: se il database non ce l'ha ancora si legge senza e gli elenchi funzionano come prima.
const TX_COLS =
  'id, tipo, quantita, data_ora, punto_utilizzo_specifico, linea, macchinario, teste, punti_testa, locazione, note, product_id, user_id, products(codice_articolo, categoria, descrizione, punto_utilizzo_standard), profiles(full_name)';
// Stesso per `punti_testa` (migrazione 2026-11-11-macchine-torri-teste.sql).
let hasTesteColumn = true;
let hasPuntiColumn = true;

const txCols = () => {
  let c = TX_COLS;
  if (!hasPuntiColumn) c = c.replace(' punti_testa,', '');
  if (!hasTesteColumn) c = c.replace(' teste,', '');
  return c;
};

async function runTxQuery(build) {
  let res = await build(txCols());
  if (res.error && hasPuntiColumn && /punti_testa/i.test(res.error.message || '')) {
    hasPuntiColumn = false;
    res = await build(txCols());
  }
  if (res.error && hasTesteColumn && /teste/i.test(res.error.message || '')) {
    hasTesteColumn = false;
    res = await build(txCols());
  }
  return res;
}

export async function listTransactions({ from, to, productId, limit = 200 } = {}) {
  const { data, error } = await runTxQuery((cols) => {
    let query = supabase.from('transactions').select(cols).order('data_ora', { ascending: false }).limit(limit);
    if (from) query = query.gte('data_ora', from);
    if (to) query = query.lte('data_ora', to);
    if (productId) query = query.eq('product_id', productId);
    return query;
  });
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
    const { data, error } = await runTxQuery((cols) => {
      let query = supabase.from('transactions').select(cols).order('data_ora', { ascending: false }).range(offset, offset + pageSize - 1);
      if (tipo) query = query.eq('tipo', tipo);
      if (from) query = query.gte('data_ora', from);
      if (to) query = query.lte('data_ora', to);
      return query;
    });
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
  // Colonna `teste` (piattelle): se il database non l'ha ancora (migrazione 2026-11-10 non eseguita) si legge senza
  let cols = 'id, quantita, data_ora, punto_utilizzo_specifico, linea, macchinario, teste, punti_testa, note, product_id, products(codice_articolo, categoria)';
  const fetchPage = (from) =>
    supabase.from('transactions').select(cols).eq('tipo', 'prelievo').order('data_ora', { ascending: true }).range(from, from + pageSize - 1);
  for (let from = 0; ; from += pageSize) {
    let { data, error } = await fetchPage(from);
    if (error && cols.includes(' punti_testa,') && /punti_testa/i.test(error.message || '')) {
      cols = cols.replace(' punti_testa,', '');
      ({ data, error } = await fetchPage(from));
    }
    if (error && cols.includes(' teste,') && /teste/i.test(error.message || '')) {
      cols = cols.replace(' teste,', '');
      ({ data, error } = await fetchPage(from));
    }
    if (error) throw error;
    rows.push(...data.filter((r) => !loanIds.has(r.id) && !String(r.note || '').startsWith('Prestito a ')));
    if (data.length < pageSize) break;
  }
  return rows;
}

/** Elimina uno o più movimenti specifici dallo storico (per la Gestione cronologia in Impostazioni). Non tocca la giacenza. */
export async function deleteTransactions(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from('transactions').delete().in('id', ids);
  if (error) throw error;
}

/**
 * Corregge un movimento già registrato (solo Admin, dalla Gestione cronologia). Modifica solo il registro:
 * la giacenza non viene ricalcolata. Se il database non permette l'aggiornamento (policy mancante)
 * la risposta è vuota e si segnala l'errore invece di fingere che sia andata bene.
 */
export async function updateTransaction(id, patch) {
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Modifica non consentita dal database: serve eseguire la migrazione 2026-10-26-modifica-movimenti-admin.sql.');
  }
}
