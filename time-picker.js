// =============================================================
// time-picker.js — Selettore dell'ora disegnato ad hoc (al posto di quello di sistema).
// Due ruote (ore e minuti) a scorrimento con aggancio; stessa struttura e animazione delle
// altre modali dell'app (cassetto su mobile, finestra centrata su desktop).
//
// Uso:  const hhmm = await pickTime({ value: '14:35' });   // -> 'HH:MM' oppure null se annullato
// =============================================================

import feedback from './feedback.js';
import { openOverlay, closeOverlay, enableSheetDrag, modalCloseMs } from './ui-utils.js';

const ITEM_H = 44; // altezza di una voce (px): deve coincidere con .tp-item in style.css
const pad2 = (n) => String(n).padStart(2, '0');

export function pickTime({ value = '', title = 'Ora di esecuzione' } = {}) {
  return new Promise((resolve) => {
    const now = new Date();
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    let hour = m ? Math.min(23, Number(m[1])) : now.getHours();
    let minute = m ? Math.min(59, Number(m[2])) : now.getMinutes();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4';
    const card = document.createElement('div');
    card.className = 'modal-panel modal-panel-card w-full sm:max-w-sm bg-graphite-900 border border-graphite-700 rounded-t-2xl sm:rounded-2xl flex flex-col';
    const items = (n) => Array.from({ length: n }, (_, i) => `<div class="tp-item" data-v="${i}">${pad2(i)}</div>`).join('');
    card.innerHTML = `
      <div data-sheet-drag class="sheet-grabber sm:hidden"><span class="sheet-grabber-pill"></span></div>
      <div data-sheet-drag class="flex items-center justify-between px-5 pb-3 pt-1 sm:pt-3 border-b border-graphite-800 shrink-0">
        <h3 class="font-display font-bold text-lg uppercase tracking-wide">${title}</h3>
        <button type="button" data-action="close" aria-label="Chiudi" class="modal-close modal-close--on-light">
          <i data-lucide="x" class="w-6 h-6" stroke-width="2.5"></i>
        </button>
      </div>
      <div class="px-5 pt-4">
        <div class="tp-wrap">
          <div class="tp-band" aria-hidden="true"></div>
          <div class="tp-wheel" data-wheel="h" role="listbox" aria-label="Ore">${items(24)}</div>
          <span class="tp-colon" aria-hidden="true">:</span>
          <div class="tp-wheel" data-wheel="m" role="listbox" aria-label="Minuti">${items(60)}</div>
        </div>
        <button type="button" data-action="now" class="mt-2 w-full rounded-lg py-2.5 text-xs font-display font-semibold uppercase tracking-wide text-amber-400 hover:bg-graphite-800 transition-colors">Adesso</button>
      </div>
      <div class="flex gap-3 px-5 pt-2 pb-5">
        <button type="button" data-action="cancel"
          class="flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide text-graphite-400 hover:text-graphite-200 hover:bg-graphite-800 transition-colors">Annulla</button>
        <button type="button" data-action="apply"
          class="flex-1 rounded-lg py-3 font-display font-semibold uppercase tracking-wide text-white bg-amber-400 hover:bg-amber-300 transition-colors">Conferma</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const wheels = { h: card.querySelector('[data-wheel="h"]'), m: card.querySelector('[data-wheel="m"]') };
    const values = { h: hour, m: minute };
    let lastTick = 0;

    function markSelected(key) {
      wheels[key].querySelectorAll('.tp-item').forEach((el, i) => el.classList.toggle('tp-item-on', i === values[key]));
    }
    function scrollTo(key, v, smooth) {
      wheels[key].scrollTo({ top: v * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
    }
    function onScroll(key) {
      const v = Math.max(0, Math.min(key === 'h' ? 23 : 59, Math.round(wheels[key].scrollTop / ITEM_H)));
      if (v !== values[key]) {
        values[key] = v;
        markSelected(key);
        const t = Date.now();
        if (t - lastTick > 70) {
          lastTick = t;
          feedback.presetPick(); // tic leggero a ogni numero che passa
        }
      }
    }
    ['h', 'm'].forEach((key) => {
      wheels[key].addEventListener('scroll', () => onScroll(key), { passive: true });
      wheels[key].addEventListener('click', (e) => {
        const item = e.target.closest('.tp-item');
        if (item) scrollTo(key, Number(item.dataset.v), true); // toccare un numero lo porta al centro
      });
    });
    card.querySelector('[data-action="now"]').addEventListener('click', () => {
      const d = new Date();
      scrollTo('h', d.getHours(), true);
      scrollTo('m', d.getMinutes(), true);
    });

    let settled = false;
    function settle(result, silent = false) {
      if (settled) return;
      settled = true;
      if (!silent) (result ? feedback.confirmAction() : feedback.cancelAction());
      document.removeEventListener('keydown', onKeyDown);
      closeOverlay(overlay);
      setTimeout(() => overlay.remove(), modalCloseMs() + 60);
      resolve(result);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') settle(null);
    }
    card.querySelector('[data-action="apply"]').addEventListener('click', () => settle(`${pad2(values.h)}:${pad2(values.m)}`));
    card.querySelector('[data-action="cancel"]').addEventListener('click', () => settle(null));
    card.querySelector('[data-action="close"]').addEventListener('click', () => settle(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) settle(null);
    });
    overlay.addEventListener('overlay-cancel', () => settle(null, true)); // tasto indietro del telefono
    enableSheetDrag(card, () => settle(null));
    document.addEventListener('keydown', onKeyDown);

    window.lucide?.createIcons();
    openOverlay(overlay);
    // Le ruote si posizionano quando la finestra è visibile (con display:none lo scorrimento non si applica)
    setTimeout(() => {
      scrollTo('h', values.h, false);
      scrollTo('m', values.m, false);
      markSelected('h');
      markSelected('m');
    }, 60);
  });
}
