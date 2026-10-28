-- Registro attività: accessi (data e ora) e azioni svolte da ogni utente.
-- Eseguita sul database di produzione il 28 ottobre 2026 (conservata qui come riferimento).
--
-- COME FUNZIONA
--  * Le AZIONI (movimenti, articoli, interventi, inventari, manuali, macchine, scaffali, utenti...) le scrivono dei
--    trigger del database: nessuna azione può sfuggire e l'app non può "dimenticare" di registrarle.
--  * Gli ACCESSI (login, riapertura dell'app, uscita) li invia l'app con la funzione log_accesso().
--  * Il registro può essere LETTO solo da nunziodoria96@gmail.com (policy RLS + funzione is_log_viewer()).
--    Nessuno, nemmeno gli altri Admin, può scriverlo, modificarlo o cancellarlo dall'app.
--  * Le operazioni di sistema senza utente (es. scadenziario automatico degli interventi) non vengono registrate.

-- ---------- Tabella ----------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  user_name text,
  evento text not null check (evento in ('accesso', 'uscita', 'azione')),
  categoria text not null,
  azione text not null,
  dettagli text
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_user_created_idx on public.activity_log (user_id, created_at desc);

alter table public.activity_log enable row level security;

-- Nessun accesso diretto per anonimi; agli autenticati solo la lettura (filtrata dalla policy sotto)
revoke all on table public.activity_log from anon, authenticated;
grant select on table public.activity_log to authenticated;

-- ---------- Chi può leggere ----------
create or replace function public.is_log_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = 'nunziodoria96@gmail.com'
  );
$$;
revoke all on function public.is_log_viewer() from public, anon;
grant execute on function public.is_log_viewer() to authenticated;

drop policy if exists activity_log_select_viewer on public.activity_log;
create policy activity_log_select_viewer on public.activity_log
  as permissive for select to authenticated
  using (public.is_log_viewer());

