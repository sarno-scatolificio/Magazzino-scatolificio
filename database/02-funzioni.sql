-- =============================================================
-- 02-funzioni.sql — Funzioni e procedure del database (schema public)
-- =============================================================
-- Fotografia del 15 ottobre 2026 (vedi 01-struttura.sql per le avvertenze).
-- Le funzioni SECURITY DEFINER verificano il ruolo dell'utente anche
-- internamente: non si affidano solo alle regole RLS.

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.role = 'admin'::public.user_role
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_display_names()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'admin'::public.user_role;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'user'
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manutenzioni_soste_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at := now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.product_barcodes_check_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.products p where p.codice_barre = new.codice_barre) then
    raise exception 'Il codice a barre % è già assegnato a un articolo', new.codice_barre using errcode = '23505';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.products_check_barcode_not_extra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.codice_barre is not null
     and exists (select 1 from public.product_barcodes b where b.codice_barre = new.codice_barre) then
    raise exception 'Il codice a barre % è già assegnato a un articolo', new.codice_barre using errcode = '23505';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.products_create_initial_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.product_locations (product_id, locazione, quantita)
  values (new.id, nullif(btrim(new.locazione), ''), coalesce(new.quantita_disponibile, 0));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.products_guard_stock_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- profondità 1 = UPDATE diretto sull'articolo; >1 = aggiornamento fatto dal trigger di sincronizzazione
  if pg_trigger_depth() = 1 then
    new.quantita_disponibile := old.quantita_disponibile;
    new.locazione := old.locazione;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_from_locations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pid uuid := coalesce(new.product_id, old.product_id);
