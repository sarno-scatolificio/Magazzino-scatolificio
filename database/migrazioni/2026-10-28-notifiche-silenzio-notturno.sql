-- Silenzio notturno delle notifiche push: dalle 22:00 alle 07:00 (ora italiana) nessuna notifica.
-- Eseguita sul database di produzione il 28 ottobre 2026 (conservata qui come riferimento: non rieseguirla).
--
--  * Un intervento inserito di notte non fa partire la notifica: finisce in push_queue.
--  * Un lavoro pianificato (pg_cron) gira ogni 5 minuti: dopo le 07:00 invia in un colpo solo tutte le notifiche
--    accumulate durante la notte (una per intervento, ancora "da effettuare" a quel momento) e le segna come inviate.
--  * L'orario segue l'ora legale/solare italiana da solo (Europe/Rome).

create table if not exists public.push_queue (
  intervento_id uuid primary key,
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.push_queue enable row level security;
revoke all on table public.push_queue from anon, authenticated;

-- Vero se l'istante cade tra le 22:00 e le 06:59 in Italia
create or replace function public.push_in_silenzio(p_ts timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(hour from (p_ts at time zone 'Europe/Rome')) >= 22
      or extract(hour from (p_ts at time zone 'Europe/Rome')) < 7;
$$;
revoke all on function public.push_in_silenzio(timestamptz) from public, anon, authenticated;

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
    return null; -- già effettuato, oppure generato dallo scadenziario (nessun autore)
  end if;
  -- di notte si mette in coda: la notifica parte dopo le 07:00 (flush_push_queue)
  if public.push_in_silenzio() then
    insert into public.push_queue (intervento_id) values (new.id) on conflict do nothing;
    return null;
  end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id <> new.created_by) then
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
  return null; -- una notifica mancata non deve mai bloccare l'inserimento dell'intervento
end;
$$;
revoke all on function public.notify_nuovo_intervento() from public, anon, authenticated;

-- Invia le notifiche in coda (solo fuori dal silenzio). Ritorna quante ne ha inviate.
create or replace function public.flush_push_queue()
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
  select array_agg(t.intervento_id order by t.queued_at) into v_ids
  from (
    select q.intervento_id, q.queued_at from public.push_queue q
    where q.sent_at is null
    order by q.queued_at
    limit 50
    for update skip locked
  ) t;
  if v_ids is null then
    delete from public.push_queue where sent_at < now() - interval '7 days';
    return 0;
  end if;
  select c.value into v_url from public.push_config c where c.key = 'function_url';
  select c.value into v_secret from public.push_config c where c.key = 'webhook_secret';
  if v_url is null or v_secret is null then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('intervento_ids', to_jsonb(v_ids)),
    timeout_milliseconds := 20000
  );
  update public.push_queue set sent_at = now() where intervento_id = any (v_ids);
  return array_length(v_ids, 1);
exception when others then
  return 0;
end;
$$;
revoke all on function public.flush_push_queue() from public, anon, authenticated;

-- Ogni 5 minuti: fuori dal silenzio smaltisce la coda, di notte non fa nulla
select cron.schedule('flush-push-queue', '*/5 * * * *', 'select public.flush_push_queue()');
