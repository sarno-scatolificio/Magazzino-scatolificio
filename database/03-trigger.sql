-- =============================================================
-- 03-trigger.sql — Trigger sulle tabelle e sulla tabella utenti di Supabase
-- =============================================================
-- Fotografia del 15 ottobre 2026 (vedi 01-struttura.sql per le avvertenze).

-- Quando Supabase crea un utente (auth.users) nasce da solo il suo profilo con ruolo 'user'.
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger products_check_barcode_not_extra before insert or update of codice_barre on public.products
  for each row execute function public.products_check_barcode_not_extra();
create trigger products_create_initial_location after insert on public.products
  for each row execute function public.products_create_initial_location();
create trigger products_guard_stock_columns before update on public.products
  for each row execute function public.products_guard_stock_columns();

create trigger product_barcodes_check_unique before insert or update of codice_barre on public.product_barcodes
  for each row execute function public.product_barcodes_check_unique();

create trigger product_locations_set_updated_at before update on public.product_locations
  for each row execute function public.set_updated_at();
create trigger product_locations_sync_product after insert or delete or update on public.product_locations
  for each row execute function public.sync_product_from_locations();

create trigger manutenzioni_soste_touch before update on public.manutenzioni_soste
  for each row execute function public.manutenzioni_soste_touch();

-- Trigger di evento: ogni nuova tabella in public nasce con la sicurezza a livello di riga (RLS) già attiva.
-- (negli altri progetti Supabase esiste di serie; qui è elencato perché l'app ne dipende)
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
