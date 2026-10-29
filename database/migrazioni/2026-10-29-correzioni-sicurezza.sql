-- Correzioni di sicurezza da penetration test del 29 ottobre 2026.
-- Eseguita sul database di produzione lo stesso giorno (conservata qui come riferimento: non rieseguirla).
--
-- PROBLEMA 1 (grave): un utente comune poteva assegnarsi da solo il ruolo Admin, modificando la propria riga
-- in "profiles" (riga consentita dalla regola di sicurezza, che però non impediva di cambiare il campo "role").
-- Ora il ruolo si può cambiare solo da un Admin: un trigger lo impone, qualunque cosa dica l'app.
--
-- PROBLEMA 2 (grave): chiunque poteva modificare QUALSIASI campo di un intervento altrui (anche chi risulta
-- averlo inserito), e usando questo per appropriarsene poteva poi anche cancellarlo, cosa che la regola di
-- cancellazione vieta esplicitamente a chi non ne è l'autore. Ora un trigger impone che, su un intervento
-- inserito da un altro utente, si possa aggiornare solo lo stato/esito (il lavoro di squadra resta possibile:
-- chiunque può segnare "effettuato" l'intervento di un collega), ma non autore, descrizione, linea o macchina.
-- Questo chiude anche la via per appropriarsi di un intervento altrui e quindi cancellarlo.

-- ---------- Problema 1: ruolo utente ----------
create or replace function public.profiles_block_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and public.current_user_role() <> 'admin' then
    raise exception 'Solo un Admin può cambiare il ruolo di un utente';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_block_role_change() from public, anon, authenticated;

drop trigger if exists profiles_block_role_change on public.profiles;
create trigger profiles_block_role_change before update on public.profiles
  for each row execute function public.profiles_block_role_change();

-- ---------- Problema 2: modifica interventi altrui ----------
-- La regola di sicurezza (RLS) per l'update resta "true": a decidere nel dettaglio cosa si può cambiare,
-- riga per riga e campo per campo, è il trigger qui sotto (prima regola troppo larga: "true" per chiunque).
create or replace function public.manutenzioni_block_altrui_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- OLD.created_by, non NEW: altrimenti basterebbe includere "created_by = sé stessi" nello
  -- stesso UPDATE per farsi passare l'intervento come proprio e aggirare il controllo.
  if old.created_by = auth.uid() or public.current_user_role() = 'admin' then
    return new; -- il proprio intervento, o un Admin: nessun limite
  end if;
  if new.created_by is distinct from old.created_by
    or new.created_by_name is distinct from old.created_by_name
    or new.descrizione is distinct from old.descrizione
    or new.linea is distinct from old.linea
    or new.macchina is distinct from old.macchina then
    raise exception 'Puoi solo aggiornare lo stato/esito di un intervento inserito da un altro utente';
  end if;
  return new;
end;
$$;
revoke all on function public.manutenzioni_block_altrui_fields() from public, anon, authenticated;

drop trigger if exists manutenzioni_block_altrui_fields on public.manutenzioni_soste;
create trigger manutenzioni_block_altrui_fields before update on public.manutenzioni_soste
  for each row execute function public.manutenzioni_block_altrui_fields();
