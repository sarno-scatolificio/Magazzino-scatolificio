// =============================================================
// shelf-photo-viewer.js — Foto dello scaffale con la posizione dell'articolo.
// openShelfPhoto() mostra la foto a grande formato (si ingrandisce con due dita, con la rotellina o con i pulsanti +/−, e
// si trascina da ingrandita) con un cerchio e una freccia disegnati dall'app sul punto dove si trova l'articolo. L'Admin
// tocca la foto per indicare o spostare il punto (poi Salva); l'operatore guarda soltanto.
// enhanceShelfNames() trasforma i nomi scaffale di una scheda (elementi con data-shelf) in pulsanti toccabili, ma solo
// per gli scaffali che hanno una foto: il nome stesso è il pulsante, senza didascalie.
// =============================================================

import { loadShelfPhotos, getShelfPhoto, getShelfPhotoUrl, getProductPosition, setProductPosition, clearProductPosition, listProductPositions, shelfKey } from '../data/supabase.js';
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

const PILL_BASE =
  'shelf-pill press-spring inline-flex items-center gap-1.5 max-w-full min-h-[34px] rounded-lg border px-2.5 align-middle font-display font-bold tracking-wide transition-colors';
const PILL_SET = 'bg-amber-400 border-amber-400 text-white shadow-edge'; // posizione già indicata: in evidenza
const PILL_UNSET = 'bg-amber-400/10 border-amber-400 text-graphite-100'; // foto presente, posizione ancora da indicare

function paintPill(btn, hasPos) {
  btn.className = `${PILL_BASE} ${hasPos ? PILL_SET : PILL_UNSET}`;
  btn.innerHTML = `<i data-lucide="${hasPos ? 'map-pin' : 'image'}" class="w-4 h-4 shrink-0" stroke-width="2.4"></i><span class="truncate"></span><i data-lucide="chevron-right" class="w-3.5 h-3.5 shrink-0 opacity-70" stroke-width="2.6"></i>`;
  btn.querySelector('span').textContent = btn.dataset.shelf; // testo, mai HTML
  window.lucide?.createIcons();
}

/**
 * @param {{ locazione: string, product: { id: string, codice_articolo: string }, onChanged?: (hasPosition: boolean) => void }} opts
 */
