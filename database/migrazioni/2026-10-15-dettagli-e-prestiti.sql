-- 1) Interventi: dettagli scritti PRIMA dell'intervento (non finiscono nel rapporto degli effettuati)
alter table public.manutenzioni_soste add column if not exists dettagli text;

-- 2) Prestiti di articoli del magazzino
create table if not exists public.prestiti (
  id uuid not null default gen_random_uuid() primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  codice_articolo text not null,
  quantita integer not null check (quantita > 0),
  destinatario text not null check (char_length(btrim(destinatario)) > 0),
  locazione text,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  reintegrato_at timestamptz,
  reintegrato_by uuid,
  reintegrato_by_name text,
  reintegro_transaction_id uuid references public.transactions(id) on delete set null
);
create index if not exists prestiti_aperti_idx on public.prestiti (created_at desc) where reintegrato_at is null;
create index if not exists prestiti_product_idx on public.prestiti (product_id);

alter table public.prestiti enable row level security;
-- lettura per tutti gli utenti autenticati; scrittura solo tramite le funzioni qui sotto (nessuna policy di INSERT/UPDATE diretta)
create policy prestiti_select on public.prestiti as permissive for select to authenticated using (true);
create policy prestiti_delete_admin on public.prestiti as permissive for delete to authenticated
  using (current_user_role() = 'admin'::user_role);

-- Prelievo registrato come prestito (atomico: movimento + prestito)
create or replace function public.process_prestito(p_product_id uuid, p_quantita integer, p_destinatario text, p_location_id uuid default null, p_note text default null)
 returns table(prestito_id uuid, transaction_id uuid, nuova_giacenza integer, codice_articolo text, sotto_scorta boolean, locazione_scaffale text, giacenza_scaffale integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_dest text := nullif(btrim(p_destinatario), '');
  v_tx record;
  v_name text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if v_dest is null then raise exception 'Indica a chi viene dato in prestito'; end if;
  select * into v_tx from public.process_transaction(
    p_product_id, 'prelievo'::transaction_type, p_quantita, null,
    left('Prestito a ' || v_dest || coalesce(' - ' || nullif(btrim(p_note), ''), ''), 300),
    null, null, p_location_id);
  select pr.full_name into v_name from public.profiles pr where pr.id = auth.uid();
  insert into public.prestiti (product_id, codice_articolo, quantita, destinatario, locazione, transaction_id, created_by_name)
  values (p_product_id, v_tx.codice_articolo, p_quantita, v_dest, v_tx.locazione_scaffale, v_tx.transaction_id, v_name)
  returning id into v_id;
  return query select v_id, v_tx.transaction_id, v_tx.nuova_giacenza, v_tx.codice_articolo, v_tx.sotto_scorta, v_tx.locazione_scaffale, v_tx.giacenza_scaffale;
end;
$function$;

-- Reintegro di un prestito (atomico: deposito + chiusura del prestito). Con p_location_id si sceglie lo scaffale; altrimenti quello di partenza
create or replace function public.reintegra_prestito(p_prestito_id uuid, p_location_id uuid default null)
 returns table(nuova_giacenza integer, codice_articolo text, locazione_scaffale text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  p record;
  v_loc uuid := p_location_id;
  v_tx record;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select * into p from public.prestiti pt where pt.id = p_prestito_id for update;
  if not found then raise exception 'Prestito non trovato'; end if;
  if p.reintegrato_at is not null then raise exception 'Questo prestito è già stato reintegrato'; end if;
  if v_loc is null then
    select l.id into v_loc from public.product_locations l
      where l.product_id = p.product_id and l.locazione is not distinct from p.locazione limit 1;
    if v_loc is null and (select count(*) from public.product_locations l where l.product_id = p.product_id) = 1 then
      select l.id into v_loc from public.product_locations l where l.product_id = p.product_id;
    end if;
  end if;
  select * into v_tx from public.process_transaction(
    p.product_id, 'deposito'::transaction_type, p.quantita, null,
    left('Reintegro prestito da ' || p.destinatario, 300), null, null, v_loc);
  select pr.full_name into v_name from public.profiles pr where pr.id = auth.uid();
  update public.prestiti pt
    set reintegrato_at = now(), reintegrato_by = auth.uid(), reintegrato_by_name = v_name, reintegro_transaction_id = v_tx.transaction_id
    where pt.id = p_prestito_id;
  return query select v_tx.nuova_giacenza, v_tx.codice_articolo, v_tx.locazione_scaffale;
end;
$function$;

revoke execute on function public.process_prestito(uuid, integer, text, uuid, text) from public, anon;
revoke execute on function public.reintegra_prestito(uuid, uuid) from public, anon;
grant execute on function public.process_prestito(uuid, integer, text, uuid, text) to authenticated;
grant execute on function public.reintegra_prestito(uuid, uuid) to authenticated;
