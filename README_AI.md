# MATE — guida operativa per IA (lettura prioritaria)

> **Scopo:** ridurre al minimo token, file letti e modifiche collaterali durante manutenzione/evoluzione del codice.
> Questa guida è tecnica e orientata agli agenti IA. Per la guida utente usare `README.md`.

## 0. Regola di lavoro (obbligatoria)

1. Leggi questo file, poi **solo** i file indicati nella mappa per il task.
2. Cerca prima la funzione/ID/stringa interessata (`rg`/ricerca testuale); non leggere interi moduli se bastano le righe circostanti.
3. Traccia il flusso: UI (`index.html`) → feature (`js/features`) → data adapter (`js/data`) → Supabase/SQL.
4. Modifica il punto più piccolo possibile. Non riscrivere file, non rifattorizzare e non cambiare naming/architettura se non richiesto.
5. Prima di concludere esegui `cd tools && npm install` (solo se necessario) e `npm run check`; correggi eventuali regressioni introdotte.
6. Nel riepilogo finale indica file modificati, comportamento cambiato, verifica eseguita e limiti non verificati.

**Non fare:** scansioni massive del repository; copiare codice duplicato senza verificarne la provenienza; inventare schema DB; eseguire SQL di produzione; introdurre dipendenze/build system senza richiesta.

## 1. Architettura in 30 secondi

MATE è una PWA web statica: HTML + CSS + JavaScript ES modules nel browser. Backend: Supabase (PostgreSQL, Auth, Storage, Edge Functions). Non è presente un framework frontend né una build pipeline standard.

- `index.html`: shell dell'app, markup/ID DOM e caricamento moduli.
- `js/core`: bootstrap, autenticazione, navigazione, sincronizzazione offline, push.
- `js/features/<area>`: logica delle schermate e delle funzioni di prodotto.
- `js/data`: accesso a Supabase, suddiviso per dominio.
- `js/shared`: componenti/utilità riutilizzati.
- `css`: stile globale e desktop.
- `database`: fotografia SQL dello schema e migrazioni incrementali.
- `service-worker.js`: cache/offline/PWA; deve conoscere i file locali necessari.
- `tools/check.mjs`: controlli statici repository; CI in `.github/workflows/check.yml`.

## 2. Mappa rapida: dove intervenire