-- ---------- Scrittura interna (solo trigger e funzioni del database) ----------
create or replace function public.activity_log_write(
  p_evento text, p_categoria text, p_azione text, p_dettagli text, p_user uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_name text;
begin
  if p_user is null then
    return;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  select nullif(btrim(pr.full_name), '') into v_name from public.profiles pr where pr.id = p_user;
  insert into public.activity_log (user_id, user_email, user_name, evento, categoria, azione, dettagli)
  values (p_user, v_email, v_name, p_evento, p_categoria, left(p_azione, 200), nullif(left(p_dettagli, 300), ''));
end;
$$;
revoke all on function public.activity_log_write(text, text, text, text, uuid) from public, anon, authenticated;

-- ---------- Accessi: chiamata dall'app ----------
create or replace function public.log_accesso(p_evento text, p_azione text, p_dettagli text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_azione text;
begin
  if v_uid is null then
    return;
  end if;
  if p_evento not in ('accesso', 'uscita') then
    raise exception 'Evento non valido';
  end if;
  v_azione := left(coalesce(nullif(btrim(p_azione), ''), case p_evento when 'accesso' then 'Accesso' else 'Uscita' end), 120);
  -- stessa voce ripetuta entro pochi secondi (doppio tocco, ricarica): si registra una volta sola
  if exists (
    select 1 from public.activity_log l
    where l.user_id = v_uid and l.evento = p_evento and l.azione = v_azione
      and l.created_at > now() - interval '15 seconds'
  ) then
    return;
  end if;
  perform public.activity_log_write(p_evento, 'Accessi', v_azione, left(p_dettagli, 200), v_uid);
end;
$$;
revoke all on function public.log_accesso(text, text, text) from public, anon;
grant execute on function public.log_accesso(text, text, text) to authenticated;

-- ---------- Azioni: trigger per riga ----------
create or replace function public.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_cat text;
  v_az text;
  v_det text;
  v_code text;
  v_mac text;
begin
  if v_actor is null then
    return null; -- operazione di sistema, senza utente
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row := v_old;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
  else
    v_new := to_jsonb(new);
    v_row := v_new;
  end if;

  if tg_table_name = 'transactions' then
    v_cat := 'Movimenti';
    select p.codice_articolo into v_code from public.products p where p.id = (v_row->>'product_id')::uuid;
    v_az := case tg_op when 'UPDATE' then 'Modificato movimento: ' when 'DELETE' then 'Eliminato movimento: ' else '' end
      || initcap(v_row->>'tipo') || ' ' || (v_row->>'quantita') || ' × ' || coalesce(v_code, '(articolo eliminato)');
    v_det := concat_ws(' · ',
      'Linea ' || nullif(v_row->>'linea', ''),
      nullif(v_row->>'macchinario', ''),
      nullif(v_row->>'punto_utilizzo_specifico', ''),
      'Scaffale ' || nullif(v_row->>'locazione', ''),
      nullif(v_row->>'note', ''));

  elsif tg_table_name = 'prestiti' then
    v_cat := 'Movimenti';
    if tg_op = 'INSERT' then
      v_az := 'Prestito ' || (v_row->>'quantita') || ' × ' || (v_row->>'codice_articolo');
      v_det := concat_ws(' · ', 'A ' || nullif(v_row->>'destinatario', ''), 'Scaffale ' || nullif(v_row->>'locazione', ''));
    elsif tg_op = 'UPDATE' then
      if (v_old->>'reintegrato_at') is null and (v_new->>'reintegrato_at') is not null then
        v_az := 'Reintegrato prestito ' || (v_row->>'quantita') || ' × ' || (v_row->>'codice_articolo');
        v_det := 'Da ' || nullif(v_row->>'destinatario', '');
      end if;
    else
      v_az := 'Eliminato prestito ' || (v_row->>'quantita') || ' × ' || (v_row->>'codice_articolo');
      v_det := 'A ' || nullif(v_row->>'destinatario', '');
    end if;

  elsif tg_table_name = 'manutenzioni_soste' then
    v_cat := 'Interventi';
    v_det := concat_ws(' · ', nullif(v_row->>'linea', ''), nullif(v_row->>'macchina', ''), left(nullif(v_row->>'descrizione', ''), 120));
    if tg_op = 'INSERT' then
      v_az := 'Nuovo intervento';
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminato intervento';
    elsif (v_new - 'updated_at') is distinct from (v_old - 'updated_at') then
      if (v_new->>'stato') is distinct from (v_old->>'stato') then
        v_az := 'Intervento ' || case v_new->>'stato'
          when 'effettuato' then 'effettuato'
          when 'da_effettuare' then 'riaperto (da effettuare)'
          when 'sospeso' then 'sospeso'
          else replace(coalesce(v_new->>'stato', ''), '_', ' ') end;
      else
        v_az := 'Modificato intervento';
      end if;
    end if;

  elsif tg_table_name = 'inventari' then
    v_cat := 'Inventario';
    if tg_op = 'INSERT' then
      v_az := 'Inventario scaffale ' || (v_row->>'locazione');
      v_det := concat_ws(' · ',
        case when (v_row->>'ciechi') = 'true' then 'Conteggio cieco' end,
        nullif(v_row->>'motivo', ''));
    end if;

  elsif tg_table_name = 'machines' then
    v_cat := 'Impostazioni';
    if tg_op = 'INSERT' then
      v_az := 'Aggiunta macchina: ' || (v_row->>'nome');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminata macchina: ' || (v_row->>'nome');
    elsif (v_new->>'nome') is distinct from (v_old->>'nome') or (v_new->'linee') is distinct from (v_old->'linee') then
      v_az := 'Modificata macchina: ' || (v_new->>'nome');
      if (v_new->>'nome') is distinct from (v_old->>'nome') then
        v_det := 'Era: ' || (v_old->>'nome');
      end if;
    end if;

  elsif tg_table_name = 'shelves' then
    v_cat := 'Impostazioni';
    if tg_op = 'INSERT' then
      v_az := 'Aggiunto scaffale: ' || (v_row->>'nome');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminato scaffale: ' || (v_row->>'nome');
    elsif (v_new->>'nome') is distinct from (v_old->>'nome') then
      v_az := 'Rinominato scaffale: ' || (v_old->>'nome') || ' → ' || (v_new->>'nome');
    end if;

  elsif tg_table_name = 'interventi_rapidi' then
    v_cat := 'Impostazioni';
    if tg_op = 'INSERT' then
      v_az := 'Aggiunto intervento rapido: ' || (v_row->>'titolo');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminato intervento rapido: ' || (v_row->>'titolo');
    end if;
    v_det := concat_ws(' · ', nullif(v_row->>'linea', ''), nullif(v_row->>'macchina', ''));

  elsif tg_table_name = 'interventi_operatori' then
    v_cat := 'Impostazioni';
    if tg_op = 'INSERT' then
      v_az := 'Aggiunto operatore: ' || (v_row->>'nome');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminato operatore: ' || (v_row->>'nome');
    end if;

  elsif tg_table_name in ('machine_manuals', 'machine_operator_manuals') then
    v_cat := 'Manuali';
    select m.nome into v_mac from public.machines m where m.id = (v_row->>'machine_id')::uuid;
    v_det := concat_ws(' · ', v_mac, nullif(v_row->>'linea', ''));
    if tg_op = 'INSERT' then
      v_az := case tg_table_name when 'machine_manuals' then 'Caricato manuale ricambi: ' else 'Caricato manuale operatore: ' end || (v_row->>'file_name');
    elsif tg_op = 'DELETE' then
      v_az := case tg_table_name when 'machine_manuals' then 'Eliminato manuale ricambi: ' else 'Eliminato manuale operatore: ' end || (v_row->>'file_name');
    end if;

  elsif tg_table_name = 'machine_manual_sections' then
    v_cat := 'Manuali';
    select m.nome into v_det from public.machines m where m.id = (v_row->>'machine_id')::uuid;
    if tg_op = 'INSERT' then
      v_az := 'Aggiunta sezione manuale: ' || (v_row->>'label');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminata sezione manuale: ' || (v_row->>'label');
    elsif (v_new->>'label') is distinct from (v_old->>'label') then
      v_az := 'Rinominata sezione manuale: ' || (v_old->>'label') || ' → ' || (v_new->>'label');
    end if;

  elsif tg_table_name = 'machine_manual_groups' then
    v_cat := 'Manuali';
    select m.nome into v_det from public.machines m where m.id = (v_row->>'machine_id')::uuid;
    if tg_op = 'INSERT' then
      v_az := 'Aggiunto gruppo manuale: ' || (v_row->>'name');
    elsif tg_op = 'DELETE' then
      v_az := 'Eliminato gruppo manuale: ' || (v_row->>'name');
    elsif (v_new->>'name') is distinct from (v_old->>'name') then
      v_az := 'Rinominato gruppo manuale: ' || (v_old->>'name') || ' → ' || (v_new->>'name');
    end if;

  elsif tg_table_name = 'shelf_photos' then
    v_cat := 'Impostazioni';
    v_az := case tg_op when 'DELETE' then 'Eliminata foto scaffale: ' else 'Foto scaffale aggiornata: ' end || (v_row->>'locazione');

  elsif tg_table_name = 'profiles' then
    v_cat := 'Utenti';
    if tg_op = 'UPDATE' then
      v_det := concat_ws(' · ',
        case when (v_new->>'full_name') is distinct from (v_old->>'full_name')
          then 'nome: ' || coalesce(nullif(v_old->>'full_name', ''), '—') || ' → ' || coalesce(nullif(v_new->>'full_name', ''), '—') end,
        case when (v_new->>'role') is distinct from (v_old->>'role')
          then 'ruolo: ' || case v_old->>'role' when 'admin' then 'Admin' else 'Operatore' end
            || ' → ' || case v_new->>'role' when 'admin' then 'Admin' else 'Operatore' end end);
      if v_det is not null and v_det <> '' then
        v_az := 'Modificato utente ' || coalesce(v_new->>'email', '');
      end if;
    end if;
  end if;

  if v_az is null then
    return null;
  end if;
  perform public.activity_log_write('azione', v_cat, v_az, v_det, v_actor);
  return null;
end;
$$;
revoke all on function public.log_row_change() from public, anon, authenticated;

-- ---------- Azioni: trigger per istruzione (articoli e cancellazione movimenti) ----------
-- Un caricamento Excel o una cancellazione di massa scrive UNA riga ("Caricati 120 articoli"), non una per articolo.
-- Le variazioni di sola giacenza/scaffale (prelievi, depositi, inventari) non contano come "modifica articolo".
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
      where (to_jsonb(n) - 'quantita_disponibile' - 'locazione' - 'updated_at')
        is distinct from (to_jsonb(o) - 'quantita_disponibile' - 'locazione' - 'updated_at');
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
          where k.key not in ('quantita_disponibile', 'locazione', 'updated_at')
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
revoke all on function public.log_statement_change() from public, anon, authenticated;

-- ---------- Collegamento ai trigger ----------
-- Per riga
drop trigger if exists activity_log_row on public.transactions;
create trigger activity_log_row after insert or update on public.transactions
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.prestiti;
create trigger activity_log_row after insert or update or delete on public.prestiti
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.manutenzioni_soste;
create trigger activity_log_row after insert or update or delete on public.manutenzioni_soste
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.inventari;
create trigger activity_log_row after insert on public.inventari
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.machines;
create trigger activity_log_row after insert or update or delete on public.machines
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.shelves;
create trigger activity_log_row after insert or update or delete on public.shelves
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.interventi_rapidi;
create trigger activity_log_row after insert or delete on public.interventi_rapidi
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.interventi_operatori;
create trigger activity_log_row after insert or delete on public.interventi_operatori
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.machine_manuals;
create trigger activity_log_row after insert or delete on public.machine_manuals
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.machine_operator_manuals;
create trigger activity_log_row after insert or delete on public.machine_operator_manuals
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.machine_manual_sections;
create trigger activity_log_row after insert or update or delete on public.machine_manual_sections
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.machine_manual_groups;
create trigger activity_log_row after insert or update or delete on public.machine_manual_groups
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.shelf_photos;
create trigger activity_log_row after insert or update or delete on public.shelf_photos
  for each row execute function public.log_row_change();

drop trigger if exists activity_log_row on public.profiles;
create trigger activity_log_row after update on public.profiles
  for each row execute function public.log_row_change();

-- Per istruzione (con tabelle di transizione)
drop trigger if exists activity_log_stmt_ins on public.products;
create trigger activity_log_stmt_ins after insert on public.products
  referencing new table as nuovi
  for each statement execute function public.log_statement_change();

drop trigger if exists activity_log_stmt_upd on public.products;
create trigger activity_log_stmt_upd after update on public.products
  referencing old table as vecchi new table as nuovi
  for each statement execute function public.log_statement_change();

drop trigger if exists activity_log_stmt_del on public.products;
create trigger activity_log_stmt_del after delete on public.products
  referencing old table as vecchi
  for each statement execute function public.log_statement_change();

drop trigger if exists activity_log_stmt_del on public.transactions;
create trigger activity_log_stmt_del after delete on public.transactions
  referencing old table as vecchi
  for each statement execute function public.log_statement_change();
