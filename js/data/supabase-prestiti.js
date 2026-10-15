// =============================================================
// supabase-prestiti.js — Prestiti di articoli del magazzino (prelievo "a prestito" e reintegro)
// =============================================================
// Prelievo e reintegro passano da funzioni SQL (process_prestito / reintegra_prestito) che
// aggiornano giacenza, movimenti e prestito in un'unica operazione. La tabella `prestiti`
// si legge soltanto: non ha policy di scrittura diretta.

import { supabase } from './supabase-client.js';

const COLS = 'id, product_id, codice_articolo, quantita, destinatario, locazione, created_at, created_by_name, reintegrato_at, reintegrato_by_name';

/** Prestiti ancora in sospeso (dal più vecchio) oppure già reintegrati (ultimi 100, dal più recente) */
export async function listPrestiti({ reintegrati = false } = {}) {
  let q = supabase.from('prestiti').select(COLS);
  q = reintegrati ? q.not('reintegrato_at', 'is', null).order('reintegrato_at', { ascending: false }).limit(100) : q.is('reintegrato_at', null).order('created_at', { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Numero di prestiti in sospeso */
export async function countPrestitiAperti() {
  const { count, error } = await supabase.from('prestiti').select('id', { count: 'exact', head: true }).is('reintegrato_at', null);
  if (error) throw error;
  return count || 0;
}

/** Prelievo registrato come prestito a `destinatario` */
export async function processPrestito({ productId, quantita, destinatario, locationId }) {
  const params = { p_product_id: productId, p_quantita: quantita, p_destinatario: destinatario };
  if (locationId) params.p_location_id = locationId;
  const { data, error } = await supabase.rpc('process_prestito', params);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Reintegra un prestito: il pezzo torna sullo scaffale e il prestito si chiude */
export async function reintegraPrestito(prestitoId) {
  const { data, error } = await supabase.rpc('reintegra_prestito', { p_prestito_id: prestitoId });
  if (error) throw error;
  return data?.[0] ?? null;
}
