-- Foto degli scaffali e posizione degli articoli sulla foto.
-- Da eseguire una volta nel SQL Editor di Supabase. Lettura a tutti gli utenti autenticati, scrittura solo Admin.
-- La foto (già ritagliata e compressa dall'app) sta nello storage; qui si tiene solo il riferimento.

-- Una foto per scaffale. La chiave è il nome dello scaffale normalizzato (spazi ridotti, minuscolo), come in `shelves`.
create table if not exists public.shelf_photos (
  locazione_key text primary key,
  locazione text not null,
  storage_path text not null,
  width integer,
  height integer,
  size_bytes integer,
  updated_at timestamptz not null default now()
);

-- Posizione dell'articolo sulla foto di uno scaffale: x e y in frazione (0 = bordo sinistro/alto, 1 = destro/basso),
-- così restano valide qualunque sia la dimensione con cui la foto viene mostrata.
-- Tabella a parte (non dentro product_locations) perché set_product_locations riscrive le righe degli scaffali.
create table if not exists public.product_shelf_positions (
  product_id uuid not null references public.products(id) on delete cascade,
  locazione_key text not null,
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  updated_at timestamptz not null default now(),
  primary key (product_id, locazione_key)
);

alter table public.shelf_photos enable row level security;
alter table public.product_shelf_positions enable row level security;

drop policy if exists shelf_photos_select on public.shelf_photos;
create policy shelf_photos_select on public.shelf_photos as permissive for select to authenticated using (true);
drop policy if exists shelf_photos_insert_admin on public.shelf_photos;
create policy shelf_photos_insert_admin on public.shelf_photos as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
drop policy if exists shelf_photos_update_admin on public.shelf_photos;
create policy shelf_photos_update_admin on public.shelf_photos as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role)) with check ((current_user_role() = 'admin'::user_role));
drop policy if exists shelf_photos_delete_admin on public.shelf_photos;
create policy shelf_photos_delete_admin on public.shelf_photos as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));

drop policy if exists product_shelf_positions_select on public.product_shelf_positions;
create policy product_shelf_positions_select on public.product_shelf_positions as permissive for select to authenticated using (true);
drop policy if exists product_shelf_positions_insert_admin on public.product_shelf_positions;
create policy product_shelf_positions_insert_admin on public.product_shelf_positions as permissive for insert to authenticated
  with check ((current_user_role() = 'admin'::user_role));
drop policy if exists product_shelf_positions_update_admin on public.product_shelf_positions;
create policy product_shelf_positions_update_admin on public.product_shelf_positions as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role)) with check ((current_user_role() = 'admin'::user_role));
drop policy if exists product_shelf_positions_delete_admin on public.product_shelf_positions;
create policy product_shelf_positions_delete_admin on public.product_shelf_positions as permissive for delete to authenticated
  using ((current_user_role() = 'admin'::user_role));

-- Cartella privata per le foto (le foto si leggono con link temporanei, solo da utenti autenticati)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('scaffali-foto', 'scaffali-foto', false, 3145728, '{image/jpeg,image/webp}')
on conflict (id) do nothing;

drop policy if exists scaffali_foto_select_authenticated on storage.objects;
create policy scaffali_foto_select_authenticated on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'scaffali-foto'::text));
drop policy if exists scaffali_foto_insert_admin on storage.objects;
create policy scaffali_foto_insert_admin on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'scaffali-foto'::text) AND (current_user_role() = 'admin'::user_role)));
drop policy if exists scaffali_foto_update_admin on storage.objects;
create policy scaffali_foto_update_admin on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'scaffali-foto'::text) AND (current_user_role() = 'admin'::user_role)))
  with check (((bucket_id = 'scaffali-foto'::text) AND (current_user_role() = 'admin'::user_role)));
drop policy if exists scaffali_foto_delete_admin on storage.objects;
create policy scaffali_foto_delete_admin on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'scaffali-foto'::text) AND (current_user_role() = 'admin'::user_role)));
