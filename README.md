# MATE — Magazzino Tecnico

**MATE** è l'app del reparto manutenzione dello scatolificio per gestire **il magazzino dei ricambi**, **i manuali delle macchine** e **il blocco note degli interventi**, tutto in un unico posto, dal telefono.

Si usa come una normale app (si installa sulla schermata Home), si apre in un secondo e funziona anche quando la rete è debole: i movimenti di magazzino registrati senza connessione vengono inviati da soli appena torna il segnale.

---

## Indice

1. [A cosa serve](#1-a-cosa-serve)
2. [Chi la usa: Operatore e Admin](#2-chi-la-usa-operatore-e-admin)
3. [Accesso e sicurezza](#3-accesso-e-sicurezza)
4. [Come è organizzata](#4-come-è-organizzata)
5. [Movimenti: depositi e prelievi](#5-movimenti-depositi-e-prelievi)
6. [Magazzino: l'anagrafica degli articoli](#6-magazzino-lanagrafica-degli-articoli)
7. [Manuali delle macchine](#7-manuali-delle-macchine)
8. [Interventi: il blocco note della manutenzione](#8-interventi-il-blocco-note-della-manutenzione)
9. [Report (solo Admin)](#9-report-solo-admin)
10. [Impostazioni](#10-impostazioni)
11. [Funzioni che si trovano ovunque](#11-funzioni-che-si-trovano-ovunque)
12. [Informazioni tecniche](#12-informazioni-tecniche)

---

## 1. A cosa serve

| Problema di tutti i giorni | Cosa fa MATE |
|---|---|
| «Quanti cuscinetti di quel tipo abbiamo e dove sono?» | Anagrafica con giacenza, scaffale e ricerca immediata, anche da codice a barre. |
| «Chi ha preso quel ricambio e per quale macchina?» | Ogni deposito e prelievo viene registrato con utente, data, linea, macchina e punto di utilizzo. |
| «Stiamo finendo qualcosa?» | Elenco automatico degli articoli sotto scorta minima, raggruppati per scaffale. |
| «Dove trovo il manuale della Saldatrice, pagina 120?» | Manuali PDF organizzati per macchina, con pulsanti che aprono direttamente la sezione giusta. |
| «Cosa abbiamo fatto durante la sosta di ieri?» | Blocco note interventi con foto, esito, operatori e PDF giornaliero da condividere. |
| «Questo cuscinetto dura meno del solito?» | Report sulla vita utile dei ricambi, con segnalazione delle sostituzioni anticipate. |

Gli articoli sono divisi in tre categorie: **Cuscinetti**, **Cinghie** e **Ricambi tecnici**.

---

## 2. Chi la usa: Operatore e Admin

L'app ha due tipi di utente. I permessi sono applicati sia nell'app sia sul database: un Operatore non può modificare i dati nemmeno aggirando l'interfaccia.

| | **Operatore** (tutti i conduttori e i manutentori) | **Admin** |
|---|---|---|
| Cercare articoli e consultare le schede | ✅ | ✅ |
| Registrare depositi e prelievi | ✅ | ✅ |
| Vedere gli articoli sotto scorta e gli ultimi movimenti | ✅ | ✅ |
| Consultare i manuali delle macchine | ✅ | ✅ |
| Usare gli Interventi (inserire, aggiornare l'esito) | ✅ | ✅ |
| Creare, modificare, eliminare articoli | — sola lettura | ✅ |
| Importare l'inventario da Excel | — | ✅ |
| Gestire manuali, pulsanti, gruppi e icone | — | ✅ |
| Gestire utenti, macchine, scaffali, operatori, interventi rapidi | — | ✅ |
| Consultare il Report ed esportare i movimenti in Excel | — | ✅ |
| Fare l'inventario degli scaffali e vederne lo storico | — | ✅ |
| Eliminare movimenti dallo storico | — | ✅ |

Gli account non si creano da soli: li crea l'Admin, così l'accesso resta controllato.

---

## 3. Accesso e sicurezza

- **Accesso** con email e password. La schermata di ingresso mostra il logo MATE, un carosello di foto e il modulo di accesso.
- **Disconnessione automatica**: dopo 60 minuti senza utilizzo l'app esce da sola, avvisando un minuto prima. È pensata per i tablet condivisi in reparto.
- **Protezione dei dati**: l'accesso ai dati è regolato direttamente dal database (permessi per riga). I movimenti si registrano solo tramite una funzione unica che aggiorna la giacenza e lo storico insieme, in modo atomico: la giacenza non può scendere sotto zero nemmeno se due persone prelevano nello stesso istante.
- Maggiori dettagli tecnici nel file `SECURITY.md`.

---

## 4. Come è organizzata

**Barra in basso** — quattro sezioni:

| Icona | Sezione | A cosa serve |
|---|---|---|
| ⇄ | **Movimenti** | Deposito, prelievo, articoli sotto scorta, ultimi movimenti |
| 📦 | **Magazzino** | Elenco degli articoli per scaffale o per macchina |
| 📖 | **Manuali** | Manuali PDF delle macchine |
| 📝 | **Interventi** | Blocco note della manutenzione |

**Barra in alto**:
- il campo **Cerca articolo…** e il pulsante **fotocamera** per scansionare un codice a barre da qualsiasi sezione;
- l'ingranaggio delle **Impostazioni**.

Il **Report** (solo Admin) si apre dalle Impostazioni.

Il tasto **indietro del telefono** chiude sempre il livello aperto (una finestra, il dettaglio di una macchina, una modifica…) invece di far uscire dall'app.

---

## 5. Movimenti: depositi e prelievi

### 5.1 La schermata iniziale

Prima di scegliere cosa fare, la sezione mostra due riquadri utili a colpo d'occhio.

**Articoli sotto scorta**
- Una scheda che si espande con **una piastrella per ogni serie di scaffale** (SA, SB, SC…).
- Toccando una piastrella si apre, proprio sotto la riga toccata, l'elenco degli articoli in scorta minima di quella serie con **lo scaffale preciso** di ciascuno e la quantità. Toccandone un'altra, la precedente si chiude.
- Una barra di filtro **Tutti / Cuscinetti / Cinghie / Ricambi** permette di guardare una sola categoria.
- Se un articolo sta su più scaffali, la scorta minima è controllata sul **totale**.

**Ultimi movimenti**
- Gli ultimi depositi e prelievi registrati.
- **Vedi tutti** apre l'elenco completo con le schede **Tutti / Depositi / Prelievi**: si vede chi ha fatto cosa e, toccando una riga, si espande il dettaglio (articolo, quantità, linea, macchina, punto di utilizzo, data e ora). È in sola lettura per tutti.

### 5.2 Registrare un deposito o un prelievo

Si sceglie **Deposito** (merce che entra) o **Prelievo** (merce che esce); si apre un cassetto dal basso, con la stessa animazione ovunque nell'app. Il deposito ha intestazione verde, il prelievo blu.

1. **Trovare l'articolo**
   - **Scansione**: si inquadra il codice a barre con la fotocamera (si tocca lo schermo per mettere a fuoco, c'è il pulsante per cambiare fotocamera e quello per la **torcia**). Si riconosce qualunque codice a barre associato all'articolo, anche se ne ha più di uno.
   - **Ricerca manuale**: si scrive il codice, la descrizione, lo scaffale o la macchina.
   - Dalla ricerca in alto, ogni risultato offre anche i pulsanti **Deposito** e **Prelievo** che aprono il cassetto con l'articolo già scelto.
2. **Scegliere lo scaffale**: se l'articolo è su più scaffali, l'app li elenca con la quantità di ciascuno. Un prelievo non può superare la quantità presente su quello scaffale.
3. **Indicare la quantità**: l'app mostra la **giacenza attuale** e la **giacenza dopo** il movimento prima della conferma.
4. **Solo per il prelievo, dove viene usato il pezzo**:
   - **Cuscinetti**: linea (Linea 1 / Linea 2), macchinario e **punto di utilizzo**. Il punto si scrive a mano, ma l'app propone quelli già usati per lo stesso cuscinetto sulla stessa linea e macchina e riconosce lo stesso posto scritto in modi diversi (maiuscole, accenti, punteggiatura).
   - **Cinghie e Ricambi tecnici**: basta la linea (quando l'articolo ne ha una sola, è già impostata).
5. **Conferma**: il movimento viene registrato con il nome dell'utente, la data e l'ora.

Se il prelievo porta l'articolo sotto scorta minima, compare subito un avviso.

### 5.3 Senza connessione

Se manca la rete, il movimento viene **salvato sul telefono e messo in coda**: un avviso «in attesa di sincronizzazione» indica quanti ne mancano. Appena torna la connessione vengono inviati in automatico, nell'ordine in cui sono stati fatti. Gli articoli già visti almeno una volta si trovano anche offline.

---

## 6. Magazzino: l'anagrafica degli articoli

### 6.1 Come si sfoglia

Tre schede: **Cuscinetti**, **Cinghie**, **Ricambi tecnici**.

- **Cuscinetti**: si vedono per **scaffalatura**, con ricerca per codice o per scaffale.
- **Cinghie e Ricambi tecnici**: un selettore a scorrimento permette di passare tra **Scaffalatura** e **Macchina**.
- Gli scaffali sono **raggruppati per sigla**: una scheda «Scaffale SA» che si espande e mostra tutti gli scaffali SA, poi «Scaffale SB» e così via. I gruppi sono indipendenti, dentro un gruppo si apre un solo scaffale alla volta. Uscendo dalla sezione, al rientro tutto è richiuso.
- Una **barra di ricerca rapida** cerca per codice, scaffale, macchina, punto di utilizzo e codice a barre; ha un pulsante X per cancellare il testo senza tastiera (lo stesso vale per quasi tutti i campi di testo dell'app).
- **Filtri**: per linea, per macchina, per area (Magazzino o Ufficio tecnico) e «solo articoli sotto scorta minima».
- Negli elenchi dei Ricambi tecnici la riga mostra la **descrizione in grassetto** e, sotto, il codice, la macchina e la linea.

### 6.2 La scheda articolo (sola lettura)

Toccando un articolo si apre una scheda pulita, senza campi modificabili:
- codice, descrizione (dove presente) e categoria;
- **quantità disponibile** e **tutte le locazioni** con la quantità di ciascuna (lo stesso codice può stare su più scaffali);
- macchina, linea e punto di utilizzo, dove previsti;
- **tutti i codici a barre** con il produttore di ciascuno, ognuno con il pulsante per **stampare l'etichetta**;
- il pulsante per aprire il **manuale** corrispondente.

L'Operatore si ferma qui. L'Admin ha in più un **pulsante tondo a matita** in basso che apre il modulo di modifica.

### 6.3 Gestione degli articoli (Admin)

- **+ Nuovo** crea un articolo; la matita nella scheda lo modifica; si può anche eliminare.
- **Più scaffali per lo stesso articolo**: nella modifica c'è la sezione «Scaffali e quantità», con una riga per scaffale e il pulsante «Aggiungi scaffale». La giacenza totale è la somma.
- **Più codici a barre per lo stesso articolo**, ciascuno con il produttore (facoltativo); si possono acquisire con la fotocamera. Per cinghie e ricambi tecnici, che non hanno un codice stampato, c'è il pulsante **Genera** che ne crea uno.
- **Etichetta PDF**: contiene solo il codice a barre e il numero sotto, pronta da stampare.
- **Annulla / Ripeti**: i pulsanti ↶ e ↷ annullano e ripristinano creazione, modifica ed eliminazione di articoli (fino a 20 operazioni, finché la pagina resta aperta).
- **Linea e Macchina**: la linea ha tre valori fissi (L1, L2, L1-L2); la macchina si sceglie da un elenco (che si gestisce in Impostazioni) con una finestra di selezione disegnata apposta per il telefono.
- **Descrizione facoltativa** per ogni cuscinetto, per spiegare a cosa serve quel codice; per i Ricambi tecnici la descrizione è il dato principale mostrato nell'elenco.
- **Scorta minima** impostabile per ogni articolo.
- **Import da Excel** dell'inventario: vedi [Impostazioni](#10-impostazioni).

---

## 7. Manuali delle macchine

Una raccolta dei manuali PDF, organizzata per macchina.

- **Elenco macchine**: ogni macchina ha la sua riga con icona; toccandola si apre il dettaglio con un'animazione di «navigazione» (il dettaglio scorre da destra).
- **Pulsanti**: dentro la macchina compaiono banner con icona a sinistra e dettaglio a destra. Ogni pulsante porta a **una sezione precisa del manuale** (per esempio «Monitor energia», pagine da 100 a 120) oppure al manuale intero.
- **Apertura con la tua app PDF** (Android): toccando un pulsante di sezione o lo Spare parts, Android mostra il menu «Apri con» e si sceglie il lettore PDF preferito tra quelli installati (Drive, Acrobat, Xodo…). Per una sezione l'app estrae sul telefono solo quelle pagine in un piccolo PDF temporaneo, che si cancella da solo dopo un'ora. Fuori da Android, o se qualcosa non funziona, si apre il lettore integrato già alla pagina giusta.
- **Gruppi**: i pulsanti si possono organizzare in gruppi (schede in alto, scorrevoli col dito), per esempio per una macchina con molte sezioni.
- **Spare parts**: un pulsante in alto apre il manuale ricambi. Se una macchina ha un manuale per ogni linea, compaiono «Spare parts — Linea 1» e «Spare parts — Linea 2». Dalla scheda di un articolo si può aprire lo stesso manuale e cercare il codice al suo interno.
- **Lettore PDF integrato** (usato anche quando si apre il manuale dalla scheda di un articolo, per poterne cercare il codice):
  - scorrimento col dito e **zoom**;
  - **campo per scrivere il numero di pagina** e saltarci;
  - **scrollbar laterale** trascinabile per spostarsi rapidamente;
  - **ricerca per parola chiave** dentro il documento (se il PDF è una scansione senza testo, l'app lo segnala);
  - i manuali già aperti vengono **salvati sul telefono**: si riaprono subito e funzionano anche senza rete.
- **Per l'Admin**:
  - aggiungere, modificare ed eliminare pulsanti e gruppi, scegliendo la sezione per pagina iniziale e finale e un'icona (anche scegliendo il file dalla memoria del telefono);
  - **modalità Riordina** dedicata: si tiene premuto e si trascina un banner per cambiarne la posizione, con animazione fluida; lo stesso vale per le macchine nell'elenco;
  - caricare i manuali e le icone delle macchine da Impostazioni → Gestione macchine.
- Per l'Operatore tutta la sezione è in sola lettura.

---

## 8. Interventi: il blocco note della manutenzione

Il quaderno digitale delle soste e dei lavori di manutenzione.

### 8.1 L'elenco

- Due schede: **Da fare** ed **Effettuati**.
- Raggruppato per **giorno** (con possibilità di scegliere il giorno) e filtrabile per **linea** e per **macchina**.
- Un **pallino** accanto agli interventi inseriti da altri e non ancora aperti, che sparisce all'apertura; un **badge con il numero** sul pulsante Interventi della barra segnala quanti sono nuovi. Il controllo avviene all'avvio, ogni minuto e quando si torna nell'app.

### 8.2 Inserire un nuovo intervento

In **tre passi obbligatori**:
1. **Linea** (Linea 1 / Linea 2);
2. **Macchina**;
3. **Intervento**: si scrive il lavoro oppure si sceglie una **scelta rapida** (i lavori ricorrenti già associati a quella combinazione di linea e macchina, gestiti dall'Admin in Impostazioni).

Si può aggiungere una **foto** (ridotta automaticamente dal telefono prima del caricamento). Un intervento si può inserire come «da fare» o come «già effettuato».

### 8.3 Aggiornare l'esito

Aprendo un intervento si può:
- cambiarne lo **stato** (da fare / effettuato) e modificare il testo;
- indicare **l'orario** del lavoro;
- scegliere gli **operatori** che l'hanno eseguito (l'elenco si gestisce in Impostazioni);
- aggiungere **note** sull'esito e sostituire o rimuovere la foto (la foto si apre a tutto schermo con zoom);
- registrare i **ricambi prelevati dal magazzino**: l'app chiede «Hai prelevato ricambi dal magazzino?», si cercano gli articoli con un unico campo (cuscinetti, cinghie e ricambi tecnici insieme), si sceglie quantità e scaffale e i **prelievi vengono scalati dalle giacenze** come un normale prelievo.

### 8.4 PDF degli interventi effettuati

Si genera il PDF di una giornata (o di un periodo):
- organizzato **per linea e, dentro ogni linea, per macchina**, nello stesso ordine dell'app;
- per ogni intervento compare solo il **lavoro effettuato** (niente orari, nomi o note);
- si **sceglie quali interventi includere** e, per ognuno, si vede **l'anteprima della foto** con accanto la scelta di inserirla o no;
- sui telefoni che lo permettono si apre il foglio di condivisione (mail, WhatsApp…), altrimenti il file viene scaricato.

---

## 9. Report (solo Admin)

Si apre dalle Impostazioni. Un unico filtro di periodo vale per tutta la pagina: **ultimi 7 giorni, 30 giorni, 3, 6, 12 mesi, Totale** oppure **Personalizzato**, con un calendario disegnato nello stile dell'app dove si scelgono le date.

**Vita utile dei ricambi**
- Ogni prelievo conta come **una sostituzione**, qualunque sia la quantità. Prelievi dello stesso ricambio a meno di un'ora l'uno dall'altro contano come una sola.
- Si confronta lo stesso ricambio **nello stesso posto**: per i cuscinetti articolo + linea + macchinario + punto di utilizzo, per cinghie e ricambi tecnici articolo + linea.
- La **durata** è il numero di giorni tra una sostituzione e la successiva; la **vita media** è la media delle durate precedenti.
- Se una sostituzione arriva **prima della media** (con una tolleranza del 10%), viene segnalata come **anticipata**: è il segnale che qualcosa nella macchina o nel pezzo non va.
- Servono almeno 3 prelievi dello stesso ricambio nello stesso posto per avere un confronto sensato.

**Esportazione in Excel**: un pulsante crea un file con due fogli, *Depositi* e *Prelievi*, relativi al periodo scelto.

**Elenco dei movimenti**
- Due schede, **Depositi** e **Prelievi**, con lo stesso selettore scorrevole del Magazzino.
- Toccando una voce si espande la scheda con tutte le informazioni: articolo, quantità, chi, quando, linea, macchina e punto di utilizzo.

---

## 10. Impostazioni

Si aprono dall'ingranaggio in alto. Le voci di gestione sono riservate all'Admin.

**Gestione (Admin)**
- **Report**: vedi sopra.
- **Gestione utenti**: elenco degli utenti registrati con email e ruolo; si imposta nome e cognome di ciascuno, che compaiono nei report e nello storico al posto dell'email.
- **Gestione macchine**: aggiungere e rimuovere macchine (compaiono nel form articolo, nei filtri e nei Manuali) e caricare i manuali operatore, i manuali ricambi per linea e le icone.
- **Gestione scaffali**: aggiungere e rimuovere scaffali, ciascuno assegnato a un'area (**Magazzino** o **Ufficio tecnico**); si vede quanti articoli contiene ognuno. Rimuovendo uno scaffale, le quantità restano all'articolo, semplicemente senza scaffale.
- **Inventario**: conteggio guidato scaffale per scaffale, con correzioni tracciate. Il dettaglio è nella sezione [Inventario](#inventario-solo-admin) qui sotto.
- **Interventi rapidi**: i lavori ricorrenti per linea e macchina che compaiono come scelte rapide negli Interventi.
- **Operatori**: l'elenco delle persone assegnabili agli interventi.
- **Carica da Excel**: import dell'inventario per categoria (Cuscinetti, Cinghie, Ricambi tecnici). Le colonne sono lette per posizione; la riga di intestazione è facoltativa. Più righe con lo stesso codice significano più scaffali per lo stesso articolo. Gli articoli già presenti vengono aggiornati, quelli nuovi creati.

### Inventario (solo Admin)

Serve a riallineare le giacenze con quello che c'è davvero sugli scaffali, **uno scaffale alla volta**, e a lasciare traccia di ogni correzione. Si apre da Impostazioni → Inventario.

**Scaffali.** L'elenco è diviso per area (Magazzino, Ufficio tecnico) e per serie (SA, SB, SD…). Per ogni scaffale si vede il numero di articoli e quando è stato inventariato l'ultima volta: *mai inventariato* (rosso), *da rifare* se sono passati più di 90 giorni (arancione) oppure la data dell'ultimo inventario (verde). Gli inventari lasciati a metà compaiono con «In corso» e il numero di articoli già contati.

**Come si conta.** Scelto lo scaffale, si decide se **vedere le quantità attese** (più veloce) oppure contare **alla cieca** (più rigoroso). Poi si apre l'elenco degli articoli che dovrebbero esserci:
- **✓** conferma con un tocco che la quantità attesa è giusta;
- **− / +** o la scrittura diretta correggono la quantità contata;
- **0** segnala che l'articolo non c'è;
- **Scansiona** apre la fotocamera: il codice a barre porta direttamente alla riga dell'articolo;
- un articolo trovato sullo scaffale ma non in elenco si aggiunge con **Scansiona** o **Aggiungi**, dopo conferma (le sue quantità sugli altri scaffali non cambiano);
- **Da contare** nasconde le righe già fatte.

Il conteggio si salva da solo sul telefono: si può chiudere l'app e riprendere in seguito.

**Riepilogo e chiusura.** Concludendo, il riepilogo mostra articoli confermati, corretti, aggiunti e non trovati, con la differenza di ciascuno. Gli articoli non contati risultano a zero solo dopo una conferma esplicita. Se ci sono differenze si sceglie un **motivo** (conteggio errato, prelievo non registrato, deposito non registrato, merce mancante, altro). Solo a questo punto le giacenze cambiano, tutte insieme: o si applica tutto o non cambia nulla.

**Tracciabilità.** Ogni inventario chiuso registra chi l'ha fatto, quando, la modalità, il motivo e, per ogni articolo, la quantità attesa, quella contata e la differenza. Queste rettifiche **non sono depositi né prelievi**: non alterano i totali del Report né il calcolo della vita utile dei ricambi.

**Storico.** La scheda *Storico* elenca gli ultimi inventari; toccandone uno si vedono le differenze articolo per articolo. Il pulsante **Excel** esporta l'elenco degli inventari e il dettaglio di tutte le righe.

**Impostazioni dell'app (tutti)**
- **Suoni** e **Vibrazione**: ogni azione ha un feedback sonoro e aptico leggero (attivabili e disattivabili).
- **Aggiornamenti**: ricarica i dati e controlla se esiste una nuova versione dell'app.
- **Cache PDF**: i manuali già aperti restano sul telefono; da qui si può svuotare la cache per liberare spazio.

**Zona pericolosa (Admin)**
- **Gestione cronologia movimenti**: permette di rivedere ed **eliminare singoli movimenti** (anche più di uno alla volta, filtrando per Depositi o Prelievi) di uno o più articoli. La giacenza attuale non cambia: si tocca solo lo storico.

**Esci**: disconnessione dall'account.

---

## 11. Funzioni che si trovano ovunque

- **Ricerca globale**: il campo «Cerca articolo…» in alto è disponibile in ogni sezione e mostra i risultati mentre si scrive; il pulsante fotocamera accanto permette di scansionare un codice e poi aprirne la scheda o fare subito un deposito o un prelievo.
- **Installabile come app**: da Chrome (Android e desktop) o Safari (iPhone, «Aggiungi a Home») compare con la sua icona, a tutto schermo.
- **Pensata per il telefono**: pulsanti grandi, cassetti che salgono dal basso e si chiudono trascinandoli verso il basso, margini che si adattano a notch e indicatore home, e una versione più compatta per il computer.
- **Animazioni coerenti**: tutte le finestre usano la stessa struttura e gli stessi tempi di apertura e chiusura; i selettori hanno un riempimento blu che scorre, le schede si adattano in altezza con una transizione.
- **Tasto indietro** gestito su ogni livello aperto.
- **Funziona anche con poca rete**: guscio dell'app, articoli già visti, manuali già aperti e movimenti in coda restano disponibili.
- **Curiosità**: una pressione prolungata di tre secondi sul logo della schermata di accesso fa comparire la mascotte. L'ingranaggio del logo si può anche lanciare col dito.

---

## 12. Informazioni tecniche

- **Frontend**: HTML, CSS e JavaScript puri (moduli ES nativi), senza bisogno di compilazione. Tailwind e le librerie esterne (Supabase JS, JsBarcode, Lucide per le icone, jsPDF, html5-qrcode, SheetJS, pdf.js, pdf-lib) sono caricate da CDN, quelle più pesanti solo al momento del bisogno.
- **Backend**: [Supabase](https://supabase.com) — autenticazione, database PostgreSQL con permessi per riga (RLS), funzioni SQL per i movimenti e gli import, archiviazione dei manuali e delle foto.
- **Pubblicazione**: sito statico su Cloudflare Pages collegato a GitHub; ogni modifica sul ramo principale viene pubblicata in automatico. Serve HTTPS (la fotocamera funziona solo su connessioni sicure).
- **Aggiornamenti**: il service worker conserva in cache i file dell'app per l'uso rapido e offline; a ogni modifica se ne incrementa la versione, così i telefoni scaricano i file nuovi.
- **Sviluppo locale**: basta un server statico, ad esempio `python3 -m http.server 8080` o `npx serve .`, e poi `http://localhost:8080`.
- **Primo utente Admin**: si crea l'utente da Supabase (Authentication → Users) e lo si promuove da SQL impostando il ruolo `admin` nella tabella `profiles`.
- **Sicurezza**: vedi `SECURITY.md`.
