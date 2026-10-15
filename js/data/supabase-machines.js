// =============================================================
// supabase-machines.js — Macchine (elenco, icone, linee, ordine)
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase } from './supabase-client.js';
import { SECTION_ICONS_BUCKET } from './supabase-manuals.js';

// --- MACCHINE --------------------------------------------------
// Le macchine si registrano nella tabella `machines` (vedi sql/create_machines_table.sql).
// products.macchina resta un testo libero: le macchine "storiche" usate solo dagli articoli
// continuano a comparire negli elenchi anche se non sono (ancora) nella tabella.

/** Toglie spazi doppi e ai bordi dal nome di una macchina */
export function normalizeMachineName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

/** True se l'errore indica che la tabella `machines` non esiste (ancora) sul database */
function isMissingMachinesTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || /machines/.test(msg) && /schema cache|does not exist/i.test(msg);
}

/** Linee su cui può trovarsi una macchina */
export const MACHINE_LINES = ['L1', 'L2'];

/** Ordine delle macchine in tutta l'app: prima quelle ordinate dall'admin (sort_order), poi le altre in ordine alfabetico */
export function compareMachines(a, b) {
  const sa = a.sort_order ?? Infinity;
  const sb = b.sort_order ?? Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.nome.localeCompare(b.nome, 'it');
}

/**
 * True se la macchina è presente sulla linea indicata. Senza linea scelta (o con un articolo su
 * L1-L2) non si filtra; una macchina senza informazioni sulle linee (storica, o colonna non ancora
 * creata) vale per tutte.
 */
export function machineOnLinea(entry, linea) {
  if (!linea || linea === 'L1-L2') return true;
  const l = entry?.linee;
  if (!Array.isArray(l) || l.length === 0) return true;
  return l.includes(linea);
}

// Elenco delle macchine tenuto in memoria: viene caricato all'apertura dell'app, così i menu delle macchine
// si aprono subito. Si rilegge in silenzio se ha più di un minuto e si butta quando le macchine cambiano.
let entriesCache = null;
let entriesAt = 0;
let entriesInflight = null;
const ENTRIES_MAX_AGE_MS = 60 * 1000;

/** Scarta l'elenco in memoria: la prossima lettura va al database */
export function invalidateMachineEntries() {
  entriesCache = null;
  entriesAt = 0;
}
if (typeof window !== 'undefined') window.addEventListener('machines-changed', invalidateMachineEntries);

function refreshMachineEntries() {
  if (!entriesInflight) {
    entriesInflight = fetchMachineEntries()
      .then((list) => {
        entriesCache = list;
        entriesAt = Date.now();
        return list;
      })
      .finally(() => {
        entriesInflight = null;
      });
  }
  return entriesInflight;
}

/** Macchine (tabella `machines` + valori già usati dagli articoli) con linee e ordine, già ordinate. */
export async function listMachineEntries() {
  if (entriesCache) {
    if (Date.now() - entriesAt > ENTRIES_MAX_AGE_MS) refreshMachineEntries().catch(() => {}); // aggiorna per la prossima volta
    return [...entriesCache];
  }
  return [...(await refreshMachineEntries())];
}

/** Caricamento anticipato (all'apertura dell'app): non dà mai errore */
export function preloadMachineEntries() {
  return refreshMachineEntries().catch((err) => console.warn('Elenco macchine non precaricato.', err));
}

async function fetchMachineEntries() {
  const byKey = new Map(); // chiave minuscola -> voce (vince la forma scritta nella tabella)
  const registered = await selectMachinesRows();
  if (!registered.error) {
    registered.data.forEach((r) => {
      const n = normalizeMachineName(r.nome);
      if (n) byKey.set(n.toLowerCase(), { id: r.id, nome: n, linee: Array.isArray(r.linee) ? r.linee : null, sort_order: r.sort_order ?? null });
    });
  } else if (!isMissingMachinesTable(registered.error)) {
    throw registered.error;
  }
  const { data, error } = await supabase.from('products').select('macchina').not('macchina', 'is', null);
  if (error) throw error;
  data.forEach((r) => {
    const n = normalizeMachineName(r.macchina);
    if (n && !byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), { id: null, nome: n, linee: null, sort_order: null });
  });
  return Array.from(byKey.values()).sort(compareMachines);
}

