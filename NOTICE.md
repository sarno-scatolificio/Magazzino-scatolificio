# Componenti di terzi

L'app usa le librerie e i font elencati sotto, caricati da CDN (non sono copiati in questo repository).
Le licenze indicate sono quelle note al 15 ottobre 2026: **vanno ricontrollate sui siti ufficiali di ciascun
progetto prima della firma della cessione**, perché una libreria può cambiare licenza tra una versione e l'altra.

| Componente | Versione usata | Licenza | Uso nell'app |
|---|---|---|---|
| Tailwind CSS (CDN) | 3.4.17 | MIT | stile |
| Supabase JS | 2.x | MIT | accesso al database e all'autenticazione |
| JsBarcode | 3.11.6 | MIT | generazione dei codici a barre |
| jsPDF | 2.5.2 | MIT | PDF degli interventi e delle etichette |
| pdf-lib | 1.17.1 | MIT | unione e modifica dei PDF |
| pdf.js (pdfjs-dist) | 3.11.174 | Apache-2.0 | lettura interna dei manuali PDF |
| SheetJS (xlsx, edizione community) | 0.18.5 | Apache-2.0 | import ed export Excel |
| html5-qrcode | 2.3.8 | Apache-2.0 | scanner con fotocamera |
| Lucide | 1.11.0 | ISC | icone |
| Space Grotesk, Inter, JetBrains Mono, Courier Prime (Google Fonts) | — | SIL Open Font License 1.1 | caratteri |
| acorn (solo in `tools/`, non fa parte dell'app) | — | MIT | controlli automatici |

Gli obblighi di queste licenze (MIT, ISC, Apache-2.0, OFL) consistono in sostanza nel mantenere l'indicazione
di copyright e di licenza quando si ridistribuisce il codice della libreria. Poiché l'app le carica dai
rispettivi CDN senza copiarle, questo file è sufficiente come elenco; se in futuro una libreria venisse
copiata nel repository, andrà conservato anche il suo testo di licenza.

Immagini, logo e mascotte non sono componenti di terzi: la loro origine è nel registro `docs/ASSET.md`.
