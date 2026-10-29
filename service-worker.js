// =============================================================
// service-worker.js — Shell statica in cache per installabilità PWA.
// I dati (Supabase, CDN esterni) passano sempre dalla rete: qui si
// mette in cache solo l'involucro dell'app (HTML/CSS/JS/icone locali).
//
// Strategia: NETWORK-FIRST, non più cache-first. La cache serve solo
// come fallback per l'offline, mai come fonte primaria — così se in
// cache finisce mai una versione rotta o vecchia di un file, non resta
// "incollata" lì per sempre: appena la rete è disponibile la richiesta
// successiva la sovrascrive da sola, senza bisogno di cancellare
// manualmente i dati del sito da Chrome.
//
// Librerie esterne (CDN): l'app le carica da fuori (Supabase, Tailwind,
// lettore codici, icone...). Finché c'è rete il service worker NON le
// tocca: le richiede il browser, come sempre. Ne salva solo una copia in
// background, per poterle servire quando il dispositivo è offline. Se il
// salvataggio non riesce (es. la CSP non consente al SW di scaricarle),
// non succede nulla di grave: semplicemente niente copia offline.
// =============================================================

const CACHE_NAME = 'magazzino-shell-v278';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './css/desktop.css',
  './js/shared/desktop.js',
  './config/tailwind.config.js',
  './manifest.json',
  './js/core/app.js',
  './js/core/auth.js',
  './js/shared/camera.js',
  './js/shared/hold-repeat.js',
  './js/features/movimenti/scanner.js',
  './js/features/movimenti/scanner-desktop.js',
  './js/features/movimenti/scanner-shared.js',
  './js/features/movimenti/scanner-camera.js',
  './js/features/movimenti/scanner-search.js',
  './js/features/movimenti/scanner-result.js',
  './js/features/movimenti/scanner-punti.js',
  './js/features/movimenti/scanner-transaction.js',
  './js/features/movimenti/scanner-idle.js',
  './js/features/magazzino/products.js',
  './js/features/magazzino/products-shared.js',
  './js/features/login/login-gear.js',
  './js/features/magazzino/products-list.js',
  './js/features/magazzino/products-table.js',
  './js/features/magazzino/products-data.js',
  './js/features/magazzino/products-detail.js',
  './js/features/report/dashboard.js',
  './js/shared/toast.js',
  './js/data/supabase.js',
  './js/data/supabase-client.js',
  './js/data/supabase-auth.js',
  './js/data/supabase-products.js',
  './js/data/supabase-machines.js',
  './js/data/supabase-prestiti.js',
  './js/data/supabase-shelves.js',
  './js/data/supabase-shelf-photos.js',
  './js/data/supabase-manuals.js',
  './js/data/supabase-transactions.js',
  './js/data/supabase-activity.js',
  './js/data/supabase-push.js',
  './js/core/push.js',
  './js/shared/picker.js',
  './js/features/impostazioni/users.js',
  './js/features/impostazioni/activity-log.js',
  './js/features/impostazioni/push-settings.js',
  './js/features/impostazioni/machines.js',
  './js/features/impostazioni/shelves.js',
  './js/features/movimenti/movements.js',
  './js/features/movimenti/prestiti.js',
  './js/features/magazzino/low-stock.js',
  './js/shared/ui-modal.js',
  './js/shared/ui-select.js',
  './js/shared/feedback.js',
  './js/shared/input-clear.js',
  './js/shared/ui-utils.js',
  './js/shared/html-utils.js',
  './js/core/offline-queue.js',
  './js/core/nav-history.js',
  './js/shared/global-search.js',
  './js/shared/search-dock.js',
  './js/features/manuali/pdf-cache.js',
  './js/features/impostazioni/history-admin.js',
  './js/features/interventi/interventi.js',
  './js/features/interventi/interventi-shared.js',
  './js/features/interventi/interventi-photo.js',
  './js/features/interventi/interventi-list.js',
  './js/features/interventi/interventi-unseen.js',
  './js/features/interventi/interventi-new.js',
  './js/features/interventi/interventi-ricambi.js',
  './js/features/interventi/interventi-detail.js',
  './js/features/interventi/interventi-desktop.js',
  './js/features/interventi/interventi-operatori-pick.js',
  './js/features/impostazioni/inventory.js',
  './js/features/impostazioni/inventory-camera.js',
  './js/features/impostazioni/shelf-photos.js',
  './js/shared/photo-cropper.js',
  './js/shared/shelf-photo-viewer.js',
  './js/data/supabase-inventory.js',
  './js/features/interventi/verbi-passato.js',
  './js/features/interventi/interventi-pdf-sheet.js',
  './js/features/interventi/interventi-pdf-todo.js',
  './js/features/interventi/interventi-data.js',
  './js/features/interventi/interventi-pdf.js',
  './js/features/interventi/interventi-rapidi.js',
  './js/features/magazzino/punti-utilizzo.js',
  './js/shared/time-picker.js',
  './js/features/manuali/manuals.js',
  './js/features/manuali/manuals-browser.js',
  './js/features/manuali/manuals-shared.js',
  './js/features/manuali/manuals-list.js',
  './js/features/manuali/manuals-icon.js',
  './js/features/manuali/manuals-detail.js',
  './js/features/manuali/manuals-desktop.js',
  './js/features/manuali/manuals-external.js',
  './js/features/manuali/manuals-groups.js',
  './js/features/manuali/manuals-spare.js',
  './js/features/manuali/manuals-reorder.js',
  './js/features/manuali/manuals-section-modal.js',
  './js/features/manuali/manuals-data.js',
  './js/features/manuali/manuals-search.js',
  './js/features/login/login-video.js',
  './js/features/login/login-mascotte.js',
  './assets/icons/mascotte.png',
  './js/features/report/lifespan.js',
  './js/shared/date-range-modal.js',
  './assets/login/video-login-poster.jpg',
  './assets/icons/logo-mate.png',
  './assets/icons/logo-m.png',
  './assets/icons/logo-gear.png',
  './assets/icons/logo-text.png',
  './assets/icons/logo-sub.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon.ico',
  './assets/icons/favicon-16.png',
  './assets/icons/favicon-32.png',
];