/**
 * Nomi delle macchine, nell'ordine scelto dall'admin. Con `linea` ('L1' | 'L2') restano solo
 * quelle presenti su quella linea: è il filtro usato da tutta l'app.
 */
export async function listDistinctMacchine({ linea = '' } = {}) {
  const entries = await listMachineEntries();
  return entries.filter((e) => machineOnLinea(e, linea)).map((e) => e.nome);
}

/**
 * Macchine con il numero di articoli associati, per la gestione in Impostazioni.
 * @returns {Promise<{machines: {id: string|null, nome: string, articoli: number}[], tableMissing: boolean}>}
 */
/** True se l'errore indica che mancano le colonne icona/ordine su `machines` (sql/machines_icona_e_ordine.sql non ancora eseguito) */
function isMissingMachineColumn(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || error?.code === 'PGRST204' || (/icon_storage_path|sort_order|linee/.test(msg) && /column|schema cache/i.test(msg));
}
const MISSING_MACHINE_COLUMNS_MSG = 'Mancano le colonne icona/ordine sulla tabella delle macchine: esegui sql/machines_icona_e_ordine.sql da Supabase → SQL Editor.';

/** Righe di `machines`; se le colonne icona/ordine non esistono ancora ripiega su id e nome, così nulla si rompe. */
async function selectMachinesRows() {
  const full = await supabase.from('machines').select('id, nome, icon_storage_path, sort_order, linee');
  if (!full.error || !isMissingMachineColumn(full.error)) return full;
  // Colonna `linee` non ancora creata: si ripiega sulle colonne precedenti
  const ext = await supabase.from('machines').select('id, nome, icon_storage_path, sort_order');
  if (ext.error && isMissingMachineColumn(ext.error)) return supabase.from('machines').select('id, nome');
  return ext;
}

export async function listMachinesWithCounts() {
  const [registered, products] = await Promise.all([
    selectMachinesRows(),
    supabase.from('products').select('macchina').not('macchina', 'is', null),
  ]);
  if (products.error) throw products.error;
  const tableMissing = !!registered.error && isMissingMachinesTable(registered.error);
  if (registered.error && !tableMissing) throw registered.error;

  const byKey = new Map();
  const add = (raw, countIt, id = null, extra = null) => {
    const nome = normalizeMachineName(raw);
    if (!nome) return;
    const key = nome.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { id, nome, articoli: 0, icon_storage_path: null, sort_order: null, linee: null });
    const entry = byKey.get(key);
    if (id && !entry.id) entry.id = id;
    if (countIt) entry.articoli += 1;
    if (extra) {
      entry.icon_storage_path = extra.icon_storage_path ?? null;
      entry.sort_order = extra.sort_order ?? null;
      entry.linee = Array.isArray(extra.linee) ? extra.linee : null;
    }
  };
  (registered.data || []).forEach((r) => add(r.nome, false, r.id, r));
  products.data.forEach((r) => add(r.macchina, true));
  const machines = Array.from(byKey.values()).sort(compareMachines);
  return { machines, tableMissing };
}

/** Aggiunge una macchina alla tabella (solo admin: lo garantisce anche il database con la RLS) */
export async function createMachine(nome) {
  invalidateMachineEntries();
  const clean = normalizeMachineName(nome);
  if (!clean) throw new Error('Scrivi il nome della macchina.');
  if (clean.length > 60) throw new Error('Il nome è troppo lungo (massimo 60 caratteri).');
  const { data, error } = await supabase.from('machines').insert({ nome: clean }).select('id, nome').single();
  if (error) {
    if (error.code === '23505') throw new Error(`La macchina "${clean}" è già presente.`);
    if (error.code === '42501') throw new Error('Solo un amministratore può aggiungere macchine.');
    if (isMissingMachinesTable(error)) {
      throw new Error('La tabella delle macchine non è ancora stata creata sul database (vedi sql/create_machines_table.sql).');
    }
    throw error;
  }
  return data;
}

