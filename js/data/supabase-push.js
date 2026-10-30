// =============================================================
// supabase-push.js — Abbonamenti alle notifiche push (nuovi interventi)
// =============================================================
// Si passa da due funzioni del database: la tabella degli abbonamenti non è accessibile direttamente.
// Se lo stesso dispositivo viene usato da un altro utente, l'abbonamento passa a lui.

import { supabase } from './supabase-client.js';

/**
 * Registra (o aggiorna) l'abbonamento di questo dispositivo per l'utente collegato.
 * prefs: quali notifiche vuole ricevere su questo dispositivo ({ interventi, scorta }).
 */
export async function savePushSubscription(subscription, prefs = { interventi: true, scorta: false }) {
  const json = subscription.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent.slice(0, 200),
    p_interventi: !!prefs.interventi,
    p_scorta: !!prefs.scorta,
  });
  if (error) throw error;
}

/** Toglie l'abbonamento di questo dispositivo: non arriveranno più notifiche finché non si riattiva */
export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint });
  if (error) throw error;
}
