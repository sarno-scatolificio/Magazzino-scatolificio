// =============================================================
// notify-sotto-scorta — Edge Function (Supabase)
// =============================================================
// La chiama il database: il trigger notify_sotto_scorta() quando uno o più articoli scendono sotto la scorta
// minima (di giorno), oppure flush_push_queue_scorta() dopo le 07:00 per quelli scesi nel silenzio notturno
// (22:00-07:00). Invia UNA notifica push a tutti gli abbonamenti che hanno attivo «articoli sotto scorta»,
// tranne (di giorno) chi ha provocato la discesa. Non è chiamabile dall'app: si autentica con il segreto condiviso
// (header x-push-secret) salvato nella tabella push_config, per questo verify_jwt è false.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_CODES = 3; // codici articolo mostrati nella notifica riassuntiva

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
  let actor: string | null = null;
  let notte = false;
  try {
    const body = await req.json();
    ids = Array.isArray(body?.product_ids) ? body.product_ids : [];
    actor = typeof body?.actor === 'string' ? body.actor : null;
    notte = body?.notte === true;
  } catch {
    return json({ error: 'Richiesta non valida' }, 400);
  }
  ids = [...new Set(ids.filter((id) => typeof id === 'string'))].slice(0, 200);
  if (ids.length === 0) return json({ error: 'product_ids mancante' }, 400);

  // Solo gli articoli ancora sotto scorta (uno tornato a posto nel frattempo non genera più avviso)
  const { data: rows, error: rowsError } = await admin
    .from('products')
    .select('id, codice_articolo, quantita_disponibile, scorta_minima, locazione, sotto_scorta_dal')
    .in('id', ids)
    .not('sotto_scorta_dal', 'is', null);
  if (rowsError) return json({ error: 'Articoli non leggibili' }, 500);
  const items = (rows || []).slice().sort((a, b) => String(a.codice_articolo).localeCompare(String(b.codice_articolo), 'it', { numeric: true }));
  if (items.length === 0) return json({ sent: 0, motivo: 'nessun articolo sotto scorta' });

  // Destinatari: chi ha attivo «articoli sotto scorta». Di giorno non riceve l'avviso chi ha provocato la discesa
  // (lo vede già sullo schermo); nel riepilogo notturno lo ricevono tutti.
  let subsQuery = admin.from('push_subscriptions').select('endpoint, user_id, p256dh, auth').eq('scorta', true);
  if (actor && !notte) subsQuery = subsQuery.neq('user_id', actor);
  const { data: subs, error: subsError } = await subsQuery;
  if (subsError) return json({ error: 'Abbonamenti non leggibili' }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, motivo: 'nessun destinatario' });

  // Testo della notifica
  let title: string;
  let body: string;
  if (items.length === 1) {
    const p = items[0];
    const shelf = (p.locazione || '').trim();
    const stock = p.quantita_disponibile > 0 ? `restano ${p.quantita_disponibile} pz (minimo ${p.scorta_minima})` : `esaurito (minimo ${p.scorta_minima})`;
    title = notte ? 'Articolo sceso sotto scorta stanotte' : 'Articolo sotto scorta minima';
    body = `${p.codice_articolo}: ${stock}${shelf ? ` · ${shelf.includes(',') ? 'Scaffali' : 'Scaffale'} ${shelf}` : ''}`;
  } else {
    const codes = items.slice(0, MAX_CODES).map((p) => p.codice_articolo);
    const more = items.length - MAX_CODES;
    title = notte ? `${items.length} articoli scesi sotto scorta stanotte` : `${items.length} articoli sotto scorta minima`;
    body = more > 0 ? `${codes.join(', ')} e altri ${more}` : codes.join(', ');
  }
  const payload = JSON.stringify({
    kind: 'sotto-scorta',
    title,
    body,
    tag: items.length === 1 ? `scorta-${items[0].id}` : `scorta-gruppo-${notte ? 'notte' : 'giorno'}`,
    url: './?sottoscorta=1',
  });

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  const results = await Promise.allSettled(
    subs.map((s) =>
      // Promise.resolve().then(...): un abbonamento non valido fa fallire solo il suo invio, non tutti gli altri
      Promise.resolve().then(() =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 24,
          urgency: 'high',
        })
      )
    )
  );

  // Abbonamenti scaduti o revocati (404/410): si tolgono, non servono più
  const gone: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = (r.reason as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) gone.push(subs[i].endpoint);
    }
  });
  if (gone.length > 0) await admin.from('push_subscriptions').delete().in('endpoint', gone);

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return json({ articoli: items.length, sent, falliti: results.length - sent, rimossi: gone.length });
});
