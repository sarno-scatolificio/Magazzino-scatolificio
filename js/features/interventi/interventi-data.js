// =============================================================
// interventi-data.js — Dati del Blocco Note Interventi (soste di manutenzione)
// Tabelle: manutenzioni_soste (interventi), interventi_rapidi (preimpostati per
// linea+macchina). Foto nel bucket privato `interventi-foto` (URL firmati).
// Le query stanno qui, in un file a parte, per non toccare il grande supabase.js.
// =============================================================

import { supabase } from '../../data/supabase.js';

export const FOTO_BUCKET = 'interventi-foto';
export const LINEE = [
  { value: 'L1', label: 'Linea 1' },
  { value: 'L2', label: 'Linea 2' },
  { value: 'REP', label: 'Reparto' }, // macchine uniche di reparto, senza linea (Fasciatrice, Sovrappositore…)
];
export const STATI = {
  da_effettuare: 'Da effettuare',
  sospeso: 'Da completare',
  effettuato: 'Effettuato',
};

/** Operatori di un intervento: elenco nuovo, con ripiego sul vecchio campo a nome singolo */
export const operatoriDi = (r) => (Array.isArray(r?.operatori) && r.operatori.length ? r.operatori : r?.operatore_nome ? [r.operatore_nome] : []);

/** Ricambi prelevati dal magazzino per un intervento: [{ product_id, codice, categoria, descrizione, quantita, locazione }] */
export const ricambiDi = (r) => (Array.isArray(r?.ricambi) ? r.ricambi : []);
export const ricambiLabel = (x) => `${x.codice} ×${x.quantita}`;

/** 'L1-L2' = intervento rapido condiviso da una macchina presente su entrambe le linee */
export const lineaLabel = (v) => (v === 'L1-L2' ? 'Entrambe le linee' : LINEE.find((l) => l.value === v)?.label || v || '');

/** Un intervento rapido vale per la stessa linea e la stessa macchina (senza distinzione di maiuscole) */
export function rapidoMatches(rapido, linea, macchina) {
  if (!linea || !macchina) return false;
  return (rapido.linea === linea || (rapido.linea === 'L1-L2' && linea !== 'REP')) && (rapido.macchina || '').toLowerCase() === macchina.toLowerCase();
}

function isMissingTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || /schema cache|does not exist/i.test(msg);
}

const COLS =
  'id, linea, macchina, descrizione, stato, foto_promemoria_path, note_esito, dettagli, rapido_id, foto_esito_path, created_by, created_by_name, created_at, esito_by, esito_by_name, esito_at, operatore_nome, operatori, ricambi, ricambi_mancanti';

/** Interventi aperti (da effettuare + da completare) e ultimi effettuati */
export async function listInterventi() {
  const [open, done] = await Promise.all([
    supabase.from('manutenzioni_soste').select(COLS).in('stato', ['da_effettuare', 'sospeso']).order('created_at', { ascending: false }).limit(500),
    supabase.from('manutenzioni_soste').select(COLS).eq('stato', 'effettuato').order('esito_at', { ascending: false }).limit(300),
  ]);
  const error = open.error || done.error;
  if (error) {
    if (isMissingTable(error)) return { tableMissing: true, open: [], done: [] };
    throw error;
  }
  return { tableMissing: false, open: open.data, done: done.data };
}

