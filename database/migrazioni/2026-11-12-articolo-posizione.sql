-- Posizione di montaggio di un articolo su una torre a teste doppie: 'S' = superiore, 'I' = inferiore (vuoto = si sceglie a ogni prelievo).
-- Si imposta nella scheda articolo (campo «Posizione», dopo «Torre») e nel Prelievo il selettore delle teste la usa senza chiederla.
-- Da eseguire UNA volta nel SQL Editor di Supabase, DOPO 2026-11-12-articolo-torre.sql e PRIMA di pubblicare l'app con il campo.
-- Solo additiva: una colonna nuova, vuota per tutti gli articoli. RLS e grants di `products` invariati.

alter table public.products add column if not exists posizione text;
alter table public.products drop constraint if exists products_posizione_check;
alter table public.products add constraint products_posizione_check check (posizione is null or posizione in ('S', 'I'));

-- Rollback: alter table public.products drop column posizione;
