// =============================================================
// login-video.js — video di presentazione della schermata di accesso (al posto del vecchio carosello)
// Parte da solo, senza audio e in ciclo, appena la schermata di accesso è a vista (all'apertura dell'app).
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
  let visible = false; // il riquadro è davvero a vista
  let manual = null;   // null = automatico · true/false = scelta fatta con un tocco

  const sync = () => {
    const auto = !reduceMotion.matches; // parte appena la schermata è a vista, senza aspettare l'ingranaggio
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
    // Nuova presentazione della schermata (riparte il logo): il video riparte da capo e parte subito
    view.addEventListener('animationstart', (e) => {
      if (e.animationName !== 'mate-rise') return;
      manual = null;
      video.pause();
      try { video.currentTime = 0; } catch (_) { /* non ancora pronto */ }
      sync();
    });
  }

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
