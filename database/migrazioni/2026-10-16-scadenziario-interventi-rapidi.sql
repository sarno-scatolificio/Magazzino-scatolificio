-- Scadenziario interventi rapidi (già applicato sul database di produzione il 16/10/2026)
alter table public.interventi_rapidi add column if not exists cadenza_giorni integer check (cadenza_giorni is null or (cadenza_giorni between 1 and 365));
alter table public.interventi_rapidi add column if not exists cadenza_da timestamptz;
alter table public.interventi_rapidi add column if not exists generato_at timestamptz;
alter table public.manutenzioni_soste add column if not exists rapido_id uuid references public.interventi_rapidi(id) on delete set null;
create index if not exists manutenzioni_soste_rapido_idx on public.manutenzioni_soste (rapido_id) where rapido_id is not null;

create or replace function public.genera_interventi_programmati()
 returns integer
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
  v_last record;
  v_ref timestamptz;
  v_due timestamptz;
  v_n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('genera_interventi_programmati'));
  for r in select * from public.interventi_rapidi where cadenza_giorni is not null loop
    select s.stato, s.esito_at, s.created_at into v_last
      from public.manutenzioni_soste s where s.rapido_id = r.id
      order by s.created_at desc limit 1;
    if found then
      if v_last.stato <> 'effettuato' then continue; end if;
      v_ref := coalesce(v_last.esito_at, v_last.created_at);
    else
      v_ref := greatest(coalesce(r.cadenza_da, r.created_at), coalesce(r.generato_at, '-infinity'::timestamptz));
    end if;
    v_due := ((((v_ref at time zone 'Europe/Rome')::date + r.cadenza_giorni) + time '06:00') at time zone 'Europe/Rome');
    if v_due <= now() then
      insert into public.manutenzioni_soste (linea, macchina, descrizione, stato, created_by_name, created_at, rapido_id)
      values (r.linea, r.macchina, r.titolo, 'da_effettuare', 'Scadenziario', v_due, r.id);
      update public.interventi_rapidi set generato_at = v_due where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.genera_interventi_programmati() from public, anon;
grant execute on function public.genera_interventi_programmati() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('genera-interventi-programmati', '*/5 * * * *', 'select public.genera_interventi_programmati()');
