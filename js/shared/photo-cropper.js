// =============================================================
// photo-cropper.js — Ritaglio, rotazione e compressione di una foto sul telefono.
// openPhotoCropper(file) mostra la foto a schermo intero con un riquadro di ritaglio (si sposta e si ridimensiona
// dai lati e dagli angoli), i pulsanti per ruotare di 90° e un cursore per raddrizzare fino a ±45°.
// Alla conferma restituisce la foto ritagliata e già ridotta (lato massimo 1600 px, JPEG, circa 350 KB al massimo),
// pronta per essere caricata.
// =============================================================

import { openOverlay, closeOverlay, modalCloseMs } from './ui-utils.js';
import { toastError } from './toast.js';
import feedback from './feedback.js';

const MAX_SIDE = 1600; // lato lungo massimo della foto finale
const TARGET_BYTES = 350 * 1024; // peso a cui si punta: si abbassa la qualità, poi le dimensioni, finché ci sta
const HANDLE_HIT = 26; // raggio (px) in cui si afferra una maniglia
const MIN_RECT = 48; // lato minimo (px) del riquadro di ritaglio

/** Legge il file in un'immagine disegnabile, rispettando l'orientamento EXIF */
async function decodeImage(file) {
  try {
    const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source, width: source.width, height: source.height, close: () => source.close?.() };
  } catch (err) {
    // Browser senza createImageBitmap con opzioni: si ripiega su <img> (l'orientamento EXIF lo gestisce già il browser)
    const source = await new Promise((resolve, reject) => {
      const img = new Image();
      const obj = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(obj);
        resolve(img);
      };
      img.onerror = () => reject(new Error('Impossibile leggere la foto.'));
      img.src = obj;
    });
    return { source, width: source.naturalWidth, height: source.naturalHeight, close: () => {} };
  }
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

