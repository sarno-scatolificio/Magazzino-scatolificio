# Suoni della barra di navigazione

Metti qui quattro file audio con **questi nomi** (basta un formato: `.mp3`, `.ogg` o `.wav`):

| File | Quando suona | Che suono cercare |
|---|---|---|
| `movimenti.mp3` | tocco su Movimenti | scorrimento/«swish» breve, oppure scatolo appoggiato |
| `magazzino.mp3` | tocco su Magazzino | serratura / lucchetto / chiavistello che scatta (lock click, latch) |
| `manuali.mp3` | tocco su Manuali | pagine di libro sfogliate (page turn, book flip) |
| `interventi.mp3` | tocco su Interventi | penna che scrive su carta (pen writing paper) |

Se un file manca, l'app usa il suono generato al volo: non si rompe niente.

## Come scegliere e preparare i file
- Durata **0,2–0,8 secondi**, senza silenzio all'inizio (altrimenti il suono parte in ritardo).
- Volume simile tra i quattro; mp3 mono a 96–128 kbps basta (pochi KB l'uno).
- Dopo averli aggiunti, rilascia l'app: il service worker li mette in cache da solo al primo avvio.

## Dove trovarli (controlla SEMPRE la licenza del singolo file: l'app è per un'azienda)
- **Pixabay → Sound effects** e **Mixkit → Sound effects**: licenza propria, uso commerciale consentito senza attribuzione.
- **Freesound**: scegli solo file con licenza **CC0** (nessun obbligo); quelli CC-BY richiedono di citare l'autore.
- **Sonniss GDC Game Audio Bundle**: librerie professionali gratuite, uso commerciale consentito.
Conserva qui accanto una nota con fonte e licenza di ciascun file.
