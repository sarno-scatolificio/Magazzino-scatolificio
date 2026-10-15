// =============================================================
// supabase-shelves.js — Scaffali e aree del magazzino
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase } from './supabase-client.js';
import { normalizeMachineName } from './supabase-machines.js';

// --- SCAFFALI --------------------------------------------------
// Stessa logica delle macchine (tabella `shelves`): il nome dello scaffale degli articoli resta
// testo libero (tabella `product_locations`, una riga per articolo e scaffale), gli scaffali
// "storici" usati solo dagli articoli continuano a comparire negli elenchi anche se non sono
// (ancora) nella tabella `shelves`.

/** Aree in cui si trovano gli scaffali (colonna `shelves.area`, vedi sql/add_shelves_area.sql) */
export const SHELF_AREAS = ['Magazzino', 'Ufficio tecnico'];
export const DEFAULT_SHELF_AREA = 'Magazzino';

// Area di ogni scaffale (nome in minuscolo -> area), tenuta in memoria per mostrarla negli elenchi.
// Gli scaffali non registrati o senza area risultano in Magazzino.
const shelfAreas = new Map();
export function areaOfShelf(nome) {
  return shelfAreas.get(normalizeMachineName(nome || '').toLowerCase()) || DEFAULT_SHELF_AREA;
}
/** Rilegge le aree dal database; in caso di errore (rete, migrazione mancante) resta quanto già in memoria */
export async function loadShelfAreas() {
  try {
    const { data, error } = await supabase.from('shelves').select('nome, area');
    if (error || !data) return;
    shelfAreas.clear();
    data.forEach((r) => {
      const n = normalizeMachineName(r.nome);
      if (n && SHELF_AREAS.includes(r.area)) shelfAreas.set(n.toLowerCase(), r.area);
    });
  } catch (err) {
    console.warn('Impossibile leggere le aree degli scaffali.', err);
  }
}

/** True se l'errore indica che manca la colonna `area` nella tabella `shelves` (migrazione non ancora eseguita) */
function isMissingAreaColumn(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || error?.code === 'PGRST204' || (/area/.test(msg) && /column|schema cache/i.test(msg));
}

/** True se l'errore indica che la tabella `shelves` non esiste (ancora) sul database */
function isMissingShelvesTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || (/shelves/.test(msg) && /schema cache|does not exist/i.test(msg));
}

/** Elenco degli scaffali (tabella `shelves` + valori già usati dagli articoli), per la tendina del form articolo */
export async function listDistinctLocazioni() {
  const byKey = new Map(); // chiave minuscola -> nome (vince la forma scritta nella tabella)
  const registered = await supabase.from('shelves').select('nome');
  if (!registered.error) {
    registered.data.forEach((r) => {
      const n = normalizeMachineName(r.nome);
      if (n) byKey.set(n.toLowerCase(), n);
    });
  } else if (!isMissingShelvesTable(registered.error)) {
    throw registered.error;
  }
  const { data, error } = await supabase.from('product_locations').select('locazione').not('locazione', 'is', null);
  if (error) throw error;
  data.forEach((r) => {
    const n = normalizeMachineName(r.locazione);
    if (n && !byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), n);
  });
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' }));
}

/**
 * Scaffali con il numero di articoli associati, per la gestione in Impostazioni.
 * @returns {Promise<{shelves: {id: string|null, nome: string, articoli: number}[], tableMissing: boolean}>}
 */
export async function listShelvesWithCounts() {
  const [registered, products] = await Promise.all([
    supabase.from('shelves').select('id, nome, area'),
    supabase.from('product_locations').select('locazione').not('locazione', 'is', null),
  ]);
  if (products.error) throw products.error;
  // Senza la colonna `area` (migrazione non ancora eseguita) si rilegge senza e tutto risulta in Magazzino
  let areaMissing = false;
  if (registered.error && isMissingAreaColumn(registered.error)) {
    areaMissing = true;
    const retry = await supabase.from('shelves').select('id, nome');
    registered.data = retry.data;
    registered.error = retry.error;
  }
  const tableMissing = !!registered.error && isMissingShelvesTable(registered.error);
  if (registered.error && !tableMissing) throw registered.error;

  const byKey = new Map();
  const add = (raw, countIt, id = null, area = DEFAULT_SHELF_AREA) => {
    const nome = normalizeMachineName(raw);
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { id, nome, area: SHELF_AREAS.includes(area) ? area : DEFAULT_SHELF_AREA, articoli: 0 });
    if (id && !byKey.get(key).id) byKey.get(key).id = id;
    if (countIt) byKey.get(key).articoli += 1;
  };
  (registered.data || []).forEach((r) => add(r.nome, false, r.id, r.area));
  products.data.forEach((r) => add(r.locazione, true));
  const shelves = Array.from(byKey.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'it', { numeric: true, sensitivity: 'base' }));
  return { shelves, tableMissing, areaMissing };
}

