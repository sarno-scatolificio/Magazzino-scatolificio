// =============================================================
// login-video.js — video di presentazione della schermata di accesso (al posto del vecchio carosello)
// Parte da solo, senza audio e in ciclo, quando l'ingranaggio del logo inizia a girare (come faceva il carosello).
// Si ferma da solo quando la schermata non si vede più (dopo l'accesso, scheda in secondo piano) per non
// scaricare e decodificare video inutilmente. Un tocco lo mette in pausa o lo riprende.
// Con «riduci animazioni» attive non parte da solo: si vede l'immagine di anteprima e si avvia con un tocco.
// Se il file non si carica, il riquadro sparisce senza lasciare buchi.
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

  box.addEventListener('click', () => {
    manual = video.paused;
    sync();
  });

  // File mancante o non riproducibile: via il riquadro intero
  video.addEventListener('error', () => box.remove());
  if (video.error) box.remove(); // l'errore può essere già avvenuto prima che questo codice partisse
  sync();
}

initLoginVideo();
