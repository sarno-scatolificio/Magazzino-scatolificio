-- Gestione cronologia movimenti: l'Admin può correggere i movimenti già registrati (articolo, tipo, quantità,
-- data e ora, operatore, punto di utilizzo, linea, macchinario, scaffale, note), non solo eliminarli.
-- Da eseguire nel SQL Editor di Supabase (una volta sola). Prima la tabella permetteva solo SELECT e DELETE.
-- La modifica agisce solo sul registro dei movimenti: la giacenza degli articoli NON viene ricalcolata
-- (come già succede quando si elimina un movimento).
drop policy if exists transactions_update_admin on public.transactions;
create policy transactions_update_admin on public.transactions as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
