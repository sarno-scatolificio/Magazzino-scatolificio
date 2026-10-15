-- =============================================================
-- 04-sicurezza-rls.sql — Sicurezza a livello di riga (RLS), permessi sulle funzioni
-- =============================================================
-- Fotografia del 15 ottobre 2026 (vedi 01-struttura.sql per le avvertenze).
-- Regola di fondo: l'app è usata solo da utenti autenticati; i permessi
-- sono applicati dal database, non solo dall'interfaccia.
--   * admin   = current_user_role() restituisce 'admin'
--   * utente  = ruolo 'user' (Operatore)

-- ---------- RLS attiva su tutte le tabelle ----------
alter table public.interventi_operatori enable row level security;
alter table public.interventi_rapidi enable row level security;
alter table public.inventari enable row level security;
alter table public.inventario_righe enable row level security;
alter table public.machine_manual_groups enable row level security;
alter table public.machine_manual_sections enable row level security;
alter table public.machine_manuals enable row level security;
alter table public.machine_operator_manuals enable row level security;
alter table public.machines enable row level security;
alter table public.manutenzioni_soste enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.product_locations enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.shelves enable row level security;
alter table public.transactions enable row level security;

-- ---------- Permessi di esecuzione sulle funzioni ----------
-- Funzioni chiamabili dagli utenti autenticati (mai da anon):
revoke execute on function public.admin_display_names() from public, anon;
revoke execute on function public.bulk_upsert_products(public.product_category, jsonb) from public, anon;
revoke execute on function public.chiudi_inventario(text, boolean, text, timestamptz, jsonb) from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.get_product_by_barcode(text) from public, anon;
revoke execute on function public.is_admin_user(uuid) from public, anon;
revoke execute on function public.process_transaction(uuid, public.transaction_type, integer, text, text, text, text, uuid) from public, anon;
revoke execute on function public.punti_utilizzo_cuscinetto(uuid, text, text) from public, anon;
revoke execute on function public.remove_shelf_assignments(text) from public, anon;
revoke execute on function public.set_product_barcodes(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.set_product_locations(uuid, jsonb) from public, anon;
grant execute on function public.admin_display_names() to authenticated;
grant execute on function public.bulk_upsert_products(public.product_category, jsonb) to authenticated;
grant execute on function public.chiudi_inventario(text, boolean, text, timestamptz, jsonb) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.get_product_by_barcode(text) to authenticated;
grant execute on function public.is_admin_user(uuid) to authenticated;
grant execute on function public.process_transaction(uuid, public.transaction_type, integer, text, text, text, text, uuid) to authenticated;
grant execute on function public.punti_utilizzo_cuscinetto(uuid, text, text) to authenticated;
grant execute on function public.remove_shelf_assignments(text) to authenticated;
grant execute on function public.set_product_barcodes(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_product_locations(uuid, jsonb) to authenticated;
-- Funzioni dei trigger: non richiamabili dall'esterno
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.products_create_initial_location() from public, anon, authenticated;
revoke execute on function public.products_guard_stock_columns() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.sync_product_from_locations() from public, anon, authenticated;

-- ---------- Policy: interventi ----------
create policy operatori_admin_write on public.interventi_operatori as permissive for all to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy operatori_select on public.interventi_operatori as permissive for select to authenticated
  using (true);
create policy rapidi_admin_write on public.interventi_rapidi as permissive for all to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy rapidi_select on public.interventi_rapidi as permissive for select to authenticated
  using (true);
create policy manutenzioni_delete on public.manutenzioni_soste as permissive for delete to authenticated
  using (((created_by = auth.uid()) OR (current_user_role() = 'admin'::user_role)));
create policy manutenzioni_insert on public.manutenzioni_soste as permissive for insert to authenticated
  with check ((created_by = auth.uid()));
create policy manutenzioni_select on public.manutenzioni_soste as permissive for select to authenticated
  using (true);
create policy manutenzioni_update on public.manutenzioni_soste as permissive for update to authenticated
  using (true)
  with check (true);

-- ---------- Policy: inventari (solo Admin) ----------
create policy inventari_delete_admin on public.inventari as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy inventari_select_admin on public.inventari as permissive for select to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy inventario_righe_select_admin on public.inventario_righe as permissive for select to authenticated
  using ((current_user_role() = 'admin'::user_role));

-- ---------- Policy: manuali delle macchine ----------
create policy machine_manual_groups_delete_admin on public.machine_manual_groups as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy machine_manual_groups_insert_admin on public.machine_manual_groups as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_manual_groups_select_authenticated on public.machine_manual_groups as permissive for select to authenticated
  using (true);
create policy machine_manual_groups_update_admin on public.machine_manual_groups as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_manual_sections_delete_admin on public.machine_manual_sections as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy machine_manual_sections_insert_admin on public.machine_manual_sections as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_manual_sections_select_authenticated on public.machine_manual_sections as permissive for select to authenticated
  using (true);
create policy machine_manual_sections_update_admin on public.machine_manual_sections as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_manuals_delete_admin on public.machine_manuals as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy machine_manuals_insert_admin on public.machine_manuals as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_manuals_select_authenticated on public.machine_manuals as permissive for select to authenticated
  using (true);
create policy machine_manuals_update_admin on public.machine_manuals as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_operator_manuals_delete_admin on public.machine_operator_manuals as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy machine_operator_manuals_insert_admin on public.machine_operator_manuals as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy machine_operator_manuals_select_authenticated on public.machine_operator_manuals as permissive for select to authenticated
  using (true);
create policy machine_operator_manuals_update_admin on public.machine_operator_manuals as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));

