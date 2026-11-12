-- Torri e teste dei macchinari con teste (Tasi test, Provatrice boni, Uniformer, Can-o-mat).
-- 1) machines.torri: elenco delle torri di una macchina, [{ "nome": "Bordatura", "teste": 8, "tipo": "singola" | "doppia" }]
--    ("doppia" = ogni posizione ha una testa superiore e una inferiore). Si imposta da Impostazioni -> Gestione macchine.
--    Vuota (null) per Tasi test e Provatrice boni = come prima (una torre senza nome, 40 e 72 teste).
-- 2) transactions.punti_testa: testa/e su cui e' montato il pezzo quando la macchina ha torri con nome o teste superiori/inferiori,
--    [{ "torre": "Bordatura", "testa": 5, "pos": "S" | "I" | null }]. Il caso semplice (una torre senza nome, teste singole)
--    continua a usare la colonna `teste` della migrazione 2026-11-10.
-- 3) process_transaction con un parametro in piu' (p_punti_testa, facoltativo): il database controlla che i punti siano tanti
--    quanti la quantita' del prelievo e che non ci siano doppioni.
-- Da eseguire UNA volta nel SQL Editor di Supabase, DOPO la migrazione 2026-11-10 e PRIMA di pubblicare la versione dell'app
-- che usa le torri. E' solo additiva: chi chiama la funzione come prima (process_prestito, reintegra_prestito, depositi,
-- prelievi senza testa) continua a funzionare senza cambiare nulla.

alter table public.machines add column if not exists torri jsonb;
alter table public.machines drop constraint if exists machines_torri_check;
alter table public.machines add constraint machines_torri_check check (torri is null or (jsonb_typeof(torri) = 'array' and jsonb_array_length(torri) between 1 and 12));

alter table public.transactions add column if not exists punti_testa jsonb;
alter table public.transactions drop constraint if exists transactions_punti_testa_check;
alter table public.transactions add constraint transactions_punti_testa_check check (punti_testa is null or (jsonb_typeof(punti_testa) = 'array' and jsonb_array_length(punti_testa) between 1 and 999));

