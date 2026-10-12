# Strumenti di sviluppo

Non fanno parte dell'app: servono solo a controllare il codice.

```
cd tools
npm install      # solo la prima volta
npm run check
```

`check.mjs` verifica che gli import siano corretti, che non ci siano nomi usati senza essere definiti,
che il service worker elenchi tutti i file usati dall'app e che gli id cercati nel codice esistano in
`index.html`. Gira anche da solo su GitHub a ogni push (scheda **Actions**).