export async function createShelf(nome, area = DEFAULT_SHELF_AREA) {
  const clean = normalizeMachineName(nome);
  if (!clean) throw new Error('Scrivi il nome dello scaffale.');
  if (clean.length > 60) throw new Error('Il nome è troppo lungo (massimo 60 caratteri).');
  if (!SHELF_AREAS.includes(area)) throw new Error('Area non valida.');
  let { data, error } = await supabase.from('shelves').insert({ nome: clean, area }).select('id, nome').single();
  if (error && isMissingAreaColumn(error)) {
    // Migrazione dell'area non ancora eseguita: in Magazzino si salva comunque (è l'area predefinita), altrimenti si avvisa
    if (area !== DEFAULT_SHELF_AREA) throw new Error('Per usare le aree serve prima eseguire sql/add_shelves_area.sql su Supabase.');
    ({ data, error } = await supabase.from('shelves').insert({ nome: clean }).select('id, nome').single());
  }
  if (error) {
    if (error.code === '23505') throw new Error(`Lo scaffale "${clean}" è già presente.`);
    if (error.code === '42501') throw new Error('Solo un amministratore può aggiungere scaffali.');
    if (isMissingShelvesTable(error)) {
      throw new Error('La tabella degli scaffali non è ancora stata creata sul database (vedi sql/create_shelves_table.sql).');
    }
    throw error;
  }
  shelfAreas.set(clean.toLowerCase(), area);
  return data;
}

/**
 * Cambia l'area di uno scaffale. Uno scaffale "storico" non ancora registrato (id nullo, esiste solo
 * negli articoli) viene registrato adesso con l'area scelta.
 * @param {{ id: string|null, nome: string }} shelf
 * @param {string} area
 */
export async function setShelfArea({ id, nome }, area) {
  if (!SHELF_AREAS.includes(area)) throw new Error('Area non valida.');
  if (!id) return createShelf(nome, area);
  const { data, error } = await supabase.from('shelves').update({ area }).eq('id', id).select('id, nome');
  if (error) {
    if (isMissingAreaColumn(error)) throw new Error('Per usare le aree serve prima eseguire sql/add_shelves_area.sql su Supabase.');
    if (error.code === '42501') throw new Error('Solo un amministratore può cambiare l\'area degli scaffali.');
    throw error;
  }
  if (!data || data.length === 0) throw new Error('Non è stato possibile cambiare l\'area (solo un amministratore può farlo).');
  shelfAreas.set(normalizeMachineName(nome).toLowerCase(), area);
  return data[0];
}

/**
 * Rimuove uno scaffale: lo toglie dalla tabella e lo toglie dagli articoli che lo usavano
 * (confronto senza maiuscole/spazi), che restano con la loro quantità ma senza scaffale.
 * @param {{ id: string|null, nome: string }} shelf
 * @returns {Promise<{ articoliSvuotati: number }>}
 */
export async function deleteShelf({ id, nome }) {
  if (id) {
    const { data, error } = await supabase.from('shelves').delete().eq('id', id).select('id');
    if (error) {
      if (isMissingShelvesTable(error)) throw new Error('La tabella degli scaffali non esiste ancora sul database.');
      throw error;
    }
    if (!data || data.length === 0) throw new Error('Non è stato possibile rimuovere lo scaffale (solo un amministratore può farlo).');
  }

  // Gli articoli che stavano su questo scaffale restano con la loro quantità, ma senza scaffale
  // (se avevano già una riga "senza scaffale" le quantità si sommano). Lo fa il database, in blocco.
  const { data: articoli, error } = await supabase.rpc('remove_shelf_assignments', { p_nome: nome });
  if (error) throw error;
  return { articoliSvuotati: Number(articoli) || 0 };
}
