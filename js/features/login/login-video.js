// =============================================================
// login-video.js — video di presentazione della schermata di accesso (al posto del vecchio carosello)
// Parte da solo, senza audio e in ciclo, quando l'ingranaggio del logo inizia a girare (come faceva il carosello).
// Si ferma da solo quando la schermata non si vede più (dopo l'accesso, scheda in secondo piano) per non
// scaricare e decodificare video inutilmente. Un tocco lo mette in pausa o lo riprende.
// Con «riduci animazioni» attive non parte da solo: si vede l'immagine di anteprima e si avvia con un tocco.
// Se il file non si carica, resta lo sfondo blu della scheda.
// File: assets/login/video-login.mp4 (sotto i 25 MiB, limite di Cloudflare Pages) + anteprima video-login-poster.jpg
// =============================================================
import './login-gear.js'; // l'ingranaggio del logo si lancia col dito

function initLoginVideo() {
  const box = document.getElementById('login-video-box');
  const video = box?.querySelector('video');
  if (!box || !video) return;
  const view = document.getElementById('auth-view');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  video.muted = true; // alcuni browser ignorano l'attributo se non lo si imposta anche qui
  let started = false; // l'ingranaggio ha iniziato a girare
  let visible = false; // il riquadro è davvero a vista
  let manual = null;   // null = automatico · true/false = scelta fatta con un tocco

  const sync = () => {
    const auto = !reduceMotion.matches && started;
    const want = (manual === null ? auto : manual) && visible && !document.hidden;
    if (want) video.play().catch(() => { /* avvio negato dal browser: resta l'anteprima */ });
    else if (!video.paused) video.pause();
  };

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(box);
  document.addEventListener('visibilitychange', sync);
  reduceMotion.addEventListener?.('change', sync);

  if (view) {
    view.addEventListener('animationstart', (e) => {
      if (e.animationName === 'mate-rise') {
        // nuova presentazione della schermata (parte il logo): il video riparte da capo, dopo l'ingranaggio
        started = false;
        manual = null;
        video.pause();
        try { video.currentTime = 0; } catch (_) { /* non ancora pronto */ }
      } else if (e.animationName === 'mate-gear-start') {
        started = true;
        sync();
      }
    });
    // Se la sequenza era già arrivata alla rotazione prima che questo codice partisse, non aspetta oltre
    const gearAnim = view.querySelector('.mate-gear')?.getAnimations?.().find((a) => a.animationName === 'mate-gear-start');
    if (gearAnim && gearAnim.currentTime > 0) started = true;
  }
  if (reduceMotion.matches) started = false;

  // Il video è lo sfondo della scheda del logo: un tocco sulla scheda (fuori dal logo, che ha i suoi gesti) lo ferma o lo riprende
  (box.parentElement || box).addEventListener('click', (e) => {
    if (e.target.closest?.('.mate-logo-wrap')) return;
    manual = video.paused;
    sync();
  });

  // File mancante o non riproducibile: via il riquadro intero
  video.addEventListener('error', () => box.remove());
  if (video.error) box.remove(); // l'errore può essere già avvenuto prima che questo codice partisse
  sync();
}

initLoginVideo();

// Banner video della barra laterale (solo desktop ≥1024px): stesso video, senza filtri, proporzioni originali.
// Il file si assegna solo su schermi larghi (su telefono non si scarica); parte da solo quando la barra si vede,
// si ferma quando non si vede; un tocco lo ferma o lo riprende; con «riduci animazioni» resta l'anteprima.
function initNavVideo() {
  const box = document.getElementById('nav-video-box');
  const video = document.getElementById('nav-video');
  if (!box || !video) return;
  const wide = window.matchMedia('(min-width: 1024px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  video.muted = true;
  let visible = false;
  let manual = null;

  const sync = () => {
    if (!wide.matches) { if (!video.paused) video.pause(); return; }
    if (!video.getAttribute('src') && video.dataset.src) video.src = video.dataset.src;
    const want = (manual === null ? !reduceMotion.matches : manual) && visible && !document.hidden;
    if (want) video.play().catch(() => { /* avvio negato: resta l'anteprima */ });
    else if (!video.paused) video.pause();
  };

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(box);
  document.addEventListener('visibilitychange', sync);
  wide.addEventListener?.('change', sync);
  reduceMotion.addEventListener?.('change', sync);
  box.addEventListener('click', () => { manual = video.paused; sync(); });
  video.addEventListener('error', () => { if (video.getAttribute('src')) box.remove(); });
  sync();
}

initNavVideo();
