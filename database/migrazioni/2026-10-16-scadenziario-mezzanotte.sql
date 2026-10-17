-- Scadenziario interventi rapidi: l'intervento compare tra i "Da effettuare" alle 00:00 del giorno di scadenza
-- (prima alle 06:00). Da eseguire nell'SQL Editor di Supabase. Il controllo gira già ogni 5 minuti (pg_cron),
-- quindi l'intervento appare entro pochi minuti da mezzanotte.
-- Gli interventi già inseriti non vengono toccati.
create or replace function public.genera_interventi_programmati()
 returns integer
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
  v_linea text;
  v_last record;
  v_ref timestamptz;
  v_due timestamptz;
  v_n integer := 0;
  v_gen timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('genera_interventi_programmati'));
  for r in select * from public.interventi_rapidi where cadenza_giorni is not null loop
    v_gen := null;
    foreach v_linea in array (case when r.linea = 'L1-L2' then array['L1','L2'] else array[r.linea] end) loop
      select s.stato, s.esito_at, s.created_at into v_last
        from public.manutenzioni_soste s where s.rapido_id = r.id and s.linea = v_linea
        order by s.created_at desc limit 1;
      if found then
        if v_last.stato <> 'effettuato' then continue; end if;
        v_ref := coalesce(v_last.esito_at, v_last.created_at);
      else
        v_ref := greatest(coalesce(r.cadenza_da, r.created_at), coalesce(r.generato_at, '-infinity'::timestamptz));
      end if;
      -- scadenza = giorno del riferimento + cadenza, alle 00:00 ora di Roma
      v_due := ((((v_ref at time zone 'Europe/Rome')::date + r.cadenza_giorni) + time '00:00') at time zone 'Europe/Rome');
      if v_due <= now() then
        insert into public.manutenzioni_soste (linea, macchina, descrizione, stato, created_by_name, created_at, rapido_id)
        values (v_linea, r.macchina, r.titolo, 'da_effettuare', 'Scadenziario', v_due, r.id);
        v_gen := v_due;
        v_n := v_n + 1;
      end if;
    end loop;
    if v_gen is not null then
      update public.interventi_rapidi set generato_at = v_gen where id = r.id;
    end if;
  end loop;
  return v_n;
end;
$function$;
