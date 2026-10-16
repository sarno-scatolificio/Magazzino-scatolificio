-- Macchine di reparto senza linea (es. Fasciatrice, Sovrappositore): linea = 'REP' ("Reparto").
-- Già applicato sul database di produzione il 16/10/2026 (script di riferimento, stato finale dei vincoli).
alter table public.machines drop constraint if exists machines_linee_check;
alter table public.machines add constraint machines_linee_check check (
  cardinality(linee) >= 1 and linee <@ array['L1','L2','REP']::text[]);  -- "Reparto" si può abbinare alle linee (es. Trasporti)

alter table public.manutenzioni_soste drop constraint if exists manutenzioni_soste_linea_check;
alter table public.manutenzioni_soste add constraint manutenzioni_soste_linea_check check (linea = any (array['L1','L2','L1-L2','REP']));

alter table public.interventi_rapidi drop constraint if exists interventi_rapidi_linea_check;
alter table public.interventi_rapidi add constraint interventi_rapidi_linea_check check (linea = any (array['L1','L2','L1-L2','REP']));

alter table public.transactions drop constraint if exists transactions_linea_check;
alter table public.transactions add constraint transactions_linea_check check (linea is null or linea = any (array['L1','L2','REP']));

update public.machines set linee = array['REP'] where lower(nome) in ('fasciatrice','sovrappositore');
update public.machines set linee = array['L1','L2','REP'] where lower(nome) = 'trasporti';
