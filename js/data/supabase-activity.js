// =============================================================
// supabase-activity.js — Registro attività (accessi e azioni degli utenti)
// =============================================================
// Gli accessi li invia l'app (log_accesso); le azioni (movimenti, articoli,
// interventi, ecc.) le scrivono direttamente i trigger del database.
// La lettura è consentita solo all'account indicato nella funzione
// is_log_viewer() del database (vedi database/migrazioni/2026-10-28-registro-attivita.sql).

import { supabase } from './supabase-client.js';

/**
 * Registra un accesso o un'uscita. Non lancia mai errori e non blocca mai l'app:
 * se manca la rete, quella voce semplicemente non viene registrata.
 * @param {'accesso'|'uscita'} evento
 * @param {string} azione testo mostrato nel registro (es. "Accesso con email e password")
 * @param {string|null} [dettagli] es. dispositivo e browser
 */
export async function logActivity(evento, azione, dettagli = null) {
  try {
    await supabase.rpc('log_accesso', { p_evento: evento, p_azione: azione, p_dettagli: dettagli });
  } catch (err) {
    /* il registro non deve mai disturbare chi sta lavorando */
  }
}

/**
 * Legge una pagina del registro, dalla voce più recente alla più vecchia.
 * Restituisce una voce in più del necessario solo per capire se esiste una pagina successiva.
 * @param {{ since?: Date|null, userId?: string|null, tipo?: 'tutto'|'accessi'|'azioni', offset?: number, limit?: number }} opts
 * @returns {Promise<{ rows: object[], hasMore: boolean }>}
 */
export async function listActivityLog({ since = null, userId = null, tipo = 'tutto', offset = 0, limit = 50 } = {}) {
  let query = supabase
    .from('activity_log')
    .select('id, created_at, user_id, user_email, user_name, evento, categoria, azione, dettagli')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit); // limit + 1 righe
  if (since) query = query.gte('created_at', since.toISOString());
  if (userId) query = query.eq('user_id', userId);
  if (tipo === 'accessi') query = query.in('evento', ['accesso', 'uscita']);
  else if (tipo === 'azioni') query = query.eq('evento', 'azione');
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
