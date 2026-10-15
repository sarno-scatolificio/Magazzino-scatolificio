# Database — struttura di riferimento

Il database dell'app è un progetto **Supabase** (PostgreSQL + autenticazione + archiviazione file).
In questa cartella c'è la **fotografia della sua struttura al 15 ottobre 2026**, ricostruita leggendo
direttamente il catalogo del database di produzione (non è la storia delle singole migrazioni).

| File | Contenuto |
|---|---|
| `01-struttura.sql` | tipi, 16 tabelle, vincoli, indici, vista |
| `02-funzioni.sql` | 20 funzioni (movimenti, import, inventario, codici a barre, ruoli) |
| `03-trigger.sql` | trigger sulle tabelle e sulla creazione utenti |
| `04-sicurezza-rls.sql` | RLS attiva su tutte le tabelle, 51 policy, permessi sulle funzioni |
| `05-storage.sql` | 5 bucket di archiviazione e 18 policy |

**Verifica fatta**: il numero di oggetti in questi file (16 tabelle, 69 vincoli, 24 indici, 20 funzioni,
9 trigger, 51 + 18 policy) coincide con quello del database reale. I file non sono stati eseguiti su un
database vuoto (nell'ambiente di lavoro non c'era un PostgreSQL): la prima volta che servono per ricreare
il database vanno provati su un **progetto Supabase di prova**, mai su quello di produzione.

## Per ricreare il database da zero
1. Creare un nuovo progetto Supabase e attivare le estensioni `pgcrypto` e `uuid-ossp`.
2. Eseguire i file nell'ordine dei numeri dal SQL Editor.
3. Creare il primo utente da *Authentication → Users* e promuoverlo ad Admin:
   `update public.profiles set role = 'admin' where email = '...';`
4. Aggiornare `SUPABASE_URL` e `SUPABASE_ANON_KEY` in `js/data/supabase-client.js` e l'indirizzo del progetto
   nella `Content-Security-Policy` del file `_headers` (l'indirizzo del progetto compare una volta, nella direttiva `connect-src`).

## Cosa NON è qui dentro
- **I dati** (articoli, movimenti, utenti, interventi): vanno copiati con un backup del database.
- **I file** nello storage (PDF dei manuali, foto degli interventi, icone delle sezioni): vanno copiati a parte.
- **Gli utenti** di `auth.users` e le loro password: si trasferiscono solo con il passaggio di proprietà del
  progetto o con un'esportazione dedicata di Supabase.

## Nota di sicurezza da conoscere
I ruoli `anon` e `authenticated` hanno, come da impostazione standard di Supabase, i privilegi di tabella
(`select`, `insert`, …) su tutte le tabelle: a bloccare davvero l'accesso sono le **policy RLS**, che
consentono le operazioni solo agli utenti autenticati. Per una difesa a più livelli si può togliere ad `anon`
ogni privilegio sulle tabelle di `public`; è una modifica da fare con calma e da provare su un progetto di
prova, perché l'unica lettura prevista senza accesso è quella delle icone dei manuali (bucket pubblico).
