-- =============================================================
-- 01-struttura.sql — Tipi, tabelle, vincoli, indici e vista
-- =============================================================
-- FOTOGRAFIA DI RIFERIMENTO del database di produzione (progetto Supabase
-- dell'app), ricostruita leggendo direttamente il catalogo di Postgres il
-- 15 ottobre 2026. NON è la sequenza storica delle migrazioni: descrive
-- com'è fatto il database oggi. Serve a capire/ricreare la struttura.
--
-- Ordine di esecuzione su un database nuovo e vuoto:
--   01-struttura.sql -> 02-funzioni.sql -> 03-trigger.sql
--   -> 04-sicurezza-rls.sql -> 05-storage.sql
-- Prima va creato il progetto Supabase (le tabelle auth.* e storage.*
-- esistono già) e attivate le estensioni: pgcrypto, uuid-ossp.
-- Non eseguire mai questi file sul database di produzione: esiste già.

-- ---------- Tipi enumerati ----------
create type public.product_category as enum ('cuscinetti', 'cinghie', 'pezzi_ricambio');
create type public.transaction_type as enum ('deposito', 'prelievo');
create type public.user_role as enum ('admin', 'user');

-- ---------- Tabelle ----------
create table public.profiles (
  id uuid not null,
  full_name text,
  role public.user_role not null default 'user'::user_role,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  email text not null
);

create table public.machines (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  icon_storage_path text,
  sort_order integer,
  linee text[] not null default ARRAY['L1'::text, 'L2'::text]
);

create table public.shelves (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  area text not null default 'Magazzino'::text
);

create table public.products (
  id uuid not null default gen_random_uuid(),
  codice_articolo text not null,
  punto_utilizzo_standard text,
  locazione text,
  quantita_disponibile integer not null default 0,
  scorta_minima integer not null default 0,
  codice_barre text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid,
  categoria public.product_category not null default 'pezzi_ricambio'::product_category,
  linea text,
  macchina text,
  produttore_barcode text,
  descrizione text
);

create table public.product_barcodes (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  codice_barre text not null,
  produttore text,
  ordine integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table public.product_locations (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  locazione text,
  quantita integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.transactions (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  user_id uuid not null,
  tipo public.transaction_type not null,
  quantita integer not null,
  data_ora timestamp with time zone not null default now(),
  punto_utilizzo_specifico text,
  note text,
  linea text,
  macchinario text,
  locazione text
);

create table public.inventari (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  iniziato_at timestamp with time zone,
  locazione text not null,
  ciechi boolean not null default false,
  motivo text,
  user_id uuid not null default auth.uid(),
  user_name text,
  articoli_totali integer not null default 0,
  con_differenza integer not null default 0
);

create table public.inventario_righe (
  id uuid not null default gen_random_uuid(),
  inventario_id uuid not null,
  product_id uuid,
  codice_articolo text not null,
  categoria text,
  descrizione text,
  atteso integer not null default 0,
  contato integer not null,
  differenza integer not null,
  tipo text not null
);

create table public.machine_manuals (
  id uuid not null default gen_random_uuid(),
  machine_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamp with time zone not null default now(),
  linea text not null default ''::text
);

create table public.machine_operator_manuals (
  id uuid not null default gen_random_uuid(),
  machine_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamp with time zone not null default now()
);

create table public.machine_manual_groups (
  id uuid not null default gen_random_uuid(),
  machine_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table public.machine_manual_sections (
  id uuid not null default gen_random_uuid(),
  machine_id uuid not null,
  operator_manual_id uuid not null,
  label text not null,
  icon_storage_path text,
  page_start integer,
  page_end integer,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  group_id uuid
);

create table public.manutenzioni_soste (
  id uuid not null default gen_random_uuid(),
  linea text not null,
  macchina text not null,
  descrizione text not null,
  stato text not null default 'da_effettuare'::text,
  foto_promemoria_path text,
  note_esito text,
  foto_esito_path text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamp with time zone not null default now(),
  esito_by uuid,
  esito_by_name text,
  esito_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  operatore_nome text,
  operatori text[] not null default '{}'::text[],
  ricambi jsonb not null default '[]'::jsonb,
  ricambi_mancanti boolean not null default false
);

create table public.interventi_operatori (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  created_at timestamp with time zone not null default now()
);

create table public.interventi_rapidi (
  id uuid not null default gen_random_uuid(),
  linea text not null,
  macchina text not null,
  titolo text not null,
  created_at timestamp with time zone not null default now()
);

-- ---------- Vincoli: chiavi primarie e univoci ----------
alter table public.interventi_operatori add constraint interventi_operatori_pkey primary key (id);
alter table public.interventi_rapidi add constraint interventi_rapidi_pkey primary key (id);
alter table public.interventi_rapidi add constraint interventi_rapidi_linea_macchina_titolo_key unique (linea, macchina, titolo);
alter table public.inventari add constraint inventari_pkey primary key (id);
alter table public.inventario_righe add constraint inventario_righe_pkey primary key (id);
alter table public.machine_manual_groups add constraint machine_manual_groups_pkey primary key (id);
alter table public.machine_manual_sections add constraint machine_manual_sections_pkey primary key (id);
alter table public.machine_manuals add constraint machine_manuals_pkey primary key (id);
alter table public.machine_manuals add constraint machine_manuals_one_per_machine_linea unique (machine_id, linea);
alter table public.machine_manuals add constraint machine_manuals_storage_path_key unique (storage_path);
alter table public.machine_operator_manuals add constraint machine_operator_manuals_pkey primary key (id);
alter table public.machine_operator_manuals add constraint machine_operator_manuals_storage_path_key unique (storage_path);
alter table public.machines add constraint machines_pkey primary key (id);
alter table public.manutenzioni_soste add constraint manutenzioni_soste_pkey primary key (id);
alter table public.product_barcodes add constraint product_barcodes_pkey primary key (id);
alter table public.product_locations add constraint product_locations_pkey primary key (id);
alter table public.products add constraint products_pkey primary key (id);
alter table public.products add constraint products_categoria_codice_key unique (categoria, codice_articolo);
alter table public.products add constraint products_codice_barre_key unique (codice_barre);
alter table public.profiles add constraint profiles_pkey primary key (id);
alter table public.shelves add constraint shelves_pkey primary key (id);
alter table public.transactions add constraint transactions_pkey primary key (id);

-- ---------- Vincoli: controlli sui valori ----------
alter table public.interventi_operatori add constraint interventi_operatori_nome_check check ((char_length(btrim(nome)) > 0));
alter table public.interventi_rapidi add constraint interventi_rapidi_linea_check check ((linea = ANY (ARRAY['L1'::text, 'L2'::text, 'L1-L2'::text])));
alter table public.interventi_rapidi add constraint interventi_rapidi_macchina_check check ((char_length(btrim(macchina)) > 0));
alter table public.interventi_rapidi add constraint interventi_rapidi_titolo_check check ((char_length(btrim(titolo)) > 0));
alter table public.inventari add constraint inventari_locazione_check check ((length(btrim(locazione)) > 0));
alter table public.inventari add constraint inventari_motivo_check check (((motivo IS NULL) OR (motivo = ANY (ARRAY['Conteggio errato'::text, 'Prelievo non registrato'::text, 'Deposito non registrato'::text, 'Merce mancante'::text, 'Altro'::text]))));
alter table public.inventario_righe add constraint inventario_righe_contato_check check ((contato >= 0));
alter table public.inventario_righe add constraint inventario_righe_tipo_check check ((tipo = ANY (ARRAY['confermato'::text, 'corretto'::text, 'aggiunto'::text, 'non_trovato'::text])));
alter table public.machine_manual_sections add constraint machine_manual_sections_check check ((page_end >= page_start));
alter table public.machine_manual_sections add constraint machine_manual_sections_page_start_check check ((page_start > 0));
alter table public.machines add constraint machines_linee_check check (((cardinality(linee) >= 1) AND (linee <@ ARRAY['L1'::text, 'L2'::text])));
alter table public.machines add constraint machines_nome_check check (((btrim(nome) <> ''::text) AND (char_length(nome) <= 60)));
alter table public.manutenzioni_soste add constraint manutenzioni_soste_descrizione_check check ((char_length(btrim(descrizione)) > 0));
alter table public.manutenzioni_soste add constraint manutenzioni_soste_linea_check check ((linea = ANY (ARRAY['L1'::text, 'L2'::text, 'L1-L2'::text])));
alter table public.manutenzioni_soste add constraint manutenzioni_soste_macchina_check check ((char_length(btrim(macchina)) > 0));
alter table public.manutenzioni_soste add constraint manutenzioni_soste_stato_check check ((stato = ANY (ARRAY['da_effettuare'::text, 'sospeso'::text, 'effettuato'::text])));
alter table public.product_barcodes add constraint product_barcodes_codice_barre_check check (((btrim(codice_barre) <> ''::text) AND (char_length(codice_barre) <= 120)));
alter table public.product_barcodes add constraint product_barcodes_produttore_check check (((produttore IS NULL) OR (char_length(produttore) <= 80)));
alter table public.product_locations add constraint product_locations_locazione_check check (((locazione IS NULL) OR ((btrim(locazione) <> ''::text) AND (char_length(locazione) <= 60))));
alter table public.product_locations add constraint product_locations_quantita_check check ((quantita >= 0));
alter table public.products add constraint products_produttore_barcode_len check (((produttore_barcode IS NULL) OR (char_length(produttore_barcode) <= 80)));
alter table public.products add constraint products_quantita_disponibile_check check ((quantita_disponibile >= 0));
alter table public.products add constraint products_scorta_minima_check check ((scorta_minima >= 0));
alter table public.shelves add constraint shelves_area_check check ((area = ANY (ARRAY['Magazzino'::text, 'Ufficio tecnico'::text])));
alter table public.shelves add constraint shelves_nome_check check (((btrim(nome) <> ''::text) AND (char_length(nome) <= 60)));
alter table public.transactions add constraint transactions_linea_check check (((linea IS NULL) OR (linea = ANY (ARRAY['L1'::text, 'L2'::text]))));
alter table public.transactions add constraint transactions_quantita_check check ((quantita > 0));

-- ---------- Vincoli: chiavi esterne ----------
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
alter table public.inventari add constraint inventari_user_id_fkey foreign key (user_id) references public.profiles(id);
alter table public.inventario_righe add constraint inventario_righe_inventario_id_fkey foreign key (inventario_id) references public.inventari(id) on delete cascade;
alter table public.inventario_righe add constraint inventario_righe_product_id_fkey foreign key (product_id) references public.products(id) on delete set null;
alter table public.machine_manual_groups add constraint machine_manual_groups_machine_id_fkey foreign key (machine_id) references public.machines(id) on delete cascade;
alter table public.machine_manual_sections add constraint machine_manual_sections_created_by_fkey foreign key (created_by) references public.profiles(id);
alter table public.machine_manual_sections add constraint machine_manual_sections_group_id_fkey foreign key (group_id) references public.machine_manual_groups(id) on delete set null;
alter table public.machine_manual_sections add constraint machine_manual_sections_machine_id_fkey foreign key (machine_id) references public.machines(id) on delete cascade;
alter table public.machine_manual_sections add constraint machine_manual_sections_operator_manual_id_fkey foreign key (operator_manual_id) references public.machine_operator_manuals(id) on delete cascade;
alter table public.machine_manuals add constraint machine_manuals_machine_id_fkey foreign key (machine_id) references public.machines(id) on delete cascade;
alter table public.machine_manuals add constraint machine_manuals_uploaded_by_fkey foreign key (uploaded_by) references public.profiles(id);
alter table public.machine_operator_manuals add constraint machine_operator_manuals_machine_id_fkey foreign key (machine_id) references public.machines(id) on delete cascade;
alter table public.machine_operator_manuals add constraint machine_operator_manuals_uploaded_by_fkey foreign key (uploaded_by) references public.profiles(id);
alter table public.manutenzioni_soste add constraint manutenzioni_soste_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.manutenzioni_soste add constraint manutenzioni_soste_esito_by_fkey foreign key (esito_by) references auth.users(id) on delete set null;
alter table public.product_barcodes add constraint product_barcodes_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
alter table public.product_locations add constraint product_locations_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
alter table public.products add constraint products_created_by_fkey foreign key (created_by) references public.profiles(id);
alter table public.transactions add constraint transactions_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references public.profiles(id);

-- ---------- Indici ----------
create unique index interventi_operatori_nome_uq on public.interventi_operatori using btree (lower(btrim(nome)));
create index inventari_scaffale_idx on public.inventari using btree (lower(btrim(locazione)), created_at desc);
create index inventario_righe_inv_idx on public.inventario_righe using btree (inventario_id);
create index machine_manual_groups_machine_idx on public.machine_manual_groups using btree (machine_id);
create index machine_manual_sections_group_idx on public.machine_manual_sections using btree (group_id);
create unique index machines_nome_unique on public.machines using btree (lower(btrim(nome)));
create index manutenzioni_soste_esito_at_idx on public.manutenzioni_soste using btree (esito_at desc);
create index manutenzioni_soste_lm_idx on public.manutenzioni_soste using btree (linea, macchina);
create index manutenzioni_soste_stato_idx on public.manutenzioni_soste using btree (stato, created_at desc);
create index idx_product_barcodes_product on public.product_barcodes using btree (product_id);
create unique index product_barcodes_codice_key on public.product_barcodes using btree (codice_barre);
create index product_locations_locazione_idx on public.product_locations using btree (lower(btrim(locazione)));
create unique index product_locations_product_shelf_key on public.product_locations using btree (product_id, coalesce(lower(btrim(locazione)), ''::text));
create index idx_products_categoria on public.products using btree (categoria);
create index idx_products_codice_articolo on public.products using btree (codice_articolo);
create index idx_products_codice_barre on public.products using btree (codice_barre);
create index idx_products_created_by on public.products using btree (created_by);
create index idx_products_locazione on public.products using btree (locazione);
create unique index shelves_nome_unique on public.shelves using btree (lower(btrim(nome)));
create index idx_transactions_data_ora on public.transactions using btree (data_ora desc);
create index idx_transactions_product_id on public.transactions using btree (product_id);
create index idx_transactions_tipo on public.transactions using btree (tipo);
create index idx_transactions_user_id on public.transactions using btree (user_id);
create index transactions_prelievi_vita_utile_idx on public.transactions using btree (product_id, data_ora) where (tipo = 'prelievo'::transaction_type);

-- ---------- Vista ----------
create view public.inventari_ultimi as
  select lower(btrim(locazione)) as chiave,
         max(created_at) as ultimo
    from public.inventari
   group by (lower(btrim(locazione)));
