-- Torre assegnata a un articolo (Ricambi tecnici): es. «gommino di bordatura» dell'UNIFORMER -> torre «Bordatura».
-- Nel Prelievo l'app mostra solo le teste di quella torre (vedi js/features/magazzino/testa-macchine.js).
-- Il valore e' il NOME della torre come scritto in Impostazioni -> Gestione macchine (machines.torri[].nome); vuoto = nessuna torre.
-- Da eseguire UNA volta nel SQL Editor di Supabase, PRIMA di pubblicare la versione dell'app con il campo «Torre».
-- E' solo additiva: una colonna nuova, vuota per tutti gli articoli esistenti. RLS e grants di `products` restano invariati
-- (la colonna segue le policy della tabella: la modifica resta riservata agli admin).

alter table public.products add column if not exists torre text;
alter table public.products drop constraint if exists products_torre_len;
alter table public.products add constraint products_torre_len check (torre is null or char_length(torre) <= 60);

-- Rollback: alter table public.products drop column torre;
