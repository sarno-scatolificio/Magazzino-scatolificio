// =============================================================
// login-video.js — video di presentazione della schermata di accesso (al posto del vecchio carosello)
// Parte da solo, senza audio e in ciclo, appena la schermata di accesso è a vista (all'apertura dell'app), dietro la carta
// millimetrata; quando l'ingranaggio inizia a girare la carta si apre dal centro verso i lati e scopre il video.
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

  const card = box.parentElement;
  const reveal = () => {
    card?.classList.add('is-reveal'); // la carta millimetrata si divide dal centro e scopre il video
    try { video.currentTime = 0; } catch (_) { /* non ancora pronto */ } // il video è già in riproduzione dietro la carta: riparte da capo
    sync();
  };
  if (view) {
    view.addEventListener('animationstart', (e) => {
      if (e.animationName === 'mate-rise') {
        // Nuova presentazione della schermata (riparte il logo): la carta si richiude di scatto e il video riparte da capo
        if (card) {
          card.classList.add('paper-instant');
          card.classList.remove('is-reveal');
          void card.offsetWidth;
          requestAnimationFrame(() => card.classList.remove('paper-instant'));
        }
        manual = null;
        video.pause();
        try { video.currentTime = 0; } catch (_) { /* non ancora pronto */ }
        sync();
      } else if (e.animationName === 'mate-gear-start') {
        reveal();
      }
    });
    // Se la sequenza era già arrivata alla rotazione prima che questo codice partisse, non aspetta oltre
    const gearAnim = view.querySelector('.mate-gear')?.getAnimations?.().find((a) => a.animationName === 'mate-gear-start');
    if (gearAnim && gearAnim.currentTime > 0) card?.classList.add('is-reveal');
  }

  // Il video è lo sfondo della scheda del logo: un tocco sulla scheda (fuori dal logo, che ha i suoi gesti) lo ferma o lo riprende
  (box.parentElement || box).addEventListener('click', (e) => {
    if (e.target.closest?.('.mate-logo-wrap')) return;
    manual = video.paused;
    sync();
  });

  // File mancante o non riproducibile: via il riquadro intero
  const noVideo = () => { card?.classList.add('no-video'); box.remove(); };
  video.addEventListener('error', noVideo);
  if (video.error) noVideo(); // l'errore può essere già avvenuto prima che questo codice partisse
  sync();
}

initLoginVideo();