export async function openShelfPhoto({ locazione, product, onChanged }) {
  const editable = isAdmin();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden fixed inset-0 z-[97] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
  overlay.innerHTML = `
    <div class="modal-panel w-full sm:max-w-3xl bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl h-[94dvh] sm:h-[90vh] flex flex-col">
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between gap-3 px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <div class="min-w-0">
          <h3 class="font-display font-bold text-lg uppercase tracking-wide truncate">${esc(product.codice_articolo)}</h3>
          <p class="text-xs text-graphite-400 truncate">${esc(locazione)}</p>
        </div>
        <button type="button" data-act="close" aria-label="Chiudi" class="modal-close modal-close--on-light"><i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i></button>
      </div>
      <div data-role="stage" class="relative flex-1 min-h-0 overflow-hidden bg-black select-none" style="touch-action: none">
        <p data-role="status" class="absolute inset-0 flex items-center justify-center text-sm text-graphite-400">Carico la foto…</p>
        <div data-role="frame" class="hidden absolute left-0 top-0" style="transform-origin: 0 0; will-change: transform">
          <img data-role="img" alt="Foto dello scaffale" draggable="false" class="block w-full h-full" />
          <svg data-role="svg" class="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none"></svg>
        </div>
        <div data-role="zoom" class="hidden absolute right-3 bottom-3 flex flex-col gap-2">
          <button type="button" data-zoom="in" aria-label="Ingrandisci" class="press-spring w-11 h-11 rounded-full bg-black/60 text-white border border-white/30 flex items-center justify-center"><i data-lucide="plus" class="w-5 h-5" stroke-width="2.4"></i></button>
          <button type="button" data-zoom="out" aria-label="Riduci" class="press-spring w-11 h-11 rounded-full bg-black/60 text-white border border-white/30 flex items-center justify-center"><i data-lucide="minus" class="w-5 h-5" stroke-width="2.4"></i></button>
          <button type="button" data-zoom="fit" aria-label="Adatta allo schermo" class="press-spring w-11 h-11 rounded-full bg-black/60 text-white border border-white/30 flex items-center justify-center"><i data-lucide="maximize-2" class="w-5 h-5" stroke-width="2.2"></i></button>
        </div>
      </div>
      <p data-role="hint" class="hidden px-5 pt-2 text-xs text-graphite-500 text-center shrink-0"></p>
      ${
        editable
          ? `<div class="flex gap-3 px-5 pb-5 pt-3 shrink-0">
              <button type="button" data-act="clear" class="hidden press-spring flex-1 min-h-[48px] rounded-lg border border-graphite-700 bg-graphite-800 hover:bg-graphite-700 font-display font-semibold uppercase tracking-wide text-sm text-rose-700 transition-colors">Rimuovi</button>
              <button type="button" data-act="save" disabled class="press-spring flex-1 min-h-[48px] rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-white font-display font-semibold uppercase tracking-wide text-sm transition-colors">Salva posizione</button>
            </div>`
          : '<div class="pb-4 shrink-0"></div>'
      }
    </div>`;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const stage = $('[data-role="stage"]');
  const statusEl = $('[data-role="status"]');
  const frame = $('[data-role="frame"]');
  const imgEl = $('[data-role="img"]');
  const svg = $('[data-role="svg"]');
  const hint = $('[data-role="hint"]');
  const zoomBox = $('[data-role="zoom"]');
  const saveBtn = $('[data-act="save"]');
  const clearBtn = $('[data-act="clear"]');

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('resize', onResize);
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

  // ---- Zoom e spostamento: la cornice (foto + segno) si ingrandisce con transform; scala 1 = foto intera nello schermo
  const MAX_SCALE = 6;
  const view = { s: 1, tx: 0, ty: 0, fw: 0, fh: 0 };
  const apply = () => {
    const SW = stage.clientWidth;
    const SH = stage.clientHeight;
    const sw = view.fw * view.s;
    const sh = view.fh * view.s;
    view.tx = sw <= SW ? (SW - sw) / 2 : Math.min(0, Math.max(SW - sw, view.tx));
    view.ty = sh <= SH ? (SH - sh) / 2 : Math.min(0, Math.max(SH - sh, view.ty));
    frame.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
  };
  const fit = () => {
    const SW = stage.clientWidth;
    const SH = stage.clientHeight;
    const k = Math.min(SW / W, SH / H);
    view.fw = W * k;
    view.fh = H * k;
    frame.style.width = `${view.fw}px`;
    frame.style.height = `${view.fh}px`;
    view.s = 1;
    apply();
  };
  const zoomAt = (cx, cy, next) => {
    const s2 = Math.min(MAX_SCALE, Math.max(1, next));
    const px = (cx - view.tx) / view.s;
    const py = (cy - view.ty) / view.s;
    view.tx = cx - px * s2;
    view.ty = cy - py * s2;
    view.s = s2;
    apply();
  };
  const stagePoint = (e) => {
    const b = stage.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const pointers = new Map(); // id -> { x, y }
  let gesture = null; // { kind: 'pan'|'pinch', ... }
  let tapCandidate = null; // { x, y, t } del tocco singolo in corso

  const placeMarker = (clientX, clientY) => {
    const b = imgEl.getBoundingClientRect();
    if (!b.width || !b.height) return;
    feedback.tap();
    pos = { x: Math.min(Math.max((clientX - b.left) / b.width, 0), 1), y: Math.min(Math.max((clientY - b.top) / b.height, 0), 1) };
    paint();
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-role="zoom"]') || !W) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, stagePoint(e));
    if (pointers.size === 1) {
      tapCandidate = { x: e.clientX, y: e.clientY, t: Date.now() };
      gesture = { kind: 'pan', last: stagePoint(e) };
    } else if (pointers.size === 2) {
      tapCandidate = null; // con due dita non è un tocco
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const p = stagePoint(e);
    pointers.set(e.pointerId, p);
    if (tapCandidate && Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 8) tapCandidate = null;
    if (gesture.kind === 'pan' && pointers.size === 1) {
      if (view.s > 1) {
        view.tx += p.x - gesture.last.x;
        view.ty += p.y - gesture.last.y;
        apply();
      }
      gesture.last = p;
    } else if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.tx += mid.x - gesture.mid.x; // il centro delle due dita trascina anche
      view.ty += mid.y - gesture.mid.y;
      gesture.mid = mid;
      zoomAt(mid.x, mid.y, gesture.s * (dist / gesture.dist));
    }
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const wasTap = tapCandidate && pointers.size === 1 && Date.now() - tapCandidate.t < 600;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      gesture = { kind: 'pan', last: [...pointers.values()][0] }; // dopo il pinch si continua a trascinare con il dito rimasto
      tapCandidate = null;
    } else if (pointers.size === 0) {
      gesture = null;
      if (wasTap && editable && e.type === 'pointerup') placeMarker(e.clientX, e.clientY);
      tapCandidate = null;
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!W) return;
      e.preventDefault();
      const p = stagePoint(e);
      zoomAt(p.x, p.y, view.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    },
    { passive: false }
  );
  zoomBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    feedback.tap();
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    if (btn.dataset.zoom === 'fit') fit();
    else zoomAt(cx, cy, view.s * (btn.dataset.zoom === 'in' ? 1.6 : 1 / 1.6));
  });
  const onResize = () => {
    if (W && !closed) fit();
  };
  window.addEventListener('resize', onResize);

  const paint = () => {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = pos ? markerSvg(pos.x, pos.y, W, H) : '';
    const dirty = !!pos && (!saved || saved.x !== pos.x || saved.y !== pos.y);
    if (saveBtn) saveBtn.disabled = !dirty;
    clearBtn?.classList.toggle('hidden', !saved);
    const text = editable
      ? pos
        ? 'Tocca un altro punto della foto per spostare la posizione.'
        : 'Tocca la foto nel punto dove si trova l’articolo: cerchio e freccia si disegnano da soli.'
      : pos
        ? ''
        : 'La posizione di questo articolo non è ancora stata indicata.';
    hint.textContent = text;
    hint.classList.toggle('hidden', !text);
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
    zoomBox.classList.remove('hidden');
    fit();
    paint();
  } catch (err) {
    console.error(err);
    statusEl.textContent = err?.message || 'Foto non disponibile.';
    return;
  }

  if (!editable) return;

  saveBtn.addEventListener('click', async () => {
    if (!pos) return;
    setButtonBusy(saveBtn, true, 'Salvataggio…');
    try {
      await setProductPosition(product.id, locazione, pos.x, pos.y);
      saved = { ...pos };
      feedback.confirmAction();
      toastSuccess('Posizione salvata.');
      onChanged?.(true);
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
      onChanged?.(false);
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
 * Trasforma in pulsanti i nomi scaffale di `container` (elementi con data-shelf="NOME") che hanno una foto: il nome con
 * un'icona e una freccina, senza didascalie. Colore pieno ambra se la posizione dell'articolo è già indicata, contorno
 * ambra se c'è solo la foto. Gli scaffali senza foto restano testo semplice.
 */
export async function enhanceShelfNames(container, product) {
  if (!container || !product?.id) return;
  const nodes = [...container.querySelectorAll('[data-shelf]')];
  if (!nodes.length) return;
  const token = String(Math.random());
  container.dataset.pillToken = token;
  await loadShelfPhotos();
  const positions = await listProductPositions(product.id).catch(() => new Map());
  if (container.dataset.pillToken !== token) return; // nel frattempo la scheda è cambiata
  const admin = isAdmin();
  let any = false;
  nodes.forEach((node) => {
    const name = node.dataset.shelf;
    if (!container.contains(node) || !getShelfPhoto(name)) return;
    let hasPos = positions.has(shelfKey(name));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.shelf = name;
    btn.setAttribute('aria-label', `${hasPos || !admin ? 'Vedi' : 'Indica'} la posizione sulla foto dello scaffale ${name}`);
    paintPill(btn, hasPos);
    btn.addEventListener('click', () => {
      feedback.tap();
      openShelfPhoto({
        locazione: name,
        product,
        onChanged: (v) => {
          hasPos = v;
          paintPill(btn, hasPos);
        },
      });
    });
    node.replaceWith(btn);
    any = true;
  });
  if (any) container.querySelectorAll('.shelf-sep').forEach((el) => el.remove()); // con i pulsanti non servono le virgole
  window.lucide?.createIcons();
}
