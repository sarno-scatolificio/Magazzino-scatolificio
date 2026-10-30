// =============================================================
// notify-nuovo-intervento — Edge Function (Supabase)
// =============================================================
// La chiama il database: il trigger notify_nuovo_intervento() quando un utente inserisce a mano un
// intervento DA EFFETTUARE (di giorno), oppure flush_push_queue() dopo le 07:00 per tutti quelli inseriti
// nel silenzio notturno (22:00-07:00). Invia una notifica push per intervento (chi l'ha inserito +
// descrizione) a tutti gli abbonamenti, tranne quelli dell'autore. Non è chiamabile dall'app: si autentica con il segreto
// condiviso (header x-push-secret) salvato nella tabella push_config, per questo verify_jwt è false.
// Chiavi VAPID e segreto stanno in push_config (solo server), non nel codice.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const truncate = (text: string, max: number) => {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: cfgRows, error: cfgError } = await admin.from('push_config').select('key, value');
  if (cfgError || !cfgRows) return json({ error: 'Configurazione non disponibile' }, 500);
  const cfg: Record<string, string> = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));

  if (!cfg.webhook_secret || req.headers.get('x-push-secret') !== cfg.webhook_secret) {
    return json({ error: 'Non autorizzato' }, 401);
  }
  if (!cfg.vapid_public || !cfg.vapid_private || !cfg.vapid_subject) {
    return json({ error: 'Chiavi VAPID mancanti' }, 500);
  }

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.intervento_ids) ? body.intervento_ids : body?.intervento_id ? [body.intervento_id] : [];
  } catch {
    return json({ error: 'Richiesta non valida' }, 400);
  }
  ids = [...new Set(ids.filter((id) => typeof id === 'string'))].slice(0, 50);
  if (ids.length === 0) return json({ error: 'intervento_ids mancante' }, 400);

  const { data: rows, error: rowsError } = await admin
    .from('manutenzioni_soste')
    .select('id, descrizione, stato, created_by, created_by_name, created_at')
    .in('id', ids);
  if (rowsError) return json({ error: 'Interventi non leggibili' }, 500);
  // Solo gli interventi ancora da effettuare e inseriti da una persona (uno effettuato o cancellato nel
  // frattempo, per esempio durante la notte, non genera più nessun avviso), dal più vecchio al più recente
  const toNotify = (rows || [])
    .filter((r) => r.stato === 'da_effettuare' && r.created_by)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (toNotify.length === 0) return json({ sent: 0, motivo: 'non da notificare' });

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('endpoint, user_id, p256dh, auth')
    .eq('interventi', true); // solo chi ha attive le notifiche degli interventi
  if (subsError) return json({ error: 'Abbonamenti non leggibili' }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, motivo: 'nessun abbonato' });

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);

  // Un invio per ogni coppia intervento × abbonamento (l'autore non riceve il proprio avviso)
  const jobs: { endpoint: string; promise: Promise<unknown> }[] = [];
  for (const row of toNotify) {
    const who = (row.created_by_name || '').trim() || 'Un collega';
    const payload = JSON.stringify({
      title: 'Nuovo intervento da effettuare',
      body: `${who}: ${truncate(row.descrizione, 140)}`,
      tag: `intervento-${row.id}`,
      id: row.id,
      url: `./?intervento=${row.id}`,
    });
    for (const s of subs) {
      if (s.user_id === row.created_by) continue;
      jobs.push({
        endpoint: s.endpoint,
        // Promise.resolve().then(...): un abbonamento non valido fa fallire solo il suo invio, non tutti gli altri
        promise: Promise.resolve().then(() =>
          webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 60 * 60 * 24,
            urgency: 'high',
          })
        ),
      });
    }
  }
  if (jobs.length === 0) return json({ sent: 0, motivo: 'nessun destinatario' });

  const results = await Promise.allSettled(jobs.map((j) => j.promise));

  // Abbonamenti scaduti o revocati (404/410): si tolgono, non servono più
  const gone = new Set<string>();
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = (r.reason as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) gone.add(jobs[i].endpoint);
    }
  });
  if (gone.size > 0) await admin.from('push_subscriptions').delete().in('endpoint', [...gone]);

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return json({ interventi: toNotify.length, sent, falliti: results.length - sent, rimossi: gone.size });
});
