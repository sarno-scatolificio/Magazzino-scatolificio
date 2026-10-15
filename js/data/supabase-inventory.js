// =============================================================
// supabase-inventory.js — Inventario scaffale per scaffale (solo Admin)
// =============================================================
// - elenco scaffali con la data dell'ultimo inventario
// - articoli attesi su uno scaffale (da quantità registrate)
// - chiusura dell'inventario: la funzione SQL chiudi_inventario applica le correzioni
//   e registra storico e righe in un'unica operazione (o tutto o niente)
// - storico degli inventari chiusi
//
// Le rettifiche di inventario NON sono depositi o prelievi: restano nello storico degli
// inventari e non alterano i totali del Report né il calcolo della vita utile.

import { supabase } from './supabase-client.js';
import { listShelvesWithCounts } from './supabase-shelves.js';
import { bumpProductsVersion, getProductBarcodes, getProductLocations, listProducts } from './supabase-products.js';

/** Motivi tra cui scegliere quando ci sono differenze (uno per scaffale) */
export const MOTIVI = ['Conteggio errato', 'Prelievo non registrato', 'Deposito non registrato', 'Merce mancante', 'Altro'];

/** Oltre questi giorni un inventario si considera "da rifare" */
export const GIORNI_INVENTARIO_VECCHIO = 90;

/** Chiave di confronto di uno scaffale: senza maiuscole né spazi doppi (come fa il database) */
export const normShelf = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Descrizione dell'articolo come nelle altre schermate: Cuscinetti = descrizione, gli altri = punto di utilizzo standard */
export function descrizioneArticolo(p) {
  const v = p?.categoria === 'cuscinetti' ? p.descrizione : p?.punto_utilizzo_standard;
  return String(v || '').trim();
}

async function ultimiInventari() {
  const { data, error } = await supabase.from('inventari_ultimi').select('chiave, ultimo');
  if (error) throw error;
  return new Map((data || []).map((r) => [r.chiave, r.ultimo]));
}

/** Scaffali (con area e numero di articoli) e data dell'ultimo inventario di ciascuno */
export async function listShelvesStatus() {
  const [{ shelves }, ultimi] = await Promise.all([listShelvesWithCounts(), ultimiInventari()]);
  return shelves.map((s) => ({ ...s, ultimo: ultimi.get(normShelf(s.nome)) || null }));
}

/**
 * Articoli che risultano su uno scaffale, con la quantità attesa. Rilegge anche l'anagrafica
 * completa, così la scansione dei codici a barre durante il conteggio funziona dalla cache.
 */
export async function listExpectedForShelf(nome) {
  const key = normShelf(nome);
  const all = await listProducts();
  const rows = [];
  for (const p of all) {
    const loc = getProductLocations(p).find((l) => l.locazione && normShelf(l.locazione) === key);
    if (!loc) continue;
    rows.push({
      id: p.id,
      codice: p.codice_articolo,
      descr: descrizioneArticolo(p),
      categoria: p.categoria,
      barcodes: getProductBarcodes(p).map((b) => b.codice_barre),
      atteso: Number(loc.quantita) || 0,
      contato: null,
      aggiunto: false,
    });
  }
  rows.sort((a, b) => String(a.codice).localeCompare(String(b.codice), 'it', { numeric: true, sensitivity: 'base' }));
  return rows;
}

/** Dati di una riga per un articolo trovato ma non in elenco */
export function rowFromProduct(p) {
  return {
    id: p.id,
    codice: p.codice_articolo,
    descr: descrizioneArticolo(p),
    categoria: p.categoria,
    barcodes: getProductBarcodes(p).map((b) => b.codice_barre),
    atteso: 0,
    contato: 1,
    aggiunto: true,
  };
}

/**
 * Chiude l'inventario di uno scaffale applicando le quantità contate.
 * @param {{ locazione: string, ciechi: boolean, motivo: string|null, iniziatoAt: number|null, righe: { product_id: string, contato: number }[] }} d
 * @returns {Promise<string>} id dell'inventario registrato
 */
export async function closeInventory({ locazione, ciechi, motivo, iniziatoAt, righe }) {
  const { data, error } = await supabase.rpc('chiudi_inventario', {
    p_locazione: locazione,
    p_ciechi: !!ciechi,
    p_motivo: motivo || null,
    p_iniziato_at: iniziatoAt ? new Date(iniziatoAt).toISOString() : null,
    p_righe: righe,
  });
  if (error) throw error;
  bumpProductsVersion(); // le giacenze sono cambiate: il Magazzino si aggiorna al rientro
  return data;
}

/** Ultimi inventari chiusi, con le righe di ciascuno */
export async function listInventories(limit = 100) {
  const { data, error } = await supabase
    .from('inventari')
    .select(
      'id, created_at, iniziato_at, locazione, ciechi, motivo, user_name, articoli_totali, con_differenza, inventario_righe(codice_articolo, categoria, descrizione, atteso, contato, differenza, tipo)'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
