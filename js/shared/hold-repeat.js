// =============================================================
// hold-repeat.js — Pressione prolungata sui pulsanti +/−.
// Un tocco = ±1. Tenendo premuto, dopo una breve attesa parte la ripetizione
// con accelerazione graduale e un tick aptico+sonoro a ogni scatto:
// - da 1 a 5: un numero alla volta, uno scatto ogni HOLD_FINE_MS
// - da 5 in su: salti di 5 (5 → 10 → 15 → 20 …), uno scatto ogni HOLD_COARSE_MS
// - da 30 in su: stessi salti di 5 ma più veloci, uno scatto ogni HOLD_FAST_MS
// In discesa è speculare (… 35 → 30 → 25 → 20 → 15 → 10 → 5, poi 4 → 3 → 2 → 1).
// Condiviso da Deposito/Prelievo (Movimenti) e dal conteggio di Inventario.
// =============================================================

import feedback from './feedback.js';

export const HOLD_DELAY_MS = 400; // attesa prima che parta la ripetizione (evita scatti involontari su un tocco lungo)
const HOLD_FINE_MS = 300; // intervallo tra gli scatti da ±1
const HOLD_COARSE_MS = 500; // intervallo tra gli scatti da ±5
const HOLD_FAST_MS = 200; // intervallo tra gli scatti da ±5 oltre la soglia veloce
const HOLD_FAST_FROM = 30; // da questo valore in su gli scatti da 5 accelerano
const HOLD_JUMP = 5;

/** Passo del prossimo scatto: ±1 sotto la soglia, ±5 (agganciato ai multipli di 5) sopra. */
function nextHoldValue(cur, dir) {
  const fine = dir > 0 ? cur < HOLD_JUMP : cur <= HOLD_JUMP;
  if (fine) return { value: cur + dir, coarse: false };
  const value = dir > 0 ? (Math.floor(cur / HOLD_JUMP) + 1) * HOLD_JUMP : (Math.ceil(cur / HOLD_JUMP) - 1) * HOLD_JUMP;
  return { value, coarse: true };
}

/** Attesa prima del prossimo scatto, in base al valore da cui si parte. */
function holdInterval(cur, dir) {
  if (!nextHoldValue(cur, dir).coarse) return HOLD_FINE_MS;
  const fast = dir > 0 ? cur >= HOLD_FAST_FROM : cur > HOLD_FAST_FROM;
  return fast ? HOLD_FAST_MS : HOLD_COARSE_MS;
}

/**
 * Crea un ripetitore: start() esegue il primo scatto subito e, se il dito resta
 * premuto, avvia la ripetizione accelerata; stop() la ferma.
 * @returns {{ start: (dir: 1|-1, ctx: { getValue: () => number, setValue: (v: number) => void, min?: number, firstStep: () => void }) => void, stop: () => void }}
 */
export function createHoldRepeater() {
  let timer = null;
  let active = null;

  function stop() {
    clearTimeout(timer);
    timer = null;
    active = null;
  }

  function tick() {
    if (!active) return;
    const { dir, getValue, setValue, min } = active;
    const cur = getValue();
    const { value, coarse } = nextHoldValue(cur, dir);
    const clamped = Math.max(min, value);
    if (clamped === cur) {
      stop(); // già al minimo: inutile continuare a ripetere
      return;
    }
    setValue(clamped);
    feedback.qtyTick(coarse ? 1 : 0);
    timer = setTimeout(tick, holdInterval(clamped, dir));
  }

  function start(dir, { getValue, setValue, min = 0, firstStep }) {
    stop();
    active = { dir, getValue, setValue, min };
    firstStep(); // il primo scatto è immediato, come un normale tocco
    timer = setTimeout(tick, HOLD_DELAY_MS);
  }

  return { start, stop };
}
