-- =============================================================
-- 05-storage.sql — Cartelle di archiviazione (bucket) e relative policy
-- =============================================================
-- Fotografia del 15 ottobre 2026 (vedi 01-struttura.sql per le avvertenze).
-- I file veri (PDF dei manuali, foto degli interventi, icone) NON sono in
-- questo repository: stanno nello storage di Supabase e vanno copiati a
-- parte quando si trasferisce il progetto (vedi docs/CONSEGNA.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('interventi-foto',       'interventi-foto',       false, null,       null),
  ('manuali-macchine',      'manuali-macchine',      false, 104857600,  '{application/pdf}'),
  ('manuali-operatore',     'manuali-operatore',     false, 104857600,  '{application/pdf}'),
  ('manuali-sezioni-icone', 'manuali-sezioni-icone', true,  5242880,    '{image/png,image/jpeg,image/webp,image/svg+xml}'),
  ('manuali-temp',          'manuali-temp',          false, 52428800,   '{application/pdf}');

-- Foto degli interventi: tutti gli utenti autenticati
create policy interventi_foto_delete on storage.objects as permissive for delete to authenticated
  using ((bucket_id = 'interventi-foto'::text));
create policy interventi_foto_insert on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'interventi-foto'::text));
create policy interventi_foto_select on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'interventi-foto'::text));

-- Manuali delle macchine: lettura a tutti gli autenticati, scrittura solo Admin
create policy manuali_macchine_delete_admin on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'manuali-macchine'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_macchine_insert_admin on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'manuali-macchine'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_macchine_select_authenticated on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'manuali-macchine'::text));
create policy manuali_macchine_update_admin on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'manuali-macchine'::text) AND (current_user_role() = 'admin'::user_role)))
  with check (((bucket_id = 'manuali-macchine'::text) AND (current_user_role() = 'admin'::user_role)));

-- Manuali operatore: stessa regola
create policy manuali_operatore_delete_admin on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'manuali-operatore'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_operatore_insert_admin on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'manuali-operatore'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_operatore_select_authenticated on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'manuali-operatore'::text));
create policy manuali_operatore_update_admin on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'manuali-operatore'::text) AND (current_user_role() = 'admin'::user_role)))
  with check (((bucket_id = 'manuali-operatore'::text) AND (current_user_role() = 'admin'::user_role)));

-- Icone delle sezioni dei manuali: bucket PUBBLICO (leggibili anche senza accesso), scrittura solo Admin
create policy manuali_sezioni_icone_delete_admin on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'manuali-sezioni-icone'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_sezioni_icone_insert_admin on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'manuali-sezioni-icone'::text) AND (current_user_role() = 'admin'::user_role)));
create policy manuali_sezioni_icone_select_public on storage.objects as permissive for select to anon, authenticated
  using ((bucket_id = 'manuali-sezioni-icone'::text));
create policy manuali_sezioni_icone_update_admin on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'manuali-sezioni-icone'::text) AND (current_user_role() = 'admin'::user_role)))
  with check (((bucket_id = 'manuali-sezioni-icone'::text) AND (current_user_role() = 'admin'::user_role)));

-- Area temporanea dei manuali: ognuno vede e usa solo la propria cartella (nome = id utente)
create policy manuali_temp_delete_own on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'manuali-temp'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy manuali_temp_insert_own on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'manuali-temp'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy manuali_temp_select_own on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'manuali-temp'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
