-- Prestiti: lettura e reintegro riservati agli admin (la registrazione di un prestito dal Prelievo resta per tutti)
drop policy if exists prestiti_select on public.prestiti;
create policy prestiti_select_admin on public.prestiti as permissive for select to authenticated
  using (current_user_role() = 'admin'::user_role);

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
  if public.current_user_role() <> 'admin'::user_role then raise exception 'Solo l''amministratore può gestire i prestiti'; end if;
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
