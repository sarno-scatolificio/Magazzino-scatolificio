-- Pallino "articolo andato sotto scorta minima" (sezione Movimenti).
-- Eseguita sul database di produzione il 29 ottobre 2026 (conservata qui come riferimento: non rieseguirla).
--
-- products.sotto_scorta_dal = istante in cui l'articolo è SCESO sotto la scorta minima (giacenza totale < scorta
-- minima). Resta null finché l'articolo è a posto; si azzera quando torna a posto, così una nuova discesa è un nuovo
-- evento. Lo imposta SOLO questo trigger (qualunque valore scritto da un client viene ignorato).
--  * Gli articoli già sotto scorta al momento dell'attivazione non generano pallini (non sono "scesi" adesso).
--  * Un articolo appena creato non genera pallini (un caricamento Excel non deve riempire tutti di avvisi).
-- L'app mostra il pallino se l'istante è successivo alla prima volta che quell'utente ha usato la funzione e se
-- non ha già visto quell'articolo nelle piastrelle del Movimenti (vedi js/features/magazzino/low-stock-unseen.js).

alter table public.products add column if not exists sotto_scorta_dal timestamptz;

create or replace function public.products_track_sotto_scorta()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_now boolean;
  v_was boolean;
begin
  if tg_op = 'INSERT' then
    new.sotto_scorta_dal := null;
    return new;
  end if;
  v_now := coalesce(new.quantita_disponibile, 0) < coalesce(new.scorta_minima, 0);
  if not v_now then
    new.sotto_scorta_dal := null;
    return new;
  end if;
  v_was := coalesce(old.quantita_disponibile, 0) < coalesce(old.scorta_minima, 0);
  if v_was then
    new.sotto_scorta_dal := old.sotto_scorta_dal; -- già sotto scorta: resta l'istante della discesa
  else
    new.sotto_scorta_dal := now(); -- è appena sceso sotto la scorta minima
  end if;
  return new;
end;
$$;
revoke all on function public.products_track_sotto_scorta() from public, anon, authenticated;

-- Il nome fa sì che scatti dopo gli altri trigger BEFORE della tabella (ordine alfabetico), quindi vede i valori finali
drop trigger if exists products_track_sotto_scorta on public.products;
create trigger products_track_sotto_scorta before insert or update on public.products
  for each row execute function public.products_track_sotto_scorta();

-- Il registro attività non deve contare questo campo come "modifica articolo" (cambia da solo a ogni discesa sotto scorta)
create or replace function public.log_statement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_n integer;
  v_code text;
  v_det text;
begin
  if v_actor is null then
    return null;
  end if;

  if tg_table_name = 'products' then
    if tg_op = 'INSERT' then
      select count(*), min(n.codice_articolo) into v_n, v_code from nuovi n;
      if v_n > 0 then
        perform public.activity_log_write('azione', 'Articoli',
          case when v_n = 1 then 'Nuovo articolo ' || v_code else 'Caricati ' || v_n || ' articoli' end, null, v_actor);
      end if;
    elsif tg_op = 'DELETE' then
      select count(*), min(o.codice_articolo) into v_n, v_code from vecchi o;
      if v_n > 0 then
        perform public.activity_log_write('azione', 'Articoli',
          case when v_n = 1 then 'Eliminato articolo ' || v_code else 'Eliminati ' || v_n || ' articoli' end, null, v_actor);
      end if;
    else
      select count(*), min(n.codice_articolo) into v_n, v_code
      from nuovi n join vecchi o on o.id = n.id
      where (to_jsonb(n) - 'quantita_disponibile' - 'locazione' - 'updated_at' - 'sotto_scorta_dal')
        is distinct from (to_jsonb(o) - 'quantita_disponibile' - 'locazione' - 'updated_at' - 'sotto_scorta_dal');
      if v_n > 0 then
        if v_n = 1 then
          select string_agg(distinct case k.key
              when 'codice_articolo' then 'codice'
              when 'descrizione' then 'descrizione'
              when 'categoria' then 'categoria'
              when 'scorta_minima' then 'scorta minima'
              when 'codice_barre' then 'codice a barre'
              when 'produttore_barcode' then 'produttore'
              when 'punto_utilizzo_standard' then 'punto di utilizzo'
              else k.key end, ', ')
            into v_det
          from nuovi n
          join vecchi o on o.id = n.id
          cross join lateral jsonb_each(to_jsonb(n)) k
          where k.key not in ('quantita_disponibile', 'locazione', 'updated_at', 'sotto_scorta_dal')
            and k.value is distinct from (to_jsonb(o) -> k.key);
          v_det := 'Campi: ' || v_det;
        end if;
        perform public.activity_log_write('azione', 'Articoli',
          case when v_n = 1 then 'Modificato articolo ' || v_code else 'Modificati ' || v_n || ' articoli' end, v_det, v_actor);
      end if;
    end if;

  elsif tg_table_name = 'transactions' then -- solo DELETE
    select count(*) into v_n from vecchi;
    if v_n = 1 then
      select initcap(o.tipo::text) || ' ' || o.quantita || ' × ' || coalesce(p.codice_articolo, '(articolo eliminato)')
        into v_det
      from vecchi o left join public.products p on p.id = o.product_id;
      perform public.activity_log_write('azione', 'Movimenti', 'Eliminato movimento: ' || v_det, null, v_actor);
    elsif v_n > 1 then
      perform public.activity_log_write('azione', 'Movimenti', 'Eliminati ' || v_n || ' movimenti', null, v_actor);
    end if;
  end if;

  return null;
end;
$$;
