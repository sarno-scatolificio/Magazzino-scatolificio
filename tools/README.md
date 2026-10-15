# Strumenti di sviluppo

Non fanno parte dell'app: servono solo a controllare il codice.

```
cd tools
npm install      # solo la prima volta
npm run check
```

`check.mjs` verifica che gli import siano corretti, che non ci siano nomi usati senza essere definiti,
che il service worker elenchi tutti i file usati dall'app, che gli id cercati nel codice esistano in
`index.html` e che immagini, icone, stile e manifest richiamati da `index.html`, `manifest.json`, dai CSS e dai moduli esistano davvero
(segnala anche i file in `assets/` che nessuno usa). Gira anche da solo su GitHub a ogni push (scheda **Actions**).
