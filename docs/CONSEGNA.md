# Guida alla consegna dell'app all'azienda

Documento per chi riceve l'app «Magazzino Scatolificio»: cosa c'è, dove vive, cosa va trasferito e cosa controllare.
Le parti tra [parentesi quadre] vanno compilate al momento della consegna.

## 1. Che cos'è
App web installabile (PWA) per la gestione del magazzino ricambi: articoli, depositi e prelievi con scanner,
manuali PDF delle macchine, interventi, inventario, report. Il codice è HTML, CSS e JavaScript senza compilazione;
i dati stanno su Supabase. La descrizione funzionale completa è nel `README.md`; la struttura dei file è al punto 13.

## 2. Servizi e account da trasferire

| Servizio | A cosa serve | Stato attuale | Da fare alla consegna |
|---|---|---|---|
| GitHub (repository dell'app) | codice, cronologia, controllo automatico a ogni push | intestato a [account attuale] | trasferire il repository a un'organizzazione dell'azienda |
| Cloudflare Pages | pubblicazione del sito (a ogni modifica sul ramo principale) | collegato a GitHub, account [da indicare] | trasferire o ricreare il progetto sull'account aziendale e ricollegarlo al repository |
| Supabase (progetto `ffbwazuikbqkikuybcyp`) | database, accesso utenti, archiviazione manuali e foto | organizzazione [da indicare] | trasferire il progetto a un'organizzazione aziendale (Supabase lo consente dalle impostazioni del progetto) oppure ricrearlo da `database/` e migrare i dati |
| Dominio / indirizzo del sito | indirizzo a cui gli operatori aprono l'app | [da indicare] | intestarlo all'azienda |
| CDN esterni (jsDelivr, unpkg, Tailwind, Google Fonts) | librerie e font | nessun account | nulla; elenco in `NOTICE.md` |

Se si cambia indirizzo del progetto Supabase vanno aggiornati `js/data/supabase-client.js` (indirizzo e chiave
pubblica) e `_headers` (direttiva `connect-src`), poi si incrementa la versione della cache in `service-worker.js`.

## 3. Chiavi e segreti
- Nel repository c'è solo la chiave **pubblica** (publishable/anon) di Supabase, pensata per stare nel browser;
  la protezione dei dati è affidata alle policy RLS (`database/04-sicurezza-rls.sql`).
- Non ci sono chiavi riservate (service role, password) nel codice: non vanno mai aggiunte.
- Alla consegna, per prudenza: cambiare le password degli utenti Admin e verificare chi ha accesso al progetto
  Supabase, a GitHub e a Cloudflare.

## 4. Dati e archiviazione
- **Database**: fare un backup completo prima di qualsiasi passaggio (pannello Supabase, sezione Database → Backups).
- **File nello storage**: i bucket sono `manuali-macchine`, `manuali-operatore`, `manuali-sezioni-icone`,
  `manuali-temp`, `interventi-foto`. Con il trasferimento del progetto restano al loro posto; se si ricrea il
  progetto vanno copiati a parte (i file non sono nel repository).
- **Utenti**: gli account stanno in Supabase (Authentication). Il ruolo (`admin` o `user`) è nella tabella `profiles`.

## 5. Pubblicazione e aggiornamenti
1. Si modificano i file e, se cambia qualunque file dell'app, si incrementa `CACHE_NAME` in `service-worker.js`.
2. Dalla cartella `tools/`: `npm install` (la prima volta) e `npm run check`. Deve finire con «Controllo superato».
3. Si fa il commit sul ramo principale: Cloudflare Pages pubblica da solo; GitHub Actions ripete il controllo.
4. Ogni nuovo file `.js` va aggiunto all'elenco del service worker, altrimenti l'app non lo avrà offline.

## 6. Punti tecnici da conoscere
- Tailwind è caricato dal CDN (comodo, ma non pensato per la produzione): a lungo termine conviene compilarlo.
- Le librerie dai CDN non hanno gli hash di integrità (SRI): vedi `docs/SECURITY.md`.
- Il ruolo `anon` di Supabase conserva i privilegi di tabella standard (bloccati dalle policy RLS): vedi la nota in
  `database/README.md`.
- Il file `database/` è una fotografia: se si cambia il database, aggiornarla (o passare a migrazioni numerate).

## 7. Privacy (GDPR) — da confermare con chi si occupa di privacy in azienda
L'app tratta dati personali dei dipendenti: email, nome e cognome degli utenti, movimenti di magazzino con
utente e orario, nomi degli operatori e foto degli interventi. Da verificare:
- titolare del trattamento: l'azienda; informativa agli utenti dell'app;
- accordo con Supabase come responsabile del trattamento e regione in cui è ospitato il progetto;
- tempi di conservazione dello storico movimenti e degli interventi;
- eventuali accordi sindacali o regolamenti interni, se l'app registra attività dei lavoratori;
- chi può avere il ruolo di Admin e come si gestiscono ingressi e uscite del personale.

## 8. Diritti e materiale grafico
Vedi `docs/ASSET.md` (origine di logo, mascotte e foto), `docs/MODELLI-LEGALI.md` (bozze di dichiarazione e
liberatoria) e `NOTICE.md` (librerie e font di terzi).

## 9. Checklist di consegna
- [ ] Repository trasferito all'azienda e accessi rivisti
- [ ] Progetto Supabase trasferito (o ricreato e dati migrati) e backup verificato
- [ ] Cloudflare Pages e dominio intestati all'azienda; sito raggiungibile e installabile dal telefono
- [ ] Password Admin cambiate; elenco utenti verificato
- [ ] Dichiarazione sul software firmata (o cessione dei diritti, se necessaria)
- [ ] Liberatoria della persona ritratta nella mascotte; origine di logo, mascotte e foto confermata in `docs/ASSET.md`
- [ ] Licenze di `NOTICE.md` ricontrollate
- [ ] Informativa privacy e accordo con Supabase a posto
- [ ] `npm run check` superato e prova su telefono: accesso, deposito, prelievo, manuali, interventi, uso offline
- [ ] Persona di riferimento in azienda per le future modifiche: [nome]
