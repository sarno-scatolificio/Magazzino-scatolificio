// =============================================================
// interventi-photo.js — Foto: compressione sul telefono e visualizzazione a tutto schermo con zoom
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { $, els } from './interventi-shared.js';
import { closeOverlay, openOverlay } from '../../shared/ui-utils.js';
import feedback from '../../shared/feedback.js';
import { toastError } from '../../shared/toast.js';

// ---------------------------------------------------------------
// FOTO: compressione lato telefono (max 1600 px, JPEG) prima del caricamento
// ---------------------------------------------------------------
async function compressImage(file, maxSide = 1600, quality = 0.8) {
  let source;
  let w;
  let h;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = source.width;
    h = source.height;
  } catch (err) {
    // Browser senza createImageBitmap con opzioni: si ripiega su <img> (l'orientamento EXIF è già gestito dal browser)
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      const obj = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(obj);
        resolve(img);
      };
      img.onerror = () => reject(new Error('Impossibile leggere la foto.'));
      img.src = obj;
    });
    w = source.naturalWidth;
    h = source.naturalHeight;
  }
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Impossibile elaborare la foto.');
  return blob;
}

// Aprendo la fotocamera il telefono può chiudere l'app per liberare memoria: al ritorno l'app riparte da capo e la
// foto, che non è mai arrivata alla pagina, è persa. Prima dello scatto si lascia un segno, così alla ripartenza
// l'app riporta agli Interventi e avvisa di rifare la foto, invece di sembrare un'uscita dall'account.
const CAMERA_KEY = 'magazzino_camera_pending';
const CAMERA_MAX_AGE_MS = 15 * 60 * 1000;

function markCameraOpened() {
  try {
    localStorage.setItem(CAMERA_KEY, String(Date.now()));
  } catch (err) {
    /* storage non disponibile: nessun avviso al ritorno */
  }
}

function clearCameraMark() {
  try {
    localStorage.removeItem(CAMERA_KEY);
  } catch (err) {
    /* niente da fare */
  }
}

/** true se l'app è ripartita mentre era aperta la fotocamera (il segno si consuma: vale una volta sola) */
export function takeCameraResume() {
  try {
    const t = Number(localStorage.getItem(CAMERA_KEY));
    localStorage.removeItem(CAMERA_KEY);
    return Number.isFinite(t) && t > 0 && Date.now() - t < CAMERA_MAX_AGE_MS;
  } catch (err) {
    return false;
  }
}

/** Collega Scatta/Galleria/Rimuovi di un blocco foto. `get/set` leggono e scrivono il blob nello stato. */
export function wirePhoto(pfx, onChange) {
  const actions = $(`${pfx}-photo-actions`);
  const preview = $(`${pfx}-photo-preview`);
  const img = $(`${pfx}-photo-img`);
  const cam = $(`${pfx}-photo-input-cam`);
  const gal = $(`${pfx}-photo-input-gal`);

  $(`${pfx}-photo-shoot`).addEventListener('click', () => {
    markCameraOpened();
    cam.click();
  });
  // La pagina non è stata chiusa (fotocamera annullata o scatto riuscito): il segno non serve più
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(clearCameraMark, 3000);
  });
  $(`${pfx}-photo-pick`).addEventListener('click', () => gal.click());
  $(`${pfx}-photo-remove`).addEventListener('click', () => {
    feedback.cancelAction();
    onChange(null, '');
  });
  // La foto già scelta si può ingrandire e zoomare toccandola
  img.classList.add('cursor-zoom-in');
  img.addEventListener('click', () => img.src && openPhotoViewer(img.src));
  const handle = async (input) => {
    clearCameraMark();
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file);
      feedback.photoShutter();
      onChange(blob, URL.createObjectURL(blob));
    } catch (err) {
      feedback.errorAction();
      toastError(err.message || 'Foto non utilizzabile.');
    }
  };
  cam.addEventListener('change', () => handle(cam));
  gal.addEventListener('change', () => handle(gal));

  return {
    show(url) {
      const has = !!url;
      preview.classList.toggle('hidden', !has);
      actions.classList.toggle('hidden', has);
      img.src = has ? url : '';
    },
  };
}

// ---------------------------------------------------------------
// FOTO A TUTTO SCHERMO, con zoom: pizzico con due dita, doppio tocco, rotella, trascinamento
// ---------------------------------------------------------------
const zoom = { scale: 1, x: 0, y: 0, pointers: new Map(), pinch: null, pan: null, tap: null, lastTap: 0 };
const ZOOM_MAX = 6;

