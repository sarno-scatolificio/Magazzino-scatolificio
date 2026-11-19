# MATE desktop — audit e primo ciclo di miglioramento (16/11/2026)

Punto di ripristino: repository inizializzata con Git prima di ogni modifica, tag `punto-ripristino` (nel contenitore di lavoro; lo zip ricevuto non conteneva `.git`).
Stati usati: RISOLTO · PARZIALMENTE RISOLTO · DA VERIFICARE · NON RISOLTO.

## 1. Valutazione iniziale
Il layer desktop (`css/desktop.css`, `js/shared/desktop.js`, `*-desktop.js`, `products-table.js`) è già ben strutturato: sidebar, tabella Magazzino con pannello, Interventi a due colonne, Movimenti a postazione, Manuali con elenco+indice, scorciatoie da tastiera. Il punto debole era la gestione delle larghezze: tutto era dimensionato per ≥1280 px, con un'unica colonna massima da 1480 px anche a 1920 px.
**Limite dell'audit:** senza rete non sono disponibili Tailwind (CDN), Lucide, i font e Supabase, quindi non ho potuto vedere le schermate reali con dati. L'audit è in gran parte statico (lettura di CSS/JS e calcolo delle larghezze).

## 2. Problemi individuati
**A. Design / responsive**
- A1. A 1024 px sidebar da 232 px + pannelli fissi lasciavano alla tabella ~376 px, a Interventi ~336 px, a Movimenti ~296 px: **RISOLTO** (calcolo, da confermare a vista).
- A2. A 1920 px contenuto fermo a 1480 px con molto spazio vuoto: **PARZIALMENTE RISOLTO** (max 1680 px, pannelli e griglie più larghi da 1600 px).
**B. Usabilità**
- B1. Scrollbar della pagina nascosta anche su desktop (introdotta per un problema di scatto su mobile): con il mouse mancava il riferimento di posizione. **DA VERIFICARE** (scrollbar sottile + `scrollbar-gutter: stable`, che dovrebbe evitare lo scatto).
**C. Funzionali**
- Nessun errore JavaScript di logica trovato nei moduli desktop; i listener globali sono legati una sola volta (`wired`) e filtrano vista/modale/campo attivo. `npm run check` segnalava `NaN` come non definito in `machines.js:297`: falso positivo del controllo (globale JS) — **RISOLTO** aggiungendo `NaN` all'elenco in `tools/check.mjs`.
**E. Accessibilità**
- E1. `role="grid"` sulla tabella senza righe/celle ARIA (semantica non valida): **RISOLTO** (`role="group"`).
- E2. Riga/scheda/macchina selezionata solo con colore: **RISOLTO** (`aria-current` sincronizzato).
- E3. Focus visibile assente su gruppi, schede intervento, calendario, elenco macchine, voci sidebar: **RISOLTO** (CSS).
- E4. Contrasto dei suggerimenti tastiera (`#8a93a5` ≈ 3:1): **RISOLTO** (`#667085`).
- E5. Movimento ridotto non copriva accordion, frecce, ricerca: **RISOLTO**.
- E6. Cursore `not-allowed` sui controlli disabilitati: **RISOLTO**.
- E7. I suggerimenti `dk-hint` si aggiungono solo alle modali presenti al caricamento, non a quelle create dopo: **NON RISOLTO** (richiede decisione/prova nel browser).