-- ---------- Policy: macchine e scaffali ----------
create policy machines_delete_admin on public.machines as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy machines_insert_admin on public.machines as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy machines_select_authenticated on public.machines as permissive for select to authenticated
  using (true);
create policy machines_update_admin on public.machines as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy shelves_delete_admin on public.shelves as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy shelves_insert_admin on public.shelves as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy shelves_select_authenticated on public.shelves as permissive for select to authenticated
  using (true);

-- ---------- Policy: articoli ----------
create policy product_barcodes_delete_admin on public.product_barcodes as permissive for delete to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy product_barcodes_insert_admin on public.product_barcodes as permissive for insert to authenticated
  with check ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy product_barcodes_select_authenticated on public.product_barcodes as permissive for select to authenticated
  using (true);
create policy product_barcodes_update_admin on public.product_barcodes as permissive for update to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role))
  with check ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy product_locations_delete_admin on public.product_locations as permissive for delete to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy product_locations_insert_admin on public.product_locations as permissive for insert to authenticated
  with check ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy product_locations_select_authenticated on public.product_locations as permissive for select to authenticated
  using (true);
create policy product_locations_update_admin on public.product_locations as permissive for update to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role))
  with check ((( SELECT current_user_role() AS current_user_role) = 'admin'::user_role));
create policy products_delete_admin on public.products as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy products_insert_admin on public.products as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy products_select_authenticated on public.products as permissive for select to authenticated
  using (true);
create policy products_update_admin on public.products as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));

-- ---------- Policy: utenti e movimenti ----------
create policy profiles_insert_admin on public.profiles as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
create policy profiles_select_own_or_admin on public.profiles as permissive for select to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR (current_user_role() = 'admin'::user_role)));
create policy profiles_update_own_or_admin on public.profiles as permissive for update to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR (current_user_role() = 'admin'::user_role)))
  with check (((id = ( SELECT auth.uid() AS uid)) OR (current_user_role() = 'admin'::user_role)));
-- I movimenti si scrivono solo tramite la funzione process_transaction (nessuna policy di INSERT diretta).
create policy transactions_delete_admin on public.transactions as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy transactions_select_own_admin_or_by_admin on public.transactions as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (current_user_role() = 'admin'::user_role) OR is_admin_user(user_id)));
