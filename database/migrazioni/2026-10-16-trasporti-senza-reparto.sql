-- Trasporti è presente su Linea 1 e Linea 2 ma NON in Reparto (già applicato sul database di produzione il 16/10/2026).
-- Sostituisce l'ultima riga di 2026-10-16-reparto-senza-linea.sql (che lo abbinava anche a REP): se si rigioca quello script, rieseguire anche questo.
update public.machines set linee = array['L1','L2'] where lower(nome) = 'trasporti';
