// =============================================================
// shelf-photo-viewer.js — Foto dello scaffale con la posizione dell'articolo.
// openShelfPhoto() mostra la foto dello scaffale con un cerchio e una freccia (disegnati dall'app) sul punto dove si
// trova l'articolo. L'Admin tocca la foto per indicare o spostare il punto (poi Salva); l'operatore guarda soltanto.
// renderShelfPhotoButtons() mette in una scheda un pulsante per ogni scaffale dell'articolo che ha una foto.
// =============================================================

import { loadShelfPhotos, getShelfPhoto, getShelfPhotoUrl, getProductPosition, setProductPosition, clearProductPosition, getProductLocations } from '../data/supabase.js';
import { isAdmin } from '../core/auth.js';
import { toastSuccess, toastError } from './toast.js';
import { closeOverlay, enableSheetDrag, modalCloseMs, openOverlay, setButtonBusy } from './ui-utils.js';
import feedback from './feedback.js';

const RED = '#ef4444';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Cerchio + freccia in coordinate della foto (W × H px). La freccia arriva da dove c'è più spazio
 * (preferibilmente dall'alto) e punta al bordo del cerchio. Ogni forma ha un contorno bianco sotto, per vedersi su ogni sfondo.
 */
export function markerSvg(x, y, W, H) {
  const base = Math.min(W, H);
  const r = base * 0.055;
  const L = base * 0.2;
  const sw = base * 0.012;
  const head = base * 0.05;
  const px = x * W;
  const py = y * H;
  const margin = sw * 3;
  const candidates = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]].map(([dx, dy]) => {
    const n = Math.hypot(dx, dy);
    const ux = dx / n;
    const uy = dy / n;
    const sx = px + ux * (r + L);
    const sy = py + uy * (r + L);
    return { ux, uy, sx, sy, room: Math.min(sx - margin, W - margin - sx, sy - margin, H - margin - sy) };
  });
  const d = candidates.find((c) => c.room >= 0) || candidates.reduce((a, b) => (b.room > a.room ? b : a));
  const tx = px + d.ux * (r + sw * 1.5); // punta della freccia, appena fuori dal cerchio
  const ty = py + d.uy * (r + sw * 1.5);
  const vx = -d.ux; // direzione della freccia (verso il cerchio)
  const vy = -d.uy;
  const bx = tx - vx * head;
  const by = ty - vy * head;
  const wx = -vy * head * 0.6;
  const wy = vx * head * 0.6;
  const line = `M${d.sx.toFixed(1)} ${d.sy.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)}`;
  const tri = `${tx.toFixed(1)},${ty.toFixed(1)} ${(bx + wx).toFixed(1)},${(by + wy).toFixed(1)} ${(bx - wx).toFixed(1)},${(by - wy).toFixed(1)}`;
  const shape = (color, extra) =>
    `<g stroke="${color}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${(sw + extra).toFixed(2)}">
      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" />
      <path d="${line}" />
      <polygon points="${tri}" fill="${color}" />
    </g>`;
  return `${shape('#ffffff', sw * 1.6)}${shape(RED, 0)}<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(r - sw / 2).toFixed(1)}" fill="${RED}" fill-opacity="0.15" />`;
}

/**
 * @param {{ locazione: string, product: { id: string, codice_articolo: string } }} opts
 */