// Host esterni da cui l'app carica librerie e font: solo questi vengono
// salvati in cache, tutto il resto (Supabase API, ecc.) passa sempre dalla rete.
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/** Salva in cache solo risposte utili (anche "opaque" dei tag <script> cross-origin), mai i contenuti parziali (206). */
function isCacheable(response) {
  return response && response.status !== 206 && (response.ok || response.type === 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Promise.allSettled invece di cache.addAll: se un singolo file manca o
      // fallisce (es. 404), non deve compromettere la cache di tutti gli altri.
      Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] impossibile mettere in cache', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // La cache dei manuali PDF (pdf-cache.js) è dell'utente: sopravvive agli aggiornamenti dell'app
      Promise.all(keys.filter((key) => key !== CACHE_NAME && !key.startsWith('magazzino-manuali-pdf')).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Il video (20 MB) lo gestisce il browser da solo, a pezzi (richieste Range): mai intercettato né salvato in cache
  if (request.destination === 'video' || request.headers.has('range')) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = CDN_HOSTS.includes(url.hostname);

  // Solo la shell statica dell'app e le librerie/font dei CDN elencati.
  // Tutto il resto (Supabase, POST/RPC, altri domini) va sempre in rete, mai intercettato.
  if (!isSameOrigin && !isCdn) return;

  if (isCdn) {
    if (self.navigator.onLine === false) {
      // Offline: si serve la copia salvata, se c'è
      event.respondWith(caches.match(request).then((cached) => cached || Response.error()));
    } else {
      // Online: nessuna intercettazione, la richiesta la fa il browser. Il SW
      // si limita a salvare una copia in background (solo la prima volta).
      event.waitUntil(saveCdnCopy(request));
    }
    return;
  }

  event.respondWith(
    // Rete come prima scelta: qualsiasi risposta valida aggiorna subito la
    // cache, cosí un file rotto o vecchio non può mai restare "bloccato"
    // come fonte primaria — solo l'offline reale ripiega sulla cache.
    fetchAndCache(request).catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return cached;
        // Nulla in cache e rete assente: per una navigazione di pagina,
        // ripiega sulla shell dell'app (index.html) così l'app si apre
        // comunque invece di mostrare una schermata di errore.
        if (request.mode === 'navigate') {
          return caches.match('./index.html').then((fallback) => fallback || Response.error());
        }
        return Response.error();
      })
    )
  );
});

/** Salva in background una copia di una risorsa CDN per l'uso offline; non fa mai danni se fallisce. */
async function saveCdnCopy(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(request)) return; // già salvata
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response);
  } catch (err) {
    /* copia offline non disponibile: la pagina funziona comunque */
  }
}

function fetchAndCache(request) {
  // cache: 'no-cache' = si chiede sempre al server se il file è cambiato (risposta 304 leggera se è uguale):
  // senza, la cache HTTP del browser poteva servire per un po' una versione appena sostituita di un file.
  return fetch(request, { cache: 'no-cache' }).then((response) => {
    if (isCacheable(response)) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
    }
    return response;
  });
}

// =============================================================
// NOTIFICHE PUSH (nuovi interventi da effettuare)
// =============================================================
// Le invia la edge function «notify-nuovo-intervento». Il testo (chi ha inserito l'intervento + descrizione)
// arriva già pronto nel messaggio. Toccando la notifica l'app si apre direttamente su quell'intervento.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Nuovo intervento da effettuare';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/favicon-32.png',
      tag: data.tag || undefined, // una sola notifica per intervento: un invio ripetuto non la duplica
      data: { id: data.id || null, url: data.url || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id, url } = event.notification.data || {};
  const target = new URL(url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // App già aperta: la si porta davanti e le si dice quale intervento aprire
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if (id) client.postMessage({ type: 'open-intervento', id });
          return;
        }
      }
      // App chiusa: si apre con l'intervento indicato nell'indirizzo (?intervento=...)
      await self.clients.openWindow(target);
    })()
  );
});