begin
  -- Blocco la riga dell'articolo PRIMA di sommare: due movimenti su scaffali diversi
  -- dello stesso articolo si accodano e il totale finale è sempre corretto.
  perform 1 from public.products p where p.id = v_pid for update;
  if not found then
    return null; -- articolo in eliminazione (cascade)
  end if;

  update public.products p
  set quantita_disponibile = coalesce((select sum(l.quantita) from public.product_locations l where l.product_id = v_pid), 0),
      locazione = (select string_agg(l.locazione, ', ' order by lower(l.locazione))
                   from public.product_locations l where l.product_id = v_pid and l.locazione is not null)
  where p.id = v_pid;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_by_barcode(p_codice_barre text)
 RETURNS SETOF products
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.* from public.products p where p.codice_barre = p_codice_barre
  union all
  select p.* from public.products p join public.product_barcodes b on b.product_id = p.id
   where b.codice_barre = p_codice_barre
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.punti_utilizzo_cuscinetto(p_product_id uuid, p_linea text, p_macchinario text)
 RETURNS TABLE(punto text, volte bigint, ultimo timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select btrim(t.punto_utilizzo_specifico) as punto,
         count(*) as volte,
         max(t.data_ora) as ultimo
    from public.transactions t
   where t.product_id = p_product_id
     and t.tipo = 'prelievo'
     and t.linea = p_linea
     and lower(btrim(coalesce(t.macchinario, ''))) = lower(btrim(coalesce(p_macchinario, '')))
     and nullif(btrim(t.punto_utilizzo_specifico), '') is not null
   group by btrim(t.punto_utilizzo_specifico)
$function$;

CREATE OR REPLACE FUNCTION public.process_transaction(p_product_id uuid, p_tipo transaction_type, p_quantita integer, p_punto_utilizzo text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_linea text DEFAULT NULL::text, p_macchinario text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(transaction_id uuid, nuova_giacenza integer, codice_articolo text, sotto_scorta boolean, locazione_scaffale text, giacenza_scaffale integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.transactions (product_id, user_id, tipo, quantita, punto_utilizzo_specifico, note, linea, macchinario, locazione)
  values (
    p_product_id, v_uid, p_tipo, p_quantita, p_punto_utilizzo, p_note,
    nullif(btrim(p_linea), ''),
    nullif(btrim(p_macchinario), ''),
    v_loc_name
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

CREATE OR REPLACE FUNCTION public.bulk_upsert_products(p_categoria product_category, p_rows jsonb)
 RETURNS TABLE(inseriti integer, aggiornati integer, totale integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inseriti integer := 0;
  v_aggiornati integer := 0;
  v_row jsonb;
  v_pid uuid;
  v_code text;
  v_loc text;
  v_qty integer;
  v_seen uuid[] := '{}';
  v_cnt integer;
  v_old_total integer;
  v_existing_qty integer;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un amministratore puo'' importare articoli';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_code := nullif(trim(v_row->>'codice_articolo'), '');
    if v_code is null then
      continue;
    end if;
    v_loc := nullif(btrim(v_row->>'locazione'), '');
    v_qty := nullif(btrim(v_row->>'quantita_disponibile'), '')::integer;

    select p.id into v_pid
      from public.products p
      where p.categoria = p_categoria and p.codice_articolo = v_code;

    if v_pid is null then
      insert into public.products (categoria, codice_articolo, scorta_minima, linea, macchina, punto_utilizzo_standard)
      values (
        p_categoria, v_code,
        coalesce(nullif(btrim(v_row->>'scorta_minima'), '')::integer, 0),
        nullif(trim(v_row->>'linea'), ''),
        nullif(trim(v_row->>'macchina'), ''),
        nullif(trim(v_row->>'punto_utilizzo_standard'), '')
      )
      returning id into v_pid;
      -- la riga di locazione iniziale (vuota) è creata dal trigger: la riempio
      update public.product_locations l set locazione = v_loc, quantita = coalesce(v_qty, 0) where l.product_id = v_pid;
      v_seen := v_seen || v_pid;
      v_inseriti := v_inseriti + 1;
    else
      update public.products p set
        scorta_minima = coalesce(nullif(btrim(v_row->>'scorta_minima'), '')::integer, p.scorta_minima),
        linea = coalesce(nullif(trim(v_row->>'linea'), ''), p.linea),
        macchina = coalesce(nullif(trim(v_row->>'macchina'), ''), p.macchina),
        punto_utilizzo_standard = coalesce(nullif(trim(v_row->>'punto_utilizzo_standard'), ''), p.punto_utilizzo_standard)
      where p.id = v_pid;

      select count(*), coalesce(sum(l.quantita), 0) into v_cnt, v_old_total
        from public.product_locations l where l.product_id = v_pid;
      select l.quantita into v_existing_qty
        from public.product_locations l
        where l.product_id = v_pid and coalesce(lower(btrim(l.locazione)), '') = coalesce(lower(v_loc), '');

      if v_loc is not null and not (v_pid = any(v_seen)) and v_cnt = 1 then
        -- primo avvistamento di un articolo con un solo scaffale: la riga lo sostituisce (comportamento di sempre)
        v_qty := coalesce(v_qty, v_old_total);
        delete from public.product_locations l where l.product_id = v_pid;
        insert into public.product_locations (product_id, locazione, quantita) values (v_pid, v_loc, v_qty);
      elsif v_loc is not null or v_pid = any(v_seen) then
        -- scaffale aggiuntivo (o articolo già con più scaffali): aggiunge/aggiorna solo quello scaffale
        insert into public.product_locations (product_id, locazione, quantita)
        values (v_pid, v_loc, coalesce(v_qty, v_existing_qty, 0))
        on conflict (product_id, (coalesce(lower(btrim(locazione)), '')))
        do update set quantita = excluded.quantita;
      elsif v_qty is not null then
        -- riga senza scaffale: la quantità si applica solo se l'articolo ha un unico scaffale
        if v_cnt = 1 then
          update public.product_locations l set quantita = v_qty where l.product_id = v_pid;
        elsif v_cnt = 0 then
          insert into public.product_locations (product_id, locazione, quantita) values (v_pid, null, v_qty);
        end if;
      end if;

      v_seen := v_seen || v_pid;
      v_aggiornati := v_aggiornati + 1;
    end if;
  end loop;

  return query select v_inseriti, v_aggiornati, v_inseriti + v_aggiornati;
end;
$function$;

CREATE OR REPLACE FUNCTION public.chiudi_inventario(p_locazione text, p_ciechi boolean, p_motivo text, p_iniziato_at timestamp with time zone, p_righe jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loc text;
  v_key text;
  v_row jsonb;
  v_pid uuid;
  v_cont integer;
  v_prima integer;
  v_exists boolean;
  v_tipo text;
  v_inv uuid;
  v_tot integer := 0;
  v_diff integer := 0;
  v_name text;
  v_prod record;
  v_ids uuid[] := '{}';
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un amministratore puo'' registrare un inventario';
  end if;
  v_loc := nullif(btrim(p_locazione), '');
  if v_loc is null then
    raise exception 'Scaffale non indicato';
  end if;
  if char_length(v_loc) > 60 then
    raise exception 'Nome scaffale troppo lungo (massimo 60 caratteri)';
  end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Nessun articolo da registrare';
  end if;
  if p_motivo is not null and p_motivo not in ('Conteggio errato','Prelievo non registrato','Deposito non registrato','Merce mancante','Altro') then
    raise exception 'Motivo non valido';
  end if;

  v_key := lower(v_loc);
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();

  insert into public.inventari (locazione, ciechi, iniziato_at, user_id, user_name)
  values (v_loc, coalesce(p_ciechi, false), p_iniziato_at, auth.uid(), v_name)
  returning id into v_inv;

  -- ordine stabile sugli articoli: due inventari contemporanei non si bloccano a vicenda
  for v_row in select value from jsonb_array_elements(p_righe) order by value->>'product_id'
  loop
    v_pid := (v_row->>'product_id')::uuid;
    v_cont := (v_row->>'contato')::integer;
    if v_pid is null or v_cont is null or v_cont < 0 then
      raise exception 'Riga di inventario non valida';
    end if;
    if v_pid = any(v_ids) then
      raise exception 'Articolo ripetuto nell''inventario';
    end if;
    v_ids := v_ids || v_pid;

    select p.id, p.codice_articolo, p.categoria,
           case when p.categoria = 'cuscinetti' then p.descrizione else p.punto_utilizzo_standard end as descr
      into v_prod
      from public.products p
     where p.id = v_pid
       for update;
    if not found then
      raise exception 'Articolo non trovato';
    end if;

    select true, l.quantita into v_exists, v_prima
      from public.product_locations l
     where l.product_id = v_pid and coalesce(lower(btrim(l.locazione)), '') = v_key;
    if not found then
      v_exists := false;
      v_prima := 0;
    end if;

    if not v_exists then
      if v_cont = 0 then
        continue; -- non c'era su questo scaffale e non c'è: niente da registrare
      end if;
      v_tipo := 'aggiunto';
      insert into public.product_locations (product_id, locazione, quantita)
      values (v_pid, v_loc, v_cont)
      on conflict (product_id, (coalesce(lower(btrim(locazione)), '')))
      do update set quantita = excluded.quantita;
    else
      if v_cont = v_prima then
        v_tipo := 'confermato';
      elsif v_cont = 0 then
        v_tipo := 'non_trovato';
      else
        v_tipo := 'corretto';
      end if;
      if v_cont <> v_prima then
        update public.product_locations l
           set quantita = v_cont
         where l.product_id = v_pid and coalesce(lower(btrim(l.locazione)), '') = v_key;
      end if;
    end if;

    insert into public.inventario_righe (inventario_id, product_id, codice_articolo, categoria, descrizione, atteso, contato, differenza, tipo)
    values (v_inv, v_pid, v_prod.codice_articolo, v_prod.categoria, nullif(btrim(coalesce(v_prod.descr, '')), ''), v_prima, v_cont, v_cont - v_prima, v_tipo);

    v_tot := v_tot + 1;
    if v_cont <> v_prima then
      v_diff := v_diff + 1;
    end if;
  end loop;

  if v_tot = 0 then
    raise exception 'Nessun articolo da registrare';
  end if;
  if v_diff > 0 and p_motivo is null then
    raise exception 'Indica il motivo delle differenze';
  end if;

  update public.inventari
     set articoli_totali = v_tot,
         con_differenza = v_diff,
         motivo = case when v_diff > 0 then p_motivo else null end
   where id = v_inv;

  return v_inv;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_shelf_assignments(p_nome text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_articoli integer := 0;
  v_null_id uuid;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un amministratore puo'' rimuovere scaffali';
  end if;

  for r in
    select l.id, l.product_id, l.quantita
    from public.product_locations l
    where lower(btrim(l.locazione)) = lower(btrim(p_nome))
  loop
    perform 1 from public.products p where p.id = r.product_id for update;
    select l2.id into v_null_id from public.product_locations l2 where l2.product_id = r.product_id and l2.locazione is null;
    if v_null_id is not null then
      update public.product_locations set quantita = quantita + r.quantita where id = v_null_id;
      delete from public.product_locations where id = r.id;
    else
      update public.product_locations set locazione = null where id = r.id;
    end if;
    v_articoli := v_articoli + 1;
  end loop;

  return v_articoli;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_barcodes(p_product_id uuid, p_primary text, p_primary_maker text, p_extras jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary text := nullif(btrim(p_primary), '');
  v_pmaker  text := nullif(btrim(p_primary_maker), '');
  v_row jsonb;
  v_code text;
  v_maker text;
  v_seen text[] := '{}';
  v_pos integer := 0;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un amministratore puo'' modificare i codici a barre';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'Prodotto non trovato';
  end if;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    p_extras := '[]'::jsonb;
  end if;
  if v_pmaker is not null and char_length(v_pmaker) > 80 then
    raise exception 'Nome del produttore troppo lungo (massimo 80 caratteri)';
  end if;

  perform 1 from public.products p where p.id = p_product_id for update;

  if v_primary is not null then
    if char_length(v_primary) > 120 then raise exception 'Codice a barre troppo lungo (massimo 120 caratteri)'; end if;
    if exists (select 1 from public.products p where p.codice_barre = v_primary and p.id <> p_product_id)
       or exists (select 1 from public.product_barcodes b where b.codice_barre = v_primary and b.product_id <> p_product_id) then
      raise exception 'Il codice a barre % è già assegnato a un altro articolo', v_primary using errcode = '23505';
    end if;
    v_seen := array[lower(v_primary)];
  end if;
  for v_row in select * from jsonb_array_elements(p_extras)
  loop
    v_code := nullif(btrim(v_row->>'codice_barre'), '');
    if v_code is null then continue; end if;
    v_maker := nullif(btrim(v_row->>'produttore'), '');
    if char_length(v_code) > 120 then raise exception 'Codice a barre troppo lungo (massimo 120 caratteri)'; end if;
    if v_maker is not null and char_length(v_maker) > 80 then
      raise exception 'Nome del produttore troppo lungo (massimo 80 caratteri)';
    end if;
    if lower(v_code) = any(v_seen) then
      raise exception 'Il codice a barre % è inserito due volte', v_code using errcode = '23505';
    end if;
    if exists (select 1 from public.products p where p.codice_barre = v_code and p.id <> p_product_id)
       or exists (select 1 from public.product_barcodes b where b.codice_barre = v_code and b.product_id <> p_product_id) then
      raise exception 'Il codice a barre % è già assegnato a un altro articolo', v_code using errcode = '23505';
    end if;
    v_seen := v_seen || lower(v_code);
  end loop;

  delete from public.product_barcodes where product_id = p_product_id;
  update public.products
     set codice_barre = v_primary,
         produttore_barcode = case when v_primary is null then null else v_pmaker end
   where id = p_product_id;
  for v_row in select * from jsonb_array_elements(p_extras)
  loop
    v_code := nullif(btrim(v_row->>'codice_barre'), '');
    if v_code is null then continue; end if;
    v_maker := nullif(btrim(v_row->>'produttore'), '');
    insert into public.product_barcodes (product_id, codice_barre, produttore, ordine)
    values (p_product_id, v_code, v_maker, v_pos);
    v_pos := v_pos + 1;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.set_product_locations(p_product_id uuid, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_loc text;
  v_qty integer;
  v_keys text[] := '{}';
  v_key text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un amministratore puo'' modificare gli scaffali';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'Prodotto non trovato';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Elenco scaffali non valido';
  end if;

  perform 1 from public.products p where p.id = p_product_id for update;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_loc := nullif(btrim(v_row->>'locazione'), '');
    v_qty := coalesce(nullif(btrim(v_row->>'quantita'), '')::integer, 0);
    if v_qty < 0 then
      raise exception 'Quantita non valida';
    end if;
    if v_loc is not null and char_length(v_loc) > 60 then
      raise exception 'Nome scaffale troppo lungo (massimo 60 caratteri)';
    end if;
    v_key := coalesce(lower(v_loc), '');
    if v_key = any(v_keys) then
      raise exception 'Scaffale duplicato: %', coalesce(v_loc, 'senza scaffale');
    end if;
    v_keys := v_keys || v_key;

    insert into public.product_locations (product_id, locazione, quantita)
    values (p_product_id, v_loc, v_qty)
    on conflict (product_id, (coalesce(lower(btrim(locazione)), '')))
    do update set quantita = excluded.quantita, locazione = excluded.locazione;
  end loop;

  -- le righe non più presenti nell'elenco vengono tolte; il trigger riallinea totale e riepilogo
  delete from public.product_locations l
  where l.product_id = p_product_id
    and not (coalesce(lower(btrim(l.locazione)), '') = any(v_keys));
end;
$function$;