export function initPhotoViewer() {
  els.photoModal = $('int-photo-modal');
  els.photoStage = $('int-photo-stage');
  els.photoImg = $('int-photo-full');
  $('int-photo-close').addEventListener('click', () => closeOverlay(els.photoModal));

  const stage = els.photoStage;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture?.(e.pointerId);
    zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    zoom.tap = zoom.pointers.size === 1 ? { t: Date.now(), x: e.clientX, y: e.clientY, moved: false } : null;
    startGesture();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!zoom.pointers.has(e.pointerId)) return;
    zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zoom.tap && Math.hypot(e.clientX - zoom.tap.x, e.clientY - zoom.tap.y) > 8) zoom.tap.moved = true;
    if (zoom.pointers.size >= 2 && zoom.pinch) {
      const [a, b] = [...zoom.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.min(ZOOM_MAX, Math.max(1, (zoom.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / zoom.pinch.dist));
      const c = stageCenter();
      // il punto dell'immagine sotto le dita resta sotto le dita
      zoom.x = mid.x - c.x - ((zoom.pinch.mid.x - c.x - zoom.pinch.x) / zoom.pinch.scale) * scale;
      zoom.y = mid.y - c.y - ((zoom.pinch.mid.y - c.y - zoom.pinch.y) / zoom.pinch.scale) * scale;
      zoom.scale = scale;
      applyZoom();
    } else if (zoom.pointers.size === 1 && zoom.pan && zoom.scale > 1) {
      zoom.x = zoom.pan.x + (e.clientX - zoom.pan.px);
      zoom.y = zoom.pan.y + (e.clientY - zoom.pan.py);
      applyZoom();
    }
  });
  const end = (e) => {
    if (!zoom.pointers.has(e.pointerId)) return;
    const wasSingle = zoom.pointers.size === 1;
    zoom.pointers.delete(e.pointerId);
    if (wasSingle && zoom.tap && !zoom.tap.moved && Date.now() - zoom.tap.t < 300) {
      const now = Date.now();
      if (now - zoom.lastTap < 320) {
        zoom.lastTap = 0;
        toggleZoomAt(e.clientX, e.clientY); // doppio tocco: ingrandisce / torna intero
      } else {
        zoom.lastTap = now;
      }
    }
    zoom.tap = null;
    if (zoom.scale < 1.02) {
      zoom.scale = 1;
      zoom.x = zoom.y = 0;
      applyZoom(true);
    }
    startGesture(); // con un dito rimasto si riparte dal trascinamento
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.min(ZOOM_MAX, Math.max(1, zoom.scale * Math.exp(-e.deltaY * 0.0018))));
    },
    { passive: false }
  );
}

const stageCenter = () => {
  const r = els.photoStage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Fissa il punto di partenza di pizzico o trascinamento con i dita attuali */
function startGesture() {
  const pts = [...zoom.pointers.values()];
  zoom.pinch = null;
  zoom.pan = null;
  if (pts.length >= 2) {
    const [a, b] = pts;
    zoom.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, scale: zoom.scale, x: zoom.x, y: zoom.y };
  } else if (pts.length === 1) {
    zoom.pan = { x: zoom.x, y: zoom.y, px: pts[0].x, py: pts[0].y };
  }
}

/** Porta lo zoom a `scale` tenendo fermo il punto (cx, cy) dello schermo */
function zoomAt(cx, cy, scale, animated = false) {
  const c = stageCenter();
  const k = scale / zoom.scale;
  zoom.x = cx - c.x - (cx - c.x - zoom.x) * k;
  zoom.y = cy - c.y - (cy - c.y - zoom.y) * k;
  zoom.scale = scale;
  if (scale <= 1.02) {
    zoom.scale = 1;
    zoom.x = zoom.y = 0;
  }
  applyZoom(animated);
}

function toggleZoomAt(cx, cy) {
  zoomAt(cx, cy, zoom.scale > 1.05 ? 1 : 2.6, true);
}

/** Applica lo zoom tenendo l'immagine dentro lo schermo (niente bordi vuoti quando è ingrandita) */
function applyZoom(animated = false) {
  const img = els.photoImg;
  const stage = els.photoStage.getBoundingClientRect();
  const maxX = Math.max(0, (img.offsetWidth * zoom.scale - stage.width) / 2);
  const maxY = Math.max(0, (img.offsetHeight * zoom.scale - stage.height) / 2);
  zoom.x = Math.min(maxX, Math.max(-maxX, zoom.x));
  zoom.y = Math.min(maxY, Math.max(-maxY, zoom.y));
  img.style.transition = animated ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
  img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
}

/** Apre la foto a tutto schermo, sempre intera all'inizio */
export function openPhotoViewer(url) {
  zoom.scale = 1;
  zoom.x = zoom.y = 0;
  zoom.pointers.clear();
  zoom.lastTap = 0;
  els.photoImg.style.transition = 'none';
  els.photoImg.style.transform = '';
  els.photoImg.src = url;
  openOverlay(els.photoModal);
}