create or replace function public.process_transaction(
  p_product_id uuid,
  p_tipo transaction_type,
  p_quantita integer,
  p_punto_utilizzo text default null::text,
  p_note text default null::text,
  p_linea text default null::text,
  p_macchinario text default null::text,
  p_location_id uuid default null::uuid,
  p_teste integer[] default null::integer[],
  p_punti_testa jsonb default null::jsonb
)
 returns table(transaction_id uuid, nuova_giacenza integer, codice_articolo text, sotto_scorta boolean, locazione_scaffale text, giacenza_scaffale integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_scorta_minima integer;
  v_codice text;
  v_loc_id uuid;
  v_loc_name text;
  v_loc_qty integer;
  v_count integer;
  v_new_loc_qty integer;
  v_nuova_giacenza integer;
  v_transaction_id uuid;
begin
  if v_uid is null then
    raise exception 'Utente non autenticato';
  end if;

  if p_quantita is null or p_quantita <= 0 then
    raise exception 'Quantita non valida';
  end if;

  if p_teste is not null then
    if cardinality(p_teste) = 0 or exists (select 1 from unnest(p_teste) t where t is null or t < 1 or t > 999) then
      raise exception 'Testa non valida';
    end if;
    if (select count(distinct t) from unnest(p_teste) t) <> cardinality(p_teste) then
      raise exception 'Una testa e'' stata scelta due volte';
    end if;
    if p_tipo = 'prelievo' and cardinality(p_teste) <> p_quantita then
      raise exception 'Le teste scelte (%) non corrispondono alla quantita (%)', cardinality(p_teste), p_quantita;
    end if;
  end if;

  if p_punti_testa is not null then
    if p_teste is not null then
      raise exception 'Le teste vanno indicate in un solo modo';
    end if;
    if jsonb_typeof(p_punti_testa) <> 'array' or jsonb_array_length(p_punti_testa) = 0 or jsonb_array_length(p_punti_testa) > 999 then
      raise exception 'Testa non valida';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_punti_testa) e
      where not coalesce(
        jsonb_typeof(e) = 'object'
        and case when (e->>'testa') ~ '^[0-9]{1,3}$' then (e->>'testa')::int between 1 and 999 else false end
        and coalesce(e->>'pos', '') in ('', 'S', 'I')
        and char_length(coalesce(e->>'torre', '')) <= 60, false)
    ) then
      raise exception 'Testa non valida';
    end if;
    if (select count(distinct (btrim(coalesce(e->>'torre', '')), e->>'testa', coalesce(e->>'pos', ''))) from jsonb_array_elements(p_punti_testa) e) <> jsonb_array_length(p_punti_testa) then
      raise exception 'Una testa e'' stata scelta due volte';
    end if;
    if p_tipo = 'prelievo' and jsonb_array_length(p_punti_testa) <> p_quantita then
      raise exception 'Le teste scelte (%) non corrispondono alla quantita (%)', jsonb_array_length(p_punti_testa), p_quantita;
    end if;
  end if;

  -- 1) blocco l'articolo (sempre prima di qualsiasi sua locazione: stesso ordine ovunque, niente deadlock)
  select p.scorta_minima, p.codice_articolo
    into v_scorta_minima, v_codice
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'Prodotto non trovato';
  end if;

  -- 2) scelgo lo scaffale
  if p_location_id is not null then
    select l.id, l.locazione, l.quantita
      into v_loc_id, v_loc_name, v_loc_qty
    from public.product_locations l
    where l.id = p_location_id and l.product_id = p_product_id
    for update;
    if not found then
      raise exception 'Scaffale non trovato per questo articolo';
    end if;
  else
    select count(*) into v_count from public.product_locations l where l.product_id = p_product_id;
    if v_count > 1 then
      raise exception 'Scegli lo scaffale: questo articolo e'' presente in piu'' scaffali';
    elsif v_count = 1 then
      select l.id, l.locazione, l.quantita
        into v_loc_id, v_loc_name, v_loc_qty
      from public.product_locations l
      where l.product_id = p_product_id
      for update;
    else
      insert into public.product_locations (product_id, locazione, quantita)
      values (p_product_id, null, 0)
      returning id, locazione, quantita into v_loc_id, v_loc_name, v_loc_qty;
    end if;
  end if;

  -- 3) applico il movimento sullo scaffale scelto
  if p_tipo = 'prelievo' then
    if v_loc_qty < p_quantita then
      raise exception 'Giacenza insufficiente: disponibili % pezzi%', v_loc_qty,
        case when v_loc_name is not null then ' sullo scaffale ' || v_loc_name else '' end;
    end if;
    v_new_loc_qty := v_loc_qty - p_quantita;
  else
    v_new_loc_qty := v_loc_qty + p_quantita;
  end if;

  update public.product_locations l
    set quantita = v_new_loc_qty
    where l.id = v_loc_id;  -- il trigger riallinea il totale su products

  select p.quantita_disponibile into v_nuova_giacenza from public.products p where p.id = p_product_id;

  insert into public.transactions (product_id, user_id, tipo, quantita, punto_utilizzo_specifico, note, linea, macchinario, locazione, teste, punti_testa)
  values (
    p_product_id, v_uid, p_tipo, p_quantita, p_punto_utilizzo, p_note,
    nullif(btrim(p_linea), ''),
    nullif(btrim(p_macchinario), ''),
    v_loc_name,
    case when p_tipo = 'prelievo' then (select array_agg(t order by t) from unnest(p_teste) t) else null end  -- le teste hanno senso solo nel prelievo,
    case when p_tipo = 'prelievo' and p_punti_testa is not null then (
      select jsonb_agg(jsonb_build_object('torre', btrim(coalesce(e->>'torre', '')), 'testa', (e->>'testa')::int, 'pos', nullif(e->>'pos', ''))
        order by btrim(coalesce(e->>'torre', '')), (e->>'testa')::int, coalesce(e->>'pos', ''))
      from jsonb_array_elements(p_punti_testa) e
    ) else null end
  )
  returning id into v_transaction_id;

  -- la scorta minima vale sul TOTALE di tutti gli scaffali
  return query select
    v_transaction_id,
    v_nuova_giacenza,
    v_codice,
    (v_nuova_giacenza < v_scorta_minima),
    v_loc_name,
    v_new_loc_qty;
end;
$function$;

-- La versione a 9 parametri (2026-11-10) va tolta: con due versioni la chiamata resterebbe ambigua
drop function if exists public.process_transaction(uuid, public.transaction_type, integer, text, text, text, text, uuid, integer[]);

revoke execute on function public.process_transaction(uuid, public.transaction_type, integer, text, text, text, text, uuid, integer[], jsonb) from public, anon;
grant execute on function public.process_transaction(uuid, public.transaction_type, integer, text, text, text, text, uuid, integer[], jsonb) to authenticated;

-- Rollback (solo se non esistono ancora movimenti con punti_testa): ricreare process_transaction a 9 parametri da
-- 2026-11-10-testa-piattelle.sql (dopo aver tolto quella a 10), rifare il grant a authenticated, poi:
--   alter table public.transactions drop column punti_testa;  alter table public.machines drop column torri;
