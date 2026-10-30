-- Notifiche push degli articoli appena scesi SOTTO SCORTA MINIMA.
-- Eseguita sul database di produzione il 29 ottobre 2026 (conservata qui come riferimento: non rieseguirla).
--
--  1. Ogni abbonamento (dispositivo) ha due preferenze indipendenti: "interventi" (già attiva, default sì) e
--     "scorta" (nuova, default NO: chi aveva attivato solo gli interventi non riceve le nuove senza averlo scelto).
--  2. Quando un UPDATE su products porta articoli sotto scorta (products.sotto_scorta_dal diventa valorizzato o
--     cambia), il trigger notify_sotto_scorta() chiama la edge function «notify-sotto-scorta» UNA volta per istruzione
--     (più articoli insieme = una sola notifica). Chi ha provocato la discesa non riceve la propria notifica.
--  3. Dalle 22:00 alle 07:00 (ora italiana) non parte nulla: gli articoli finiscono in push_queue_scorta e dopo le
--     07:00 (lavoro pianificato ogni 5 minuti) parte UN riepilogo con tutti quelli ancora sotto scorta.
--  4. Un errore nelle notifiche non blocca mai il movimento o la modifica che le ha originate.

-- ---------- Preferenze per tipo di notifica ----------
alter table public.push_subscriptions add column if not exists interventi boolean not null default true;
alter table public.push_subscriptions add column if not exists scorta boolean not null default false;

-- Nuova firma (le chiamate vecchie con 4 argomenti funzionano uguale: interventi sì, scorta no)
drop function if exists public.save_push_subscription(text, text, text, text);
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_interventi boolean default true, p_scorta boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Abbonamento non valido';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, interventi, scorta)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 200), coalesce(p_interventi, true), coalesce(p_scorta, false))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, interventi = excluded.interventi, scorta = excluded.scorta,
        updated_at = now();
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, boolean, boolean) to authenticated;

-- Il trigger degli interventi guarda solo chi ha attive le notifiche degli interventi
create or replace function public.notify_nuovo_intervento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.stato <> 'da_effettuare' or new.created_by is null then
    return null;
  end if;
  if public.push_in_silenzio() then
    insert into public.push_queue (intervento_id) values (new.id) on conflict do nothing;
    return null;
  end if;
  if not exists (select 1 from public.push_subscriptions s where s.interventi and s.user_id <> new.created_by) then
    return null;
  end if;
  select c.value into v_url from public.push_config c where c.key = 'function_url';
  select c.value into v_secret from public.push_config c where c.key = 'webhook_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('intervento_ids', jsonb_build_array(new.id)),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.notify_nuovo_intervento() from public, anon, authenticated;

-- ---------- Sotto scorta: indirizzo della funzione e coda notturna ----------
insert into public.push_config (key, value)
values ('function_url_scorta', 'https://ffbwazuikbqkikuybcyp.supabase.co/functions/v1/notify-sotto-scorta')
on conflict (key) do update set value = excluded.value;

create table if not exists public.push_queue_scorta (
  product_id uuid not null,
  sotto_scorta_dal timestamptz not null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (product_id, sotto_scorta_dal)
);
alter table public.push_queue_scorta enable row level security;
revoke all on table public.push_queue_scorta from anon, authenticated;

create or replace function public.notify_sotto_scorta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_url text;
  v_secret text;
begin
  -- articoli che con questa istruzione sono appena scesi sotto scorta (o hanno una nuova discesa)
  select array_agg(n.id) into v_ids
  from nuovi n join vecchi o on o.id = n.id
  where n.sotto_scorta_dal is not null and n.sotto_scorta_dal is distinct from o.sotto_scorta_dal;
  if v_ids is null then
    return null;
  end if;
  -- di notte si mette in coda: il riepilogo parte dopo le 07:00 (flush_push_queue_scorta)
  if public.push_in_silenzio() then
    insert into public.push_queue_scorta (product_id, sotto_scorta_dal)
    select n.id, n.sotto_scorta_dal from nuovi n where n.id = any (v_ids)
    on conflict do nothing;
    return null;
  end if;
  if not exists (
    select 1 from public.push_subscriptions s where s.scorta and (v_actor is null or s.user_id <> v_actor)
  ) then
    return null;
  end if;
  select c.value into v_url from public.push_config c where c.key = 'function_url_scorta';
  select c.value into v_secret from public.push_config c where c.key = 'webhook_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('product_ids', to_jsonb(v_ids), 'actor', v_actor),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  return null; -- una notifica mancata non deve mai bloccare il movimento
end;
$$;
revoke all on function public.notify_sotto_scorta() from public, anon, authenticated;

drop trigger if exists notify_sotto_scorta on public.products;
create trigger notify_sotto_scorta after update on public.products
  referencing old table as vecchi new table as nuovi
  for each statement execute function public.notify_sotto_scorta();

-- Dopo le 07:00: un solo riepilogo con gli articoli scesi di notte e ancora sotto scorta
create or replace function public.flush_push_queue_scorta()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_url text;
  v_secret text;
begin
  if public.push_in_silenzio() then
    return 0;
  end if;
  -- tornati a posto nel frattempo (o con una discesa più recente, che ha già la sua voce): niente avviso
  update public.push_queue_scorta q set sent_at = now()
  where q.sent_at is null
    and not exists (select 1 from public.products p where p.id = q.product_id and p.sotto_scorta_dal = q.sotto_scorta_dal);
  select array_agg(t.product_id order by t.queued_at) into v_ids
  from (
    select q.product_id, q.queued_at from public.push_queue_scorta q
    where q.sent_at is null
    order by q.queued_at
    limit 100
    for update skip locked
  ) t;
  if v_ids is null then
    delete from public.push_queue_scorta where sent_at < now() - interval '7 days';
    return 0;
  end if;
  select c.value into v_url from public.push_config c where c.key = 'function_url_scorta';
  select c.value into v_secret from public.push_config c where c.key = 'webhook_secret';
  if v_url is null or v_secret is null then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('product_ids', to_jsonb(v_ids), 'notte', true),
    timeout_milliseconds := 20000
  );
  update public.push_queue_scorta set sent_at = now() where product_id = any (v_ids) and sent_at is null;
  return array_length(v_ids, 1);
exception when others then
  return 0;
end;
$$;
revoke all on function public.flush_push_queue_scorta() from public, anon, authenticated;

select cron.schedule('flush-push-queue-scorta', '*/5 * * * *', 'select public.flush_push_queue_scorta()');