- C2 (P0, trovato dal log console dell'utente): `Uncaught TypeError ... reading 'toLowerCase'` in `desktop.js:102` e `scanner-desktop.js:96` al login nel browser. Causa: l'autocompilazione di Chrome invia eventi `keydown` senza `key`; i gestori delle scorciatoie leggevano `e.key.toLowerCase()`. **RISOLTO** (controllo `if (!e.key) return` in tutti i gestori keydown dei moduli desktop).

## 3–5. Correzioni e miglioramenti
Estetici/layout: sidebar 200 px e pannelli più stretti tra 1024 e 1279 px; colonne più larghe, 4 colonne di sezioni Manuali e modali più alte da 1600 px. Nessun gradiente o effetto aggiunto.
Funzionali: scrollbar visibile, stati disabilitati, semantica ARIA, focus da tastiera. Nessuna logica di business toccata.

### Secondo passaggio (18/11/2026), dagli screenshot reali a 1920 px
- Interventi (≥1440 px): schede da ~112 px → righe compatte (macchina | descrizione + dettaglio | stato): circa il doppio di interventi visibili. **RISOLTO** (da verificare a vista).
- Magazzino: colonna destra vuota → riquadro guida tratteggiato "Nessun articolo selezionato". **RISOLTO** (da verificare a vista).
- Movimenti: Deposito/Prelievo senza gradiente né bordo 3D, orizzontali, a tutta larghezza colonna (88 px). **RISOLTO** (da verificare a vista).
- Impostazioni: sezioni su 2 colonne (3 da 1700 px) invece di una colonna a tutta larghezza; account e pulsante Report a tutta riga. **RISOLTO** (struttura verificata in Chromium; da vedere con i dati reali).
- Report (≥1280 px): periodo in alto, vita utile dei ricambi a sinistra, elenco Depositi/Prelievi con tab a destra. **RISOLTO** (struttura verificata in Chromium).
- Sidebar: promemoria delle scorciatoie da tastiera nello spazio vuoto sotto le voci. **RISOLTO**.
- Manuali: nessuna modifica (dagli screenshot la schermata risulta già ben organizzata). **DA VERIFICARE**.
- Impostazioni/Report: le finestre aperte dai pulsanti (utenti, macchine, scaffali, inventario) non sono state riprogettate. **NON RISOLTO**.

### Terzo passaggio (18/11/2026) — confronto con screenshot reali a 1920 px
- Confermati a schermo: righe compatte Interventi, Deposito/Prelievo piatti, scorciatoie in sidebar. **RISOLTO**.
- Movimenti: "Ultimi movimenti" mostrava 4 voci con metà pagina vuota (altezza fissa pensata per il telefono): ora cresce fino all'altezza dello schermo. **RISOLTO** (da verificare a vista).
- Manuali: righe dell'elenco macchine da ~88 a ~64 px. **RISOLTO** (da verificare a vista).
- Movimenti: i pulsanti Deposito/Prelievo nella scheda di ricerca sembravano una copia dei blocchi grandi, ma sono i selettori di cosa registra il tasto Invio del lettore (rimuoverli avrebbe tolto una funzione): ora sono un interruttore compatto con etichetta "Con Invio:", suggerimento al passaggio del mouse e `aria-pressed`. **RISOLTO** (da verificare a vista).
- Magazzino, Impostazioni, Report: non ancora visti a schermo. **DA VERIFICARE**.

## 6. File modificati
- `css/desktop.css` — tutte le regole nuove sono in `@media (min-width:1024px)` (il mobile non è toccato).
- `js/features/magazzino/products-table.js`, `js/features/interventi/interventi-desktop.js`, `js/features/manuali/manuals-desktop.js` — solo attributi ARIA (moduli già usati solo ≥1024 px).
- `tools/check.mjs` — falso positivo `NaN`.
- `js/shared/label-pdf.js`, `js/features/impostazioni/label-print.js` — (richiesta a parte) etichette: nome articolo grande, descrizione sotto poco più piccola, barre piccole in fondo (4 × 0,8 cm), 2 colonne.
- `index.html` (etichetta e tooltip del selettore Invio, solo nel blocco desktop), `js/features/movimenti/scanner-desktop.js` (`aria-pressed`).
- `service-worker.js` — cache `v306` → `v314`.
- `docs/DESKTOP_AUDIT.md` — questo file.
Nessuna modifica a database, RLS, Supabase, movimenti, offline.

## 7. Test eseguiti
- `npm run check` (acorn collegato da una copia locale): **superato** (110 moduli, import/export, ID, service worker). Prima: 1 falso positivo.
- Controllo sintattico dei 3 moduli JS modificati.
- Chromium headless a 1024/1280/1440/1920 px e 390 px su `index.html`: la pagina si carica, le regole nuove si applicano (`--side-w` 200 px a 1024 px, 232 px oltre; scrollbar `thin` + gutter stabile; sidebar visibile) e **non c'è overflow orizzontale** a nessuna larghezza desktop. L'unico errore JS è `tailwind is not defined`, dovuto alla CDN bloccata nel mio ambiente.

## 8. Test non eseguibili
Rete assente: niente Tailwind/Lucide/font/Supabase → nessun login, nessun dato, nessun test reale di tabelle, filtri, modali, Deposito/Prelievo, interventi, manuali, offline. L'aspetto reale delle schermate non è stato visto; i valori di larghezza sono calcolati. Il test a 390 px senza Tailwind non è significativo.

## 9. Problemi aperti
E7 sopra; B1 da verificare; verifica visiva a 1024 px di Report e Impostazioni (non analizzati a fondo); tabella Magazzino a 1024 px scorre in orizzontale se le colonne restano larghe (default 170/420/220 px).

## 10. Secondo ciclo
Provare a vista tutte le schermate alle 4 larghezze con Tailwind e dati reali; revisione di Report e Impostazioni su desktop; ridurre le larghezze di default delle colonne tabella sotto 1280 px; aggiungere i suggerimenti tastiera anche alle modali create dopo; valutare una vista a tabella per movimenti/storico.