/** Un intervento per id (per aprirlo dal tocco su una notifica); null se non esiste più */
export async function getIntervento(id) {
  const { data, error } = await supabase.from('manutenzioni_soste').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Interventi effettuati in un intervallo (giornata) — per il PDF */
export async function listEffettuatiRange(fromIso, toIso) {
  const { data, error } = await supabase
    .from('manutenzioni_soste')
    .select(COLS)
    .eq('stato', 'effettuato')
    .gte('esito_at', fromIso)
    .lte('esito_at', toIso)
    .order('esito_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function uploadFoto(blob) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id || 'anon';
  const path = `${uid}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(FOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;
  return path;
}

async function removeFoto(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  try {
    await supabase.storage.from(FOTO_BUCKET).remove(list);
  } catch (err) {
    console.warn('Impossibile rimuovere la foto.', err);
  }
}

/** Nuovo intervento (stato iniziale: da effettuare). `foto` = Blob JPEG o null; `operatori` = chi lo effettua (dall'elenco o scritti a mano) */
export async function createIntervento({ linea, macchina, descrizione, dettagli = '', foto = null, authorName = '', operatori = [] }) {
  let path = null;
  if (foto) path = await uploadFoto(foto);
  const { data, error } = await supabase
    .from('manutenzioni_soste')
    .insert({ linea, macchina, descrizione, dettagli: (dettagli || '').trim() || null, foto_promemoria_path: path, created_by_name: authorName || null, operatori: [...new Set(operatori)] })
    .select(COLS)
    .single();
  if (error) {
    await removeFoto([path]);
    throw error;
  }
  return data;
}

/**
 * Aggiorna l'esito. `foto`: Blob nuovo | null (nessun cambio); `rimuoviFoto`: true per toglierla.
 */
export async function updateEsito(row, { stato, note, dettagli = undefined, descrizione = null, operatori = [], esitoAt = null, foto = null, rimuoviFoto = false, authorName = '', extra = {} }) {
  let fotoPath = row.foto_esito_path || null;
  let newPath = null;
  if (foto) {
    newPath = await uploadFoto(foto);
    fotoPath = newPath;
  } else if (rimuoviFoto) {
    fotoPath = null;
  }
  const patch = {
    stato,
    note_esito: note || null,
    // Effettuato: chi ha eseguito il lavoro (non compare nel PDF dei fatti).
    // Da effettuare / da completare: gli operatori a cui il lavoro è assegnato (PDF per operatore).
    operatori,
    foto_esito_path: fotoPath,
    esito_by_name: stato === 'da_effettuare' ? null : authorName || null,
    // Giorno e ora di esecuzione: quelli scelti per gli effettuati; altrimenti (da completare) quelli già registrati o adesso
    esito_at: stato === 'da_effettuare' ? null : stato === 'effettuato' && esitoAt ? esitoAt.toISOString() : stato === row.stato && row.esito_at ? row.esito_at : new Date().toISOString(),
  };
  if (descrizione && descrizione !== row.descrizione) patch.descrizione = descrizione; // titolo modificato
  if (dettagli !== undefined) patch.dettagli = (dettagli || '').trim() || null; // dettagli prima dell'intervento (mai nel rapporto degli effettuati)
  Object.assign(patch, extra); // campi in più (es. ricambi dell'inserimento rapido)
  if (stato === 'da_effettuare') patch.esito_by = null;
  else {
    const { data: u } = await supabase.auth.getUser();
    patch.esito_by = u?.user?.id || null;
  }
  const { data, error } = await supabase.from('manutenzioni_soste').update(patch).eq('id', row.id).select(COLS).single();
  if (error) {
    await removeFoto([newPath]);
    throw error;
  }
  if ((foto || rimuoviFoto) && row.foto_esito_path && row.foto_esito_path !== fotoPath) await removeFoto([row.foto_esito_path]);
  return data;
}

/** Ricambi di un intervento effettuato: elenco completo e segnalazione "da indicare" */
export async function updateRicambi(row, { ricambi, ricambiMancanti }) {
  const { data, error } = await supabase.from('manutenzioni_soste').update({ ricambi, ricambi_mancanti: ricambiMancanti }).eq('id', row.id).select(COLS).single();
  if (error) throw error;
  return data;
}

export async function deleteIntervento(row) {
  const { error } = await supabase.from('manutenzioni_soste').delete().eq('id', row.id);
  if (error) throw error;
  await removeFoto([row.foto_promemoria_path, row.foto_esito_path]);
}

// ---- URL firmati delle foto (1 ora), con cache in memoria ----
const urlCache = new Map(); // path -> { url, exp }
export async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(urlCache.get(p)?.exp > now));
  if (need.length) {
    const { data, error } = await supabase.storage.from(FOTO_BUCKET).createSignedUrls(need, 3600);
    if (error) throw error;
    data.forEach((r) => {
      if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + 55 * 60 * 1000 });
    });
  }
  const out = {};
  paths.filter(Boolean).forEach((p) => {
    out[p] = urlCache.get(p)?.url || '';
  });
  return out;
}

// ---- Interventi rapidi ----
export async function listRapidi() {
  const { data, error } = await supabase.from('interventi_rapidi').select('id, linea, macchina, titolo, cadenza_giorni, cadenza_da, generato_at, created_at').order('titolo', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { tableMissing: true, rapidi: [] };
    throw error;
  }
  return { tableMissing: false, rapidi: data };
}

/** Ultimo intervento generato/inserito per ogni intervento rapido (dal più recente): serve a calcolare tra quanti giorni scade */
export async function listRapidiUltimi() {
  const { data, error } = await supabase
    .from('manutenzioni_soste')
    .select('rapido_id, linea, stato, esito_at, created_at')
    .not('rapido_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data;
}

// Giorno di calendario a Roma, come numero di giorni: la scadenza del database è «giorno di riferimento + cadenza, alle 00:00 ora di Roma»
const romeDayNum = (d) => {
  const [y, m, g] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number);
  return Date.UTC(y, m - 1, g) / 86400000;
};

/**
 * Scadenza di un intervento rapido con ripetizione: una voce per linea ('L1-L2' = due voci).
 * { linea, pending: true } = l'ultimo intervento è già tra i «Da effettuare/Da completare»; { linea, giorni } = giorni mancanti alla scadenza (≤ 0 = scade oggi).
 * Stessa regola della funzione genera_interventi_programmati del database.
 */
export function scadenzeRapido(r, ultimi, now = new Date()) {
  if (!r.cadenza_giorni) return [];
  const oggi = romeDayNum(now);
  return (r.linea === 'L1-L2' ? ['L1', 'L2'] : [r.linea]).map((linea) => {
    const last = ultimi.find((u) => u.rapido_id === r.id && u.linea === linea); // `ultimi` è dal più recente
    if (last && last.stato !== 'effettuato') return { linea, pending: true };
    const ref = last ? new Date(last.esito_at || last.created_at) : new Date(Math.max(+new Date(r.cadenza_da || r.created_at), r.generato_at ? +new Date(r.generato_at) : 0));
    return { linea, giorni: romeDayNum(ref) + r.cadenza_giorni - oggi };
  });
}

export async function createRapido({ linea, macchina, titolo, cadenzaGiorni = null }) {
  const row = { linea, macchina, titolo };
  if (cadenzaGiorni) {
    row.cadenza_giorni = cadenzaGiorni;
    row.cadenza_da = new Date().toISOString(); // il conteggio parte da adesso
  }
  const { data, error } = await supabase.from('interventi_rapidi').insert(row).select('id, linea, macchina, titolo, cadenza_giorni').single();
  if (error) {
    if (error.code === '23505') throw new Error('Questo intervento rapido esiste già per la stessa linea e macchina.');
    throw error;
  }
  return data;
}

/** Cadenza (in giorni) di un intervento rapido: dopo N giorni compare da solo tra i "Da effettuare" alle 00:00 del giorno di scadenza. null = nessuna ripetizione. */
export async function updateRapidoCadenza(id, giorni) {
  const patch = giorni ? { cadenza_giorni: giorni, cadenza_da: new Date().toISOString() } : { cadenza_giorni: null, cadenza_da: null };
  const { error } = await supabase.from('interventi_rapidi').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * Modifica un intervento rapido già salvato (linea, macchina, titolo, ripetizione).
 * Cambia SOLO il modello: gli interventi già inseriti (da effettuare o effettuati) sono copie e restano com'erano;
 * le modifiche valgono dal prossimo inserimento. `riparti` azzera il conteggio dei giorni da adesso.
 */
export async function updateRapido(id, { linea, macchina, titolo, cadenzaGiorni = null, riparti = false }) {
  const patch = { linea, macchina, titolo, cadenza_giorni: cadenzaGiorni };
  if (riparti) patch.cadenza_da = cadenzaGiorni ? new Date().toISOString() : null;
  const { data, error } = await supabase.from('interventi_rapidi').update(patch).eq('id', id).select('id, linea, macchina, titolo, cadenza_giorni').single();
  if (error) {
    if (error.code === '23505') throw new Error('Esiste già un intervento rapido uguale per la stessa linea e macchina.');
    throw error;
  }
  return data;
}

/** Fa comparire tra i "Da effettuare" gli interventi programmati arrivati a scadenza (lo fa già il database ogni 5 minuti: qui è solo una rete di sicurezza) */
export async function generaProgrammati() {
  const { error } = await supabase.rpc('genera_interventi_programmati');
  if (error) throw error;
}

export async function deleteRapido(id) {
  const { error } = await supabase.from('interventi_rapidi').delete().eq('id', id);
  if (error) throw error;
}

const pad2 = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const keyToDate = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));

/** Giorni (AAAA-MM-GG, ora locale) in cui è stato effettuato almeno un intervento: servono ai pallini blu del calendario */
export async function listEffettuatiDays() {
  const { data, error } = await supabase
    .from('manutenzioni_soste')
    .select('esito_at')
    .eq('stato', 'effettuato')
    .not('esito_at', 'is', null)
    .order('esito_at', { ascending: false })
    .limit(5000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return [...new Set(data.map((r) => dayKey(new Date(r.esito_at))))];
}

// ---- Operatori (elenco gestito dall'admin dalle Impostazioni) ----
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ');

/** Cognome di un operatore scritto "Nome Cognome" (tutto ciò che segue il primo nome) */
export function cognomeDi(n) {
  const p = cleanName(n).split(' ');
  return p.length < 2 ? cleanName(n) : p.slice(1).join(' ');
}

/** "Nicola Vorraro" -> "N. VORRARO" (iniziale puntata e cognome, tutto maiuscolo) */
export function formatOperatore(n) {
  const c = cleanName(n);
  const p = c.split(' ');
  if (p.length < 2) return c.toUpperCase();
  const ini = (p[0].match(/\p{L}/u) || [''])[0].toUpperCase();
  return `${ini}. ${p.slice(1).join(' ').toUpperCase()}`;
}

/** Ordine alfabetico per cognome (poi per nome) */
export const compareOperatori = (a, b) =>
  cognomeDi(a).localeCompare(cognomeDi(b), 'it', { sensitivity: 'base' }) || cleanName(a).localeCompare(cleanName(b), 'it', { sensitivity: 'base' });
export const sortOperatori = (list) => [...list].sort(compareOperatori);

export async function listOperatori() {
  const { data, error } = await supabase.from('interventi_operatori').select('id, nome').order('nome', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { tableMissing: true, operatori: [] };
    throw error;
  }
  return { tableMissing: false, operatori: [...data].sort((a, b) => compareOperatori(a.nome, b.nome)) };
}

export async function createOperatore(nome) {
  const clean = (nome || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Scrivi il nome dell\'operatore.');
  const { data, error } = await supabase.from('interventi_operatori').insert({ nome: clean }).select('id, nome').single();
  if (error) {
    if (error.code === '23505') throw new Error('Questo operatore è già in elenco.');
    throw error;
  }
  return data;
}

export async function deleteOperatore(id) {
  const { error } = await supabase.from('interventi_operatori').delete().eq('id', id);
  if (error) throw error;
}