| Richiesta | Primo file da leggere | File collegati (solo se necessari) |
|---|---|---|
| Avvio app, cambio sezione, routing, back Android, permessi UI | `js/core/app.js` | `js/core/nav-history.js`, `js/core/auth.js`, `index.html` |
| Login, sessione, ruoli, timeout inattività | `js/core/auth.js` | `js/data/supabase-auth.js`, `database/04-sicurezza-rls.sql` |
| Accesso con impronta (passkey/WebAuthn) | `js/core/passkey.js` | `js/data/supabase-passkey.js`, `js/features/impostazioni/passkey-settings.js`, `js/core/auth.js`, `supabase/functions/passkey/` (verifica server), `database/migrazioni/2026-11-07-passkey.sql` |
| Testa delle piattelle (Prelievo + vita utile per testa), torri e teste dei 4 macchinari con teste (Tasi test, Provatrice boni, Uniformer, Can-o-mat; editor in Impostazioni → Gestione macchine) | `js/features/magazzino/testa-macchine.js` | `js/features/movimenti/scanner-testa.js`, `js/shared/testa-picker.js`, `js/features/impostazioni/machines.js`, `js/features/report/lifespan.js`, `database/migrazioni/2026-11-10-testa-piattelle.sql`, `database/migrazioni/2026-11-11-macchine-torri-teste.sql` |
| Client/config Supabase | `js/data/supabase-client.js` | `js/data/supabase.js`, `_headers` |
| Movimenti, deposito/prelievo, scanner/camera | `js/features/movimenti/scanner.js` | `scanner-*.js`, `js/data/supabase-transactions.js`, `js/core/offline-queue.js` |
| Coda offline/sincronizzazione | `js/core/offline-queue.js` | `js/features/movimenti/scanner-transaction.js`, `js/data/supabase-transactions.js`, `service-worker.js` |
| Magazzino, articoli, schede/dettagli | `js/features/magazzino/products.js` | `products-*.js`, `js/data/supabase-products.js`, `js/data/supabase-inventory.js` |
| Sotto scorta e badge | `js/features/magazzino/low-stock.js` | `js/features/magazzino/low-stock-unseen.js`, `js/data/supabase-products.js`, push |
| Manuali, PDF, ricerca e navigazione macchine | `js/features/manuali/manuals.js` | `manuals-*.js`, `pdf-cache.js`, `js/data/supabase-manuals.js` |
| Interventi manutenzione | `js/features/interventi/interventi.js` | `interventi-*.js`, `js/data/supabase-activity.js`, `js/data/supabase-machines.js` |
| Report/dashboard/vita utile | `js/features/report/dashboard.js` | `js/features/report/lifespan.js`, `js/data/supabase-*.js` |
| Utenti/macchine/scaffali/inventario/impostazioni | `js/features/impostazioni/<funzione>.js` | `js/data/supabase-<dominio>.js`, `index.html` |
| Ricerca globale | `js/shared/global-search.js` | `js/core/app.js`, feature coinvolta |
| Toast, modali, picker, camera, UI condivisa | `js/shared/<componente>.js` | cercare gli import del componente |
| Layout/stile | `css/style.css` | `css/desktop.css`, classi/markup in `index.html` |
| Markup o ID di una schermata | `index.html` | modulo feature relativo |
| Push/notifiche | `js/core/push.js` | `js/data/supabase-push.js`, `supabase/functions/**`, `database/migrazioni/*notifiche*` |
| Installazione PWA/cache | `manifest.json` | `service-worker.js`, `index.html`, `assets/icons/` |
| Tabelle, colonne, indici, vincoli | `database/01-struttura.sql` | migrazioni, `js/data/` |
| Funzioni RPC | `database/02-funzioni.sql` | chiamate `rpc()` in `js/data/` |
| Trigger | `database/03-trigger.sql` | migrazioni |
| Policy/ruoli/permessi | `database/04-sicurezza-rls.sql` | `docs/SECURITY.md`, funzioni SQL |
| Bucket e policy Storage | `database/05-storage.sql` | `js/data/`, `docs/SECURITY.md` |
| Controlli repository | `tools/check.mjs` | `tools/README.md`, workflow CI |

## 3. Albero funzionale

```text
index.html                 shell, markup e ID DOM
config/tailwind.config.js  configurazione Tailwind CDN
css/style.css              stile generale/mobile
css/desktop.css            adattamenti desktop
js/
  core/
    app.js                 bootstrap e orchestrazione schermate
    auth.js                stato auth, profilo e ruoli
    nav-history.js         livelli/back interno
    offline-queue.js       coda movimenti offline
    push.js                gestione push lato client
  data/
    supabase-client.js     createClient + URL/chiave pubblica
    supabase.js            facade/barrel che riesporta i moduli data
    supabase-*.js          adapter DB/Auth/Storage per dominio
  features/
    login/                 elementi della schermata login
    movimenti/             scanner, movimenti, prestiti, flussi articolo
    magazzino/             anagrafica, dettaglio, liste, sotto scorta
    manuali/               catalogo, gruppi, ricerca, PDF e cache PDF
    interventi/            registro manutenzione, foto, ricambi, PDF
    report/                dashboard e analisi vita utile
    impostazioni/           gestione dati e configurazioni admin
  shared/                  componenti e helper riutilizzabili
database/
  01-struttura.sql         schema base (snapshot, non migrazione)
  02-funzioni.sql          funzioni PostgreSQL/RPC
  03-trigger.sql           trigger
  04-sicurezza-rls.sql     RLS e grants
  05-storage.sql           bucket/policy Storage
  migrazioni/              modifiche incrementali già applicate/registrate
supabase/functions/        Edge Functions per notifiche
assets/                    immagini, icone, video e suoni
tools/check.mjs            controlli statici
service-worker.js          cache e comportamento offline
manifest.json              metadati PWA
_headers                   header HTTP/CSP (hosting statico)
docs/                      sicurezza, consegna, asset e note operative
```