/**
 * Imposta (o toglie, con `newIconStoragePath` nullo) l'icona di una macchina. Se c'era già un'icona
 * diversa, il file precedente viene eliminato dallo storage. Solo admin.
 */
export async function updateMachineIcon(machineId, { newIconStoragePath, previousIconStoragePath }) {
  invalidateMachineEntries();
  const { data, error } = await supabase
    .from('machines')
    .update({ icon_storage_path: newIconStoragePath || null })
    .eq('id', machineId)
    .select('id');
  if (error) {
    if (isMissingMachineColumn(error)) throw new Error(MISSING_MACHINE_COLUMNS_MSG);
    throw error;
  }
  if (!data || data.length === 0) throw new Error('Non è stato possibile salvare l\'icona (solo un amministratore può farlo).');
  if (previousIconStoragePath && previousIconStoragePath !== newIconStoragePath) {
    await supabase.storage.from(SECTION_ICONS_BUCKET).remove([previousIconStoragePath]);
  }
}

/** Imposta su quali linee si trova una macchina (almeno una). Solo admin. */
export async function updateMachineLinee(machineId, linee) {
  invalidateMachineEntries();
  const clean = MACHINE_LINES.filter((l) => linee.includes(l));
  if (!clean.length) throw new Error('Una macchina deve stare su almeno una linea.');
  const { data, error } = await supabase.from('machines').update({ linee: clean }).eq('id', machineId).select('id');
  if (error) {
    if (isMissingMachineColumn(error)) throw new Error('Manca la colonna delle linee sulla tabella delle macchine.');
    throw error;
  }
  if (!data || data.length === 0) throw new Error('Non è stato possibile salvare le linee (solo un amministratore può farlo).');
  return clean;
}

/** Salva l'ordine delle macchine, valido in tutta l'app: elenchi, filtri, Manuali (posizione = indice nell'array). Solo admin. */
export async function updateMachinesOrder(orderedIds) {
  invalidateMachineEntries();
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from('machines').update({ sort_order: index }).eq('id', id).select('id'))
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    if (isMissingMachineColumn(failed.error)) throw new Error(MISSING_MACHINE_COLUMNS_MSG);
    throw failed.error;
  }
  if (results.some((r) => !r.data || r.data.length === 0)) {
    throw new Error('Non è stato possibile salvare l\'ordine (solo un amministratore può farlo).');
  }
}

/**
 * Rimuove una macchina: la toglie dalla tabella e svuota il campo "macchina" degli articoli che la usavano
 * (confronto senza maiuscole/spazi), altrimenti continuerebbe a comparire negli elenchi.
 * @param {{ id: string|null, nome: string }} machine
 * @returns {Promise<{ articoliSvuotati: number }>}
 */
export async function deleteMachine({ id, nome }) {
  invalidateMachineEntries();
  const key = normalizeMachineName(nome).toLowerCase();

  // 1) dalla tabella. Con la RLS un utente non admin non riceve un errore ma 0 righe: si controlla.
  if (id) {
    const { data, error } = await supabase.from('machines').delete().eq('id', id).select('id');
    if (error) {
      if (isMissingMachinesTable(error)) throw new Error('La tabella delle macchine non esiste ancora sul database.');
      throw error;
    }
    if (!data || data.length === 0) throw new Error('Non è stato possibile rimuovere la macchina (solo un amministratore può farlo).');
  }

  // 2) dagli articoli che la usavano
  const { data: rows, error: readErr } = await supabase.from('products').select('id, macchina').not('macchina', 'is', null);
  if (readErr) throw readErr;
  const ids = rows.filter((r) => normalizeMachineName(r.macchina).toLowerCase() === key).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from('products').update({ macchina: null }).in('id', ids.slice(i, i + 100));
    if (error) throw error;
  }
  return { articoliSvuotati: ids.length };
}
