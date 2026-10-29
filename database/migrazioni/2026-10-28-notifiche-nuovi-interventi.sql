-- Notifiche push quando un utente inserisce a mano un nuovo intervento DA EFFETTUARE.
-- Eseguita sul database di produzione il 28 ottobre 2026 (conservata qui come riferimento: non rieseguirla).
--
-- COME FUNZIONA
--  1. Ogni telefono/PC che attiva l'interruttore "Notifiche nuovi interventi" (Impostazioni → Preferenze) registra il
--     proprio abbonamento push con save_push_subscription(). Spegnendolo l'abbonamento viene cancellato.
--  2. Quando in manutenzioni_soste viene inserito un intervento con stato 'da_effettuare' e un autore (created_by),
--     il trigger notify_nuovo_intervento() chiama la edge function «notify-nuovo-intervento» (via pg_net).
--     Restano esclusi gli interventi già effettuati e quelli generati dallo scadenziario (senza autore).
--  3. La edge function invia la notifica (autore + descrizione) a tutti gli abbonamenti TRANNE quelli dell'autore.
--  4. Un errore nelle notifiche non blocca mai l'inserimento dell'intervento.
--
-- Le chiavi (VAPID) e il segreto del collegamento stanno nella tabella push_config, leggibile solo dal server
-- (nessun accesso dall'app). Qui NON sono riportate: sono state inserite a parte.

create extension if not exists pg_net with schema extensions;

-- ---------- Configurazione (solo server) ----------
create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;
revoke all on table public.push_config from anon, authenticated;
-- chiavi attese: vapid_public, vapid_private, vapid_subject, webhook_secret, function_url

-- ---------- Abbonamenti ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- L'app non legge né scrive la tabella direttamente: passa da queste due funzioni.
-- Se lo stesso dispositivo viene usato da un altro utente, l'abbonamento passa a lui.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
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
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, updated_at = now();
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------- Trigger sugli interventi ----------
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
  -- nessun altro abbonato: inutile chiamare la funzione
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
    body := jsonb_build_object('intervento_id', new.id),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  return null; -- una notifica mancata non deve mai bloccare l'inserimento dell'intervento
end;
$$;
revoke all on function public.notify_nuovo_intervento() from public, anon, authenticated;

drop trigger if exists notify_nuovo_intervento on public.manutenzioni_soste;
create trigger notify_nuovo_intervento after insert on public.manutenzioni_soste
  for each row execute function public.notify_nuovo_intervento();