## 4. Suddivisione dei moduli per area

### `js/data` — confine backend
I moduli `supabase-*.js` sono il punto normale per leggere/scrivere dati. Le schermate dovrebbero chiamare questi adapter, non replicare query Supabase. `supabase.js` è una facade di re-export: prima di aggiungere un nuovo import controllare cosa esporta.

- `supabase-auth.js`: autenticazione/profilo.
- `supabase-products.js`: articoli/anagrafica.
- `supabase-inventory.js`: inventario.
- `supabase-transactions.js`: depositi/prelievi e movimenti.
- `supabase-machines.js`: macchine/linee.
- `supabase-shelves.js`, `supabase-shelf-photos.js`: scaffali e foto.
- `supabase-manuals.js`: manuali e relativi dati.
- `supabase-prestiti.js`: prestiti.
- `supabase-activity.js`: attività/interventi.
- `supabase-push.js`: registrazioni push.
- `supabase-client.js`: unico client/config.

### `js/features` — logica applicativa
I file `*-shared.js`, `*-data.js`, `*-list.js`, `*-detail.js`, `*-search.js`, `*-pdf*.js` separano stato/dati, rendering e sottoflussi. Non spostare codice tra questi moduli senza seguire import ed export effettivi.

**Scanner:** `scanner.js` è il modulo d'ingresso; `scanner-shared.js` contiene stato/elementi condivisi; `scanner-camera.js`, `scanner-search.js`, `scanner-result.js`, `scanner-punti.js`, `scanner-transaction.js`, `scanner-idle.js`, `scanner-desktop.js` implementano i singoli passaggi.

**Magazzino:** `products.js` orchestra; `products-data.js` gestisce dati/stato; `products-list.js` rendering elenco; `products-detail.js` scheda/modale; `products-table.js` vista tabellare desktop; `products-shared.js` stato/helper condivisi.

**Manuali:** `manuals.js` orchestra visualizzazione PDF; `manuals-data.js` dati/cache; `manuals-browser.js` navigazione catalogo; gli altri `manuals-*.js` gestiscono dettaglio, gruppi, icone, ricerca, riordino, ricambi e apertura esterna; `pdf-cache.js` cache PDF.

**Interventi:** `interventi.js` ingresso/orchestrazione; `interventi-data.js` costanti e helper di dominio; `interventi-shared.js` stato/DOM condivisi; moduli separati per lista, dettaglio, creazione, foto, ricambi, operatori, interventi rapidi e PDF.

## 5. Regole critiche e dipendenze incrociate

- **ID DOM:** molti moduli recuperano elementi tramite ID presenti in `index.html`. Se aggiungi/rinomini un ID, aggiorna tutti i riferimenti e lancia `npm run check`.
- **Import ES modules:** rispettare gli export reali; niente script globali aggiuntivi se il codice usa moduli.
- **Auth e sicurezza:** nascondere un pulsante non è autorizzazione. Ogni operazione sensibile deve essere protetta da RLS e/o funzione SQL; verificare ruolo e policy.
- **Movimenti:** non aggiornare separatamente giacenza e storico dal client. Conservare il flusso transazionale esistente (RPC/backend) e la gestione offline.
- **Offline/PWA:** quando aggiungi/rimuovi/renomini un file locale usato dall'app, controlla `service-worker.js` e la lista cache. Verifica anche `manifest.json` e icone solo se il task le coinvolge.
- **CSS:** controllare prima se la regola esiste già; `style.css` è grande e globale. Regole desktop specifiche in `desktop.css`. Preferire selettori circoscritti per evitare regressioni.
- **SQL:** `01-struttura.sql` è uno snapshot del database, non la sequenza di migrazioni. Per una modifica evolutiva creare una nuova migrazione datata in `database/migrazioni/`, coerente con le precedenti, e documentare l'ordine di applicazione.
- **Produzione:** non eseguire SQL, deploy, cancellazioni, modifiche RLS o operazioni Storage senza autorizzazione esplicita e piano di rollback.
- **Configurazione:** `js/data/supabase-client.js` contiene URL e chiave publishable/anon pubblica. Non inserirvi mai `service_role`, password o segreti. `_headers` contiene CSP e deve consentire solo origini necessarie.
- **Notifiche:** le Edge Functions e le migrazioni notifiche sono collegate a push, trigger e preferenze utente; modificare l'intero flusso, non un solo lato.
- **File grandi:** `index.html`, `css/style.css` e alcuni moduli feature sono voluminosi. Cercare ID, funzioni e stringhe precise; leggere porzioni mirate.

