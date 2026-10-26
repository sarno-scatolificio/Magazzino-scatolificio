// =============================================================
// hold-repeat.js — Pressione prolungata sui pulsanti +/−.
// Un tocco = ±1. Tenendo premuto, dopo una breve attesa parte la ripetizione
// con accelerazione graduale in tre fasi e un tick aptico+sonoro a ogni scatto:
// - da 1 a 5: un numero alla volta, uno scatto ogni HOLD_FINE_MS
// - da 5 a 30: salti di 5 (5 → 10 → 15 …), uno scatto ogni HOLD_MID_MS
// - da 30 in su: salti di 10 (30 → 40 → 50 …), uno scatto ogni HOLD_FAST_MS
// In discesa è speculare (… 50 → 40 → 30 → 25 → 20 → … → 5, poi 4 → 3 → 2 → 1).
// Condiviso da Deposito/Prelievo (Movimenti) e dal conteggio di Inventario.
// =============================================================

import feedback from './feedback.js';

export const HOLD_DELAY_MS = 350; // attesa prima che parta la ripetizione (evita scatti involontari su un tocco lungo)
const HOLD_FINE_MS = 150; // intervallo tra gli scatti da ±1
const HOLD_MID_MS = 190; // intervallo tra gli scatti da ±5
const HOLD_FAST_MS = 100; // intervallo tra gli scatti da ±10
const HOLD_MID_FROM = 5; // da questo valore in su si salta di 5
const HOLD_FAST_FROM = 30; // da questo valore in su si salta di 10

/** Prossimo scatto: ±1 sotto i 5, ±5 fino a 30, ±10 oltre (sempre agganciato ai multipli del salto). */
function nextHoldValue(cur, dir) {
  const fine = dir > 0 ? cur < HOLD_MID_FROM : cur <= HOLD_MID_FROM;
  if (fine) return { value: cur + dir, step: 'fine' };
  const fast = dir > 0 ? cur >= HOLD_FAST_FROM : cur > HOLD_FAST_FROM;
  const jump = fast ? 10 : 5;
  const value = dir > 0 ? (Math.floor(cur / jump) + 1) * jump : (Math.ceil(cur / jump) - 1) * jump;
  return { value, step: fast ? 'fast' : 'mid' };
}

/** Attesa prima del prossimo scatto, in base alla fase in cui si trova il valore. */
function holdInterval(cur, dir) {
  const { step } = nextHoldValue(cur, dir);
  return step === 'fine' ? HOLD_FINE_MS : step === 'fast' ? HOLD_FAST_MS : HOLD_MID_MS;
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
    const { value, step } = nextHoldValue(cur, dir);
    const clamped = Math.max(min, value);
    if (clamped === cur) {
      stop(); // già al minimo: inutile continuare a ripetere
      return;
    }
    setValue(clamped);
    feedback.qtyTick(step === 'fine' ? 0 : 1);
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