export async function openShelfPhoto({ locazione, product }) {
  const editable = isAdmin();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[97] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-lg bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between gap-3 px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <div class="min-w-0">
          <h3 class="font-display font-bold text-lg uppercase tracking-wide truncate">${esc(product.codice_articolo)}</h3>
          <p class="text-xs text-graphite-400 truncate">Scaffale ${esc(locazione)}</p>
        </div>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-3 pt-3">
        <p data-role="status" class="py-10 text-center text-sm text-graphite-400">Carico la foto…</p>
        <div data-role="frame" class="hidden relative mx-auto w-fit max-w-full select-none">
          <img data-role="img" alt="Foto dello scaffale" draggable="false" class="block max-w-full rounded-lg" style="max-height: 62vh; width: auto; height: auto" />
          <svg data-role="svg" class="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none"></svg>
        </div>
      </div>
      <p data-role="hint" class="px-5 py-2 text-xs text-graphite-500 text-center shrink-0"></p>
      ${
        editable
          ? `<div class="flex gap-3 px-5 pb-5 pt-1 shrink-0">
              <button type="button" data-act="clear" class="hidden press-spring flex-1 min-h-[48px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 font-display font-semibold uppercase tracking-wide text-sm text-rose-700 transition-colors">Rimuovi</button>
              <button type="button" data-act="save" disabled class="press-spring flex-1 min-h-[48px] rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-white font-display font-semibold uppercase tracking-wide text-sm transition-colors">Salva posizione</button>
            </div>`
          : '<div class="pb-4 shrink-0"></div>'
      }
    </div>`;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const statusEl = $('[data-role="status"]');
  const frame = $('[data-role="frame"]');
  const imgEl = $('[data-role="img"]');
  const svg = $('[data-role="svg"]');
  const hint = $('[data-role="hint"]');
  const saveBtn = $('[data-act="save"]');
  const clearBtn = $('[data-act="clear"]');

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => overlay.remove(), modalCloseMs() + 60);
  };
  const close = () => {
    cleanup();
    closeOverlay(overlay);
  };
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.addEventListener('overlay-cancel', cleanup);
  $('[data-act="close"]').addEventListener('click', close);
  enableSheetDrag($('.modal-panel'), close);

  openOverlay(overlay);
  window.lucide?.createIcons();

  let saved = null; // { x, y } già salvata
  let pos = null; // { x, y } mostrata (può essere ancora da salvare)
  let W = 0;
  let H = 0;

  const paint = () => {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = pos ? markerSvg(pos.x, pos.y, W, H) : '';
    const dirty = !!pos && (!saved || saved.x !== pos.x || saved.y !== pos.y);
    if (saveBtn) saveBtn.disabled = !dirty;
    clearBtn?.classList.toggle('hidden', !saved);
    hint.textContent = editable
      ? pos
        ? 'Tocca un altro punto della foto per spostare la posizione.'
        : 'Tocca la foto nel punto dove si trova l’articolo: cerchio e freccia si disegnano da soli.'
      : pos
        ? ''
        : 'La posizione di questo articolo non è ancora stata indicata.';
  };

  try {
    const photo = getShelfPhoto(locazione) || (await loadShelfPhotos(true), getShelfPhoto(locazione));
    if (!photo) throw new Error('Questo scaffale non ha ancora una foto.');
    const [url, position] = await Promise.all([getShelfPhotoUrl(photo.storage_path), getProductPosition(product.id, locazione).catch(() => null)]);
    saved = position ? { x: position.x, y: position.y } : null;
    pos = saved && { ...saved };
    await new Promise((resolve, reject) => {
      imgEl.onload = resolve;
      imgEl.onerror = () => reject(new Error('Impossibile caricare la foto.'));
      imgEl.src = url;
    });
    W = imgEl.naturalWidth;
    H = imgEl.naturalHeight;
    statusEl.classList.add('hidden');
    frame.classList.remove('hidden');
    paint();
  } catch (err) {
    console.error(err);
    statusEl.textContent = err?.message || 'Foto non disponibile.';
    return;
  }

  if (!editable) return;

  frame.addEventListener('click', (ev) => {
    const b = imgEl.getBoundingClientRect();
    if (!b.width || !b.height) return;
    feedback.tap();
    pos = { x: Math.min(Math.max((ev.clientX - b.left) / b.width, 0), 1), y: Math.min(Math.max((ev.clientY - b.top) / b.height, 0), 1) };
    paint();
  });
  frame.style.cursor = 'crosshair';

  saveBtn.addEventListener('click', async () => {
    if (!pos) return;
    setButtonBusy(saveBtn, true, 'Salvataggio…');
    try {
      await setProductPosition(product.id, locazione, pos.x, pos.y);
      saved = { ...pos };
      feedback.confirmAction();
      toastSuccess('Posizione salvata.');
      close();
    } catch (err) {
      console.error(err);
      feedback.errorAction();
      toastError('Impossibile salvare la posizione.');
    } finally {
      setButtonBusy(saveBtn, false);
    }
  });
  clearBtn.addEventListener('click', async () => {
    setButtonBusy(clearBtn, true);
    try {
      await clearProductPosition(product.id, locazione);
      saved = null;
      pos = null;
      feedback.deleteAction();
      toastSuccess('Posizione rimossa.');
      paint();
    } catch (err) {
      console.error(err);
      feedback.errorAction();
      toastError('Impossibile rimuovere la posizione.');
    } finally {
      setButtonBusy(clearBtn, false);
    }
  });
}

/**
 * Riempie `container` con un pulsante per ogni scaffale dell'articolo che ha una foto (nessuno se non ce ne sono).
 * L'Admin vi indica la posizione, gli altri la guardano.
 */
export async function renderShelfPhotoButtons(container, product) {
  if (!container) return;
  const token = String(Math.random());
  container.dataset.token = token;
  container.innerHTML = '';
  if (!product?.id) return;
  await loadShelfPhotos();
  if (container.dataset.token !== token) return; // nel frattempo si è passati a un altro articolo
  const shelves = getProductLocations(product)
    .map((l) => (l.locazione || '').trim())
    .filter((name, i, all) => name && all.indexOf(name) === i && getShelfPhoto(name));
  if (!shelves.length) return;
  const admin = isAdmin();
  shelves.forEach((name) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'press-spring inline-flex items-center gap-1.5 min-h-[40px] max-w-full rounded-lg border border-graphite-700 bg-graphite-900 hover:bg-graphite-700 px-3 text-xs font-display font-semibold uppercase tracking-wide transition-colors';
    btn.innerHTML = '<i data-lucide="map-pin" class="w-4 h-4 shrink-0"></i><span class="truncate"></span>';
    btn.querySelector('span').textContent = `${admin ? 'Indica posizione' : 'Vedi posizione'}${shelves.length > 1 ? ` · ${name}` : ''}`; // testo, mai HTML
    btn.addEventListener('click', () => {
      feedback.tap();
      openShelfPhoto({ locazione: name, product });
    });
    container.appendChild(btn);
  });
  window.lucide?.createIcons();
}