## 6. Duplicazioni da trattare con cautela

Nel repository esistono file con lo stesso nome e contenuti potenzialmente sovrapposti in aree diverse, in particolare:
- `js/features/magazzino/products-data.js`
- `js/features/movimenti/products-data.js`
- `js/features/report/products-data.js`
- analogamente `products-list.js` e `low-stock.js` in più aree.

**Non presumere che siano copie intercambiabili.** Prima di modificarli:
1. confrontare hash/contenuto e import dei chiamanti;
2. identificare quale versione viene caricata dalla schermata/task;
3. aggiornare solo i percorsi realmente coinvolti;
4. non eliminare duplicati senza test e richiesta esplicita.

## 7. Database: procedura sicura

`database/README.md` descrive la fotografia dello schema e il ripristino. Leggerlo prima di qualsiasi intervento SQL.

- Ordine snapshot: `01-struttura.sql` → `02-funzioni.sql` → `03-trigger.sql` → `04-sicurezza-rls.sql` → `05-storage.sql`.
- Le migrazioni in `database/migrazioni/` sono modifiche incrementali: leggere le più vicine per data/argomento.
- Lo snapshot è stato ricostruito dal database reale; non è stato validato come bootstrap su DB vuoto. Testare sempre su progetto Supabase separato.
- I dati applicativi e i file Storage non sono contenuti negli SQL.
- Per sicurezza consultare `docs/SECURITY.md`; per passaggio di proprietà `docs/CONSEGNA.md`.

## 8. Verifica minima prima di consegnare

```bash
cd tools
npm install     # solo se node_modules non è presente
npm run check
```

Il controllo verifica import, riferimenti/ID, file usati, risorse e service worker; viene eseguito anche dalla GitHub Action `.github/workflows/check.yml`.

Se il task tocca:
- **UI:** provare schermata mobile e desktop interessata.
- **Auth/RLS/SQL:** verificare ruoli operatore/admin su ambiente di test.
- **Movimenti:** testare deposito, prelievo, quantità limite e riconnessione/offline.
- **PDF/manuali/foto:** testare apertura, cache e fallback.
- **PWA/cache:** verificare aggiornamento service worker e installazione.
- **Push:** verificare permessi, token, preferenze e funzione server.

Non dichiarare test manuali eseguiti se non sono stati realmente eseguiti.

## 9. Protocollo token-minimo per ogni update

Usa questo formato mentale/operativo:

```text
OBIETTIVO → individua 1 feature e i suoi entry point
RICERCA   → cerca funzione/ID/query; leggi solo contesto utile
FLUSSO    → verifica chiamante + adapter dati + eventuale SQL
PATCH     → modifica minima, senza refactor non richiesto
CHECK     → npm run check + test mirati del flusso
REPORT    → file toccati, motivo, test, rischi residui
```

Se manca un requisito, fai **una sola domanda mirata** invece di esplorare tutto il progetto o formulare ipotesi.

## 10. Riferimenti da aprire solo quando servono

- `README.md`: guida funzionale per utenti e panoramica delle schermate.
- `database/README.md`: schema Supabase e ripristino.
- `docs/SECURITY.md`: audit sicurezza, RLS, header e punti aperti.
- `docs/CONSEGNA.md`: servizi, pubblicazione, trasferimento e segreti.
- `docs/ASSET.md`: registro asset.
- `tools/README.md`: uso dei controlli automatici.
- `NOTICE.md`: note/licenze.

---
**Manutenzione di questa guida:** aggiornarla quando cambiano architettura, percorsi, flussi centrali o comandi di verifica. Evitare di trasformarla in una seconda documentazione utente.