/** Comprime l'immagine in JPEG: abbassa la qualità fino a 0.55, poi riduce le dimensioni, finché pesa meno di targetBytes */
export async function compressCanvas(canvas, { targetBytes = TARGET_BYTES } = {}) {
  let c = canvas;
  let q = 0.82;
  let blob = null;
  for (let i = 0; i < 10; i++) {
    blob = await toBlob(c, q);
    if (!blob) throw new Error('Impossibile elaborare la foto.');
    if (blob.size <= targetBytes) break;
    if (q > 0.58) {
      q = Math.max(0.55, q - 0.09);
    } else {
      const smaller = document.createElement('canvas');
      smaller.width = Math.max(1, Math.round(c.width * 0.85));
      smaller.height = Math.max(1, Math.round(c.height * 0.85));
      const sctx = smaller.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(c, 0, 0, smaller.width, smaller.height);
      c = smaller;
    }
  }
  return { blob, width: c.width, height: c.height };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * @param {File|Blob} file
 * @returns {Promise<{ blob: Blob, width: number, height: number } | null>} null se l'utente annulla
 */
export function openPhotoCropper(file, { title = 'Ritaglia e ruota' } = {}) {
  return new Promise((resolve) => {
    decodeImage(file).then((img) => start(img), (err) => {
      toastError(err?.message || 'Impossibile leggere la foto.');
      resolve(null);
    });

    function start(img) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay hidden fixed inset-0 z-[98] flex items-end sm:items-center justify-center bg-black/80';
      overlay.innerHTML = `
        <div class="modal-panel w-full sm:max-w-2xl h-[100dvh] sm:h-[92vh] bg-graphite-900 sm:rounded-2xl flex flex-col" style="padding-top: env(safe-area-inset-top, 0px)">
          <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-graphite-800 shrink-0">
            <button type="button" data-act="cancel" class="press-spring min-h-[44px] px-3 rounded-lg text-sm font-display font-semibold uppercase tracking-wide text-graphite-400 hover:bg-graphite-800">Annulla</button>
            <h3 class="font-display font-bold text-base uppercase tracking-wide truncate"></h3>
            <button type="button" data-act="done" class="press-spring min-h-[44px] px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-white text-sm font-display font-semibold uppercase tracking-wide">Fine</button>
          </div>
          <div data-role="stage" class="relative flex-1 min-h-0 bg-black"><canvas class="absolute inset-0 touch-none"></canvas></div>
          <div class="px-4 pt-3 space-y-2 shrink-0" style="padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px))">
            <div class="flex items-center gap-3">
              <button type="button" data-act="rot-l" aria-label="Ruota di 90° a sinistra" class="press-spring w-11 h-11 shrink-0 rounded-lg border border-graphite-700 bg-graphite-800 flex items-center justify-center"><i data-lucide="rotate-ccw" class="w-5 h-5"></i></button>
              <input data-role="fine" type="range" min="-45" max="45" step="0.5" value="0" aria-label="Raddrizza" class="flex-1 accent-amber-400" />
              <button type="button" data-act="rot-r" aria-label="Ruota di 90° a destra" class="press-spring w-11 h-11 shrink-0 rounded-lg border border-graphite-700 bg-graphite-800 flex items-center justify-center"><i data-lucide="rotate-cw" class="w-5 h-5"></i></button>
            </div>
            <div class="flex items-center justify-between gap-2 text-xs text-graphite-400">
              <span data-role="angle" class="font-mono min-w-[3.5rem]">0°</span>
              <button type="button" data-act="reset" class="press-spring min-h-[36px] px-3 rounded-lg border border-graphite-700 font-display font-semibold uppercase tracking-wide">Ripristina</button>
              <span data-role="size" class="font-mono min-w-[6rem] text-right"></span>
            </div>
          </div>
        </div>`;
      overlay.querySelector('h3').textContent = title;
      document.body.appendChild(overlay);

      const stage = overlay.querySelector('[data-role="stage"]');
      const canvas = stage.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const fineEl = overlay.querySelector('[data-role="fine"]');
      const angleEl = overlay.querySelector('[data-role="angle"]');
      const sizeEl = overlay.querySelector('[data-role="size"]');
      const doneBtn = overlay.querySelector('[data-act="done"]');

      let SW = 0;
      let SH = 0;
      let dpr = 1;
      const PAD = 14;
      const st = { q: 0, fine: 0, rect: null, drag: null };

      // Geometria: l'immagine ruotata dall'angolo totale sta intera nell'area (scala sc), centrata
      const geom = () => {
        const a = ((st.q * 90 + st.fine) * Math.PI) / 180;
        const c = Math.abs(Math.cos(a));
        const s = Math.abs(Math.sin(a));
        const bw = img.width * c + img.height * s;
        const bh = img.width * s + img.height * c;
        const sc = Math.min((SW - 2 * PAD) / bw, (SH - 2 * PAD) / bh);
        return { a, bw, bh, sc, cx: SW / 2, cy: SH / 2 };
      };
      const defaultRect = () => {
        const g = geom();
        const w = g.bw * g.sc;
        const h = g.bh * g.sc;
        return { x: g.cx - w / 2, y: g.cy - h / 2, w, h };
      };
      const handles = () => {
        const { x, y, w, h } = st.rect;
        return [
          { id: 'nw', x, y },
          { id: 'ne', x: x + w, y },
          { id: 'sw', x, y: y + h },
          { id: 'se', x: x + w, y: y + h },
          { id: 'n', x: x + w / 2, y },
          { id: 's', x: x + w / 2, y: y + h },
          { id: 'w', x, y: y + h / 2 },
          { id: 'e', x: x + w, y: y + h / 2 },
        ];
      };

      function updateLabels() {
        const total = st.q * 90 + st.fine;
        angleEl.textContent = `${total > 0 ? '+' : ''}${Number.isInteger(total) ? total : total.toFixed(1)}°`;
        const g = geom();
        const srcW = st.rect.w / g.sc;
        const srcH = st.rect.h / g.sc;
        const k = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
        sizeEl.textContent = `${Math.round(srcW * k)} × ${Math.round(srcH * k)} px`;
      }

      function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0b0f14';
        ctx.fillRect(0, 0, SW, SH);
        const g = geom();
        ctx.save();
        ctx.translate(g.cx, g.cy);
        ctx.rotate(g.a);
        ctx.scale(g.sc, g.sc);
        ctx.drawImage(img.source, -img.width / 2, -img.height / 2);
        ctx.restore();
        const r = st.rect;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.rect(0, 0, SW, SH);
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i <= 2; i++) {
          ctx.moveTo(r.x + (r.w * i) / 3, r.y);
          ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
          ctx.moveTo(r.x, r.y + (r.h * i) / 3);
          ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
        }
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        handles().forEach((h) => {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
        updateLabels();
      }

      function layout() {
        // Misura di layout (non cambia con l'animazione di apertura, a differenza di getBoundingClientRect)
        if (!stage.clientWidth || !stage.clientHeight) return;
        SW = stage.clientWidth;
        SH = stage.clientHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(SW * dpr);
        canvas.height = Math.round(SH * dpr);
        canvas.style.width = `${SW}px`;
        canvas.style.height = `${SH}px`;
        st.rect = defaultRect();
        draw();
      }

      const point = (e) => {
        const b = canvas.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      const hit = (p) => {
        for (const h of handles()) if (Math.hypot(h.x - p.x, h.y - p.y) <= HANDLE_HIT) return h.id;
        const r = st.rect;
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h ? 'move' : null;
      };
      canvas.addEventListener('pointerdown', (e) => {
        const p = point(e);
        const id = hit(p);
        if (!id) return;
        canvas.setPointerCapture(e.pointerId);
        st.drag = { id, sx: p.x, sy: p.y, rect: { ...st.rect } };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!st.drag) return;
        const p = point(e);
        const dx = p.x - st.drag.sx;
        const dy = p.y - st.drag.sy;
        const { id } = st.drag;
        let { x, y, w, h } = st.drag.rect;
        if (id === 'move') {
          x = clamp(x + dx, 0, SW - w);
          y = clamp(y + dy, 0, SH - h);
        } else {
          let x1 = x;
          let y1 = y;
          let x2 = x + w;
          let y2 = y + h;
          if (id.includes('w')) x1 = clamp(x + dx, 0, x2 - MIN_RECT);
          if (id.includes('e')) x2 = clamp(x + w + dx, x1 + MIN_RECT, SW);
          if (id.includes('n')) y1 = clamp(y + dy, 0, y2 - MIN_RECT);
          if (id.includes('s')) y2 = clamp(y + h + dy, y1 + MIN_RECT, SH);
          x = x1;
          y = y1;
          w = x2 - x1;
          h = y2 - y1;
        }
        st.rect = { x, y, w, h };
        draw();
      });
      const endDrag = () => {
        st.drag = null;
      };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);

      // Rotazione: 90° a scatti (il riquadro riparte dall'intera foto) e raddrizzamento fine (il riquadro resta dov'è)
      overlay.querySelector('[data-act="rot-l"]').addEventListener('click', () => {
        feedback.tap();
        st.q = (st.q + 3) % 4;
        st.rect = defaultRect();
        draw();
      });
      overlay.querySelector('[data-act="rot-r"]').addEventListener('click', () => {
        feedback.tap();
        st.q = (st.q + 1) % 4;
        st.rect = defaultRect();
        draw();
      });
      fineEl.addEventListener('input', () => {
        st.fine = Number(fineEl.value);
        const r = st.rect;
        st.rect = { x: clamp(r.x, 0, SW - r.w), y: clamp(r.y, 0, SH - r.h), w: r.w, h: r.h };
        draw();
      });
      overlay.querySelector('[data-act="reset"]').addEventListener('click', () => {
        feedback.tap();
        st.q = 0;
        st.fine = 0;
        fineEl.value = '0';
        st.rect = defaultRect();
        draw();
      });

      let finished = false;
      const finish = (value, { animate = true } = {}) => {
        if (finished) return;
        finished = true;
        window.removeEventListener('resize', layout);
        img.close();
        if (animate) closeOverlay(overlay);
        setTimeout(() => overlay.remove(), modalCloseMs() + 60);
        resolve(value);
      };
      overlay.addEventListener('overlay-cancel', () => finish(null, { animate: false })); // tasto indietro del telefono
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));

      // Ritaglio finale: si ridisegna l'immagine ruotata in una tela grande quanto il riquadro (lato lungo max 1600 px)
      doneBtn.addEventListener('click', async () => {
        doneBtn.disabled = true;
        doneBtn.textContent = 'Elaboro…';
        try {
          const g = geom();
          const r = st.rect;
          const k = Math.min(1, MAX_SIDE / Math.max(r.w / g.sc, r.h / g.sc));
          const W = Math.max(1, Math.round((r.w / g.sc) * k));
          const H = Math.max(1, Math.round((r.h / g.sc) * k));
          const out = document.createElement('canvas');
          out.width = W;
          out.height = H;
          const c = out.getContext('2d');
          c.imageSmoothingQuality = 'high';
          c.fillStyle = '#1f2937'; // eventuali bordi vuoti dopo il raddrizzamento
          c.fillRect(0, 0, W, H);
          const m = W / r.w;
          c.setTransform(m, 0, 0, m, -r.x * m, -r.y * m);
          c.translate(g.cx, g.cy);
          c.rotate(g.a);
          c.scale(g.sc, g.sc);
          c.drawImage(img.source, -img.width / 2, -img.height / 2);
          const result = await compressCanvas(out);
          feedback.confirmAction();
          finish(result);
        } catch (err) {
          console.error(err);
          feedback.errorAction();
          toastError(err?.message || 'Impossibile elaborare la foto.');
          doneBtn.disabled = false;
          doneBtn.textContent = 'Fine';
        }
      });

      openOverlay(overlay);
      window.lucide?.createIcons();
      window.addEventListener('resize', layout);
      // Dopo l'apertura il riquadro ha la sua misura: si calcola allora la geometria
      requestAnimationFrame(() => requestAnimationFrame(layout));
    }
  });
}
