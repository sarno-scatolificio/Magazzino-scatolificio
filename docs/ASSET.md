# Registro delle immagini e del materiale grafico

Serve a documentare, per ogni file grafico del repository, **da dove viene e chi ne detiene i diritti**.
Le informazioni sotto sono state fornite dall'autore dell'app; le colonne «Da fare» indicano cosa va ancora
chiarito o conservato prima della cessione. Non è un parere legale (vedi `docs/MODELLI-LEGALI.md`).

| File | Dove è usato | Origine dichiarata | Da fare |
|---|---|---|---|
| `assets/icons/logo-mate.png`, `logo-m.png`, `logo-text.png`, `logo-sub.png`, `logo-gear.png` | logo animato nella schermata di accesso | Logo MATE creato con Gemini (Google). I livelli separati sono stati ricavati e rielaborati in fase di sviluppo con l'assistente Claude (Anthropic) | conservare i prompt e le versioni successive del logo (documentano l'apporto creativo umano); indicare quale account Gemini è stato usato (personale o aziendale); ricerca di anteriorità prima di registrare «MATE» come marchio |
| `assets/icons/icon-*.png`, `apple-touch-icon.png`, `favicon*.png`, `favicon.ico`, scorciatoie del manifest | installazione come app, scheda del browser | Derivate dal logo e dai colori dell'app, elaborate in fase di sviluppo | seguono la sorte del logo |
| `assets/icons/mascotte.png` | schermata di accesso (pressione prolungata sul logo) | Creata con Gemini | indicare **chi è la persona ritratta** (se reale e riconoscibile serve la sua liberatoria, anche per l'uso da parte dell'azienda); conservare i prompt; indicare l'account Gemini usato |
| `assets/carousel/reparto.png`, `forno.png`, `uniformer.jpg`, `saldatrice.jpg`, `macchina.jpg` | carosello nella schermata di accesso | Foto scattate dall'autore dell'app nell'ambito delle proprie mansioni, poi ripulite e migliorate con Gemini | verificare che non si vedano persone riconoscibili; indicare l'account Gemini usato; verificare che le foto originali non contengano informazioni riservate dello stabilimento |
| `assets/login/video-login.mp4`, `video-login-poster.jpg` | video nella schermata di accesso (al posto del carosello) | **da indicare**: file originale `201927.mp4`, compresso e ottimizzato per il web in fase di sviluppo; il fotogramma di anteprima è ricavato dal video stesso | indicare chi ha girato il video e con quale licenza (se è un video di archivio/stock, conservare la licenza); verificare che non si vedano persone riconoscibili o informazioni riservate dello stabilimento |
| `assets/icons/favicon.jpg` | non richiamato da nessun file | — | eliminare se non serve |

## Esempio di riga da compilare per ogni nuova immagine
`percorso del file` — dove è usata — chi l'ha creata, con quale strumento e in che data — licenza o liberatoria
(conservare il documento) — eventuali limiti d'uso.

## Foto e PDF fuori dal repository
Le foto degli interventi e i PDF dei manuali stanno nello storage di Supabase, non qui. I manuali sono
documentazione dei costruttori delle macchine: l'uso interno è normalmente coperto dall'acquisto della macchina,
ma va verificato caso per caso prima di ridistribuirli all'esterno dell'azienda.
