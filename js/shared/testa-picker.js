// =============================================================
// testa-picker.js — Scelta delle teste del macchinario con un semicerchio di cerchi numerati
// =============================================================
// Uso: const r = await openTestaPicker({ machine: 'TASI-TEST', total: 40, selected: [17], quantita: 1 });
// Ritorna { teste: [..], quantita } (teste in ordine crescente) o null se annulla.
//
// I numeri stanno su una semicirconferenza che si ruota col dito (anche con una spinta: si ferma sul numero più
// vicino) o toccando un numero; il cerchio è continuo (dopo l'ultima testa si torna alla prima). Il numero sotto il
// segnalino in alto è quello "puntato": «Aggiungi testa» lo aggiunge alle scelte (o lo toglie), come toccarlo quando è
// già al centro. Frecce ◀ ▶ per spostarsi di una testa alla volta.
//
// Più teste (una piattella per testa): il numero delle teste deve combaciare con la quantità del prelievo.
//  - quantità impostata a Q > 1: servono esattamente Q teste; con meno non si conferma; con più si avvisa che non
//    combaciano (si può correggere oppure portare la quantità al numero di teste scelto);
//  - quantità lasciata a 1 e scelte più teste: si chiede di confermare quante piattelle sono state davvero prelevate.
// Senza nessuna scelta, con quantità 1, «Conferma» prende direttamente la testa puntata (il caso più comune).

import { openOverlay, closeOverlay, enableSheetDrag } from './ui-utils.js';

const NS = 'http://www.w3.org/2000/svg';
const CX = 190;
const CY = 215;
const R = 150;
const STEP = 16; // gradi tra un numero e il successivo (indipendente dal numero di teste)
const MAXA = 100; // oltre questo angolo il numero è fuori dal semicerchio

const els = {};
let resolveFn = null;
let N = 0;
let pos = 0; // posizione fluida della rotazione, in "teste" (0 = testa 1 sotto il segnalino)
let vel = 0;
let target = null;
let dragging = false;
let running = false;
let sel = 0; // testa puntata (sotto il segnalino)
let nodes = [];
let chosen = new Set(); // teste scelte (numeri 1…N)
let quantita = 1; // quantità del prelievo all'apertura
let lastA = null;
let lastT = 0; // istante dell'ultimo movimento del dito (per la velocità e per sapere se il dito si è fermato)
let sx = 0;
let sy = 0;
let moved = false;
let downEl = null;

const norm = (p) => ((p % N) + N) % N;
const sorted = () => [...chosen].sort((a, b) => a - b);
const plural = (n, one, many) => (n === 1 ? one : many);

export function initTestaPicker() {
  els.modal = document.getElementById('testa-picker-modal');
  if (!els.modal) return;
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => close(null));
  els.svg = document.getElementById('testa-picker-svg');
  els.layer = document.getElementById('testa-picker-heads');
  els.num = document.getElementById('testa-picker-num');
  els.of = document.getElementById('testa-picker-of');
  els.title = document.getElementById('testa-picker-title');
  els.sub = document.getElementById('testa-picker-sub');
  els.add = document.getElementById('testa-picker-add');
  els.ok = document.getElementById('testa-picker-ok');
  els.chosen = document.getElementById('testa-picker-chosen');
  els.note = document.getElementById('testa-picker-note');
  els.noteText = document.getElementById('testa-picker-note-text');
  els.noteActions = document.getElementById('testa-picker-note-actions');

  document.getElementById('testa-picker-close').addEventListener('click', () => close(null));
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) close(null);
  });
  els.modal.addEventListener('overlay-cancel', () => close(null)); // chiusura forzata (indietro, disconnessione)
  els.ok.addEventListener('click', tryConfirm);
  els.add.addEventListener('click', () => toggle(sel));
  document.getElementById('testa-picker-prev').addEventListener('click', () => stepBy(-1));
  document.getElementById('testa-picker-next').addEventListener('click', () => stepBy(1));

  els.svg.addEventListener('pointerdown', onDown);
  els.svg.addEventListener('pointermove', onMove);
  els.svg.addEventListener('pointerup', onUp);
  els.svg.addEventListener('pointercancel', onUp);
  els.svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      stepBy(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      stepBy(1);
      e.preventDefault();
    } else if (e.key === ' ') {
      toggle(sel);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      tryConfirm();
    }
  });
}

/**
 * @param {{machine: string, total: number, selected?: number[], quantita?: number}} opts
 * @returns {Promise<{teste: number[], quantita: number}|null>}
 */
export function openTestaPicker({ machine, total, selected = [], quantita: qty = 1 }) {
  return new Promise((resolve) => {
    resolveFn = resolve;
    N = Math.max(1, total);
    quantita = Math.max(1, Math.round(qty) || 1);
    chosen = new Set(selected.filter((n) => Number.isInteger(n) && n >= 1 && n <= N));
    els.title.textContent = quantita > 1 || chosen.size > 1 ? 'Teste montate' : 'Testa montata';
    els.sub.textContent = machine;
    els.of.textContent = `su ${N}`;
    els.svg.setAttribute('aria-valuemin', '1');
    els.svg.setAttribute('aria-valuemax', String(N));
    build();
    pos = chosen.size ? Math.min(...chosen) - 1 : 0; // si parte dalla prima testa già scelta
    vel = 0;
    target = null;
    sel = 0;
    hideNote();
    render();
    refreshLabels();
    openOverlay(els.modal);
  });
}

function close(value) {
  if (!resolveFn) return;
  dragging = false;
  hideNote();
  closeOverlay(els.modal);
  const resolve = resolveFn;
  resolveFn = null;
  resolve(value);
}

function build() {
  els.layer.innerHTML = '';
  nodes = [];
  for (let i = 0; i < N; i += 1) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-i', String(i));
    g.style.cursor = 'pointer';
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', '17');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dy', '0.35em');
    t.setAttribute('font-size', '13');
    t.setAttribute('font-weight', '600');
    t.textContent = String(i + 1);
    g.appendChild(c);
    g.appendChild(t);
    els.layer.appendChild(g);
    nodes.push({ g, c, t });
  }
}

function render() {
  for (let i = 0; i < N; i += 1) {
    let d = norm(i - pos);
    if (d >= N / 2) d -= N;
    const a = d * STEP;
    const n = nodes[i];
    if (Math.abs(a) > MAXA) {
      n.g.style.display = 'none';
      continue;
    }
    n.g.style.display = '';
    const rad = (a * Math.PI) / 180;
    const x = CX + R * Math.sin(rad);
    const y = CY - R * Math.cos(rad);
    const scale = 1 + 0.35 * Math.max(0, 1 - Math.abs(d));
    const isCursor = Math.abs(d) < 0.5;
    const isChosen = chosen.has(i + 1);
    n.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`);
    n.g.style.opacity = Math.abs(a) <= 64 ? 1 : Math.max(0.12, 1 - (Math.abs(a) - 64) / 40);
    if (isChosen) {
      // scelta: piena nel colore dell'app (se è anche quella puntata, resta più grande)
      n.c.style.fill = 'var(--accent)';
      n.c.style.stroke = 'none';
      n.t.style.fill = '#ffffff';
    } else if (isCursor) {
      // puntata ma non ancora scelta: bianca con contorno spesso
      n.c.style.fill = '#ffffff';
      n.c.style.stroke = 'var(--accent)';
      n.c.style.strokeWidth = '2';
      n.t.style.fill = 'var(--accent)';
    } else {
      n.c.style.fill = 'var(--accent-tint-soft, #f3f4f8)';
      n.c.style.stroke = 'var(--line, #dde1e7)';
      n.c.style.strokeWidth = '1';
      n.t.style.fill = 'var(--ink, #0d1117)';
    }
  }
  const s = norm(Math.round(pos)) + 1;
  if (s !== sel) {
    sel = s;
    els.num.textContent = String(sel);
    els.svg.setAttribute('aria-valuenow', String(sel));
    refreshLabels();
    try {
      navigator.vibrate?.(6);
    } catch (err) {
      // non essenziale
    }
  }
}

/** Testi dei pulsanti e dell'elenco delle scelte (dipendono da testa puntata, scelte e quantità) */
function refreshLabels() {
  const n = chosen.size;
  els.add.textContent = chosen.has(sel) ? `Togli testa ${sel}` : `Aggiungi testa ${sel}`;
  let ok;
  if (n === 0) ok = quantita === 1 ? `Conferma testa ${sel}` : `Scegli ${quantita} teste`;
  else if (quantita > 1) ok = `Conferma (${n} di ${quantita})`;
  else ok = n === 1 ? `Conferma testa ${sorted()[0]}` : `Conferma ${n} teste`;
  els.ok.textContent = ok;
  if (n) {
    els.chosen.textContent = `${plural(n, 'Scelta', 'Scelte')}: ${sorted().join(' · ')}`;
    els.chosen.classList.remove('hidden');
  } else if (quantita > 1) {
    els.chosen.textContent = `Servono ${quantita} teste: puntale e tocca «Aggiungi testa»`;
    els.chosen.classList.remove('hidden');
  } else {
    els.chosen.classList.add('hidden');
  }
}

function toggle(n) {
  if (chosen.has(n)) chosen.delete(n);
  else chosen.add(n);
  hideNote();
  render();
  refreshLabels();
  try {
    navigator.vibrate?.(10);
  } catch (err) {
    // non essenziale
  }
}

// --- Avvisi e conferma della quantità ------------------------------------
function hideNote() {
  els.note?.classList.add('hidden');
  if (els.noteActions) els.noteActions.innerHTML = '';
}

function showNote(text, actions = []) {
  els.noteText.textContent = text;
  els.noteActions.innerHTML = '';
  actions.forEach(({ label, primary, run }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = primary
      ? 'press-spring flex-1 min-h-[40px] rounded-lg font-display font-semibold uppercase tracking-wide text-xs bg-amber-400 text-white px-2'
      : 'press-spring flex-1 min-h-[40px] rounded-lg border border-graphite-700 bg-graphite-900 text-graphite-200 font-display font-semibold uppercase tracking-wide text-xs px-2';
    b.addEventListener('click', run);
    els.noteActions.appendChild(b);
  });
  els.note.classList.remove('hidden');
}

function finish(list, qty) {
  close({ teste: list.slice().sort((a, b) => a - b), quantita: qty });
}

function tryConfirm() {
  const picks = chosen.size ? sorted() : quantita === 1 ? [sel] : [];
  const n = picks.length;
  const Q = quantita;
  if (n === 0) {
    showNote(`Hai impostato ${Q} piattelle: scegli ${Q} teste. Punta una testa e tocca «Aggiungi testa».`);
    return;
  }
  if (n === Q) {
    finish(picks, Q);
    return;
  }
  if (Q === 1) {
    // Quantità lasciata a 1 ma scelte più teste: si chiede quante piattelle sono state prelevate davvero
    showNote(`Hai scelto ${n} teste. Hai prelevato davvero ${n} piattelle?`, [
      { label: `Sì, ${n} piattelle`, primary: true, run: () => finish(picks, n) },
      { label: 'Correggi', run: hideNote },
    ]);
    return;
  }
  if (n < Q) {
    // Quantità impostata: le teste devono essere tutte indicate
    showNote(`La quantità impostata è ${Q}, ma hai scelto ${n} ${plural(n, 'testa', 'teste')}: ne ${plural(Q - n, 'manca', 'mancano')} ${Q - n}.`);
    return;
  }
  showNote(`Hai scelto ${n} teste, ma la quantità impostata è ${Q}: non combaciano.`, [
    { label: `Imposta quantità ${n}`, primary: true, run: () => finish(picks, n) },
    { label: 'Correggi', run: hideNote },
  ]);
}

// --- Rotazione ----------------------------------------------------------
function tick() {
  if (!dragging) {
    if (target !== null) {
      pos += (target - pos) * 0.22;
      if (Math.abs(target - pos) < 0.004) {
        pos = target;
        target = null;
      }
    } else if (Math.abs(vel) > 0.01) {
      pos += vel;
      vel *= 0.95;
      if (Math.abs(vel) <= 0.01) {
        vel = 0;
        target = Math.round(pos);
      }
    }
  }
  render();
  if (dragging || target !== null || Math.abs(vel) > 0.01) {
    requestAnimationFrame(tick);
  } else {
    pos = norm(pos);
    running = false;
    render();
  }
}

function kick() {
  if (running) return;
  running = true;
  requestAnimationFrame(tick);
}

function svgPoint(e) {
  const r = els.svg.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * 380) / r.width, y: ((e.clientY - r.top) * 240) / r.height };
}

// Angolo del dito rispetto al centro dell'arco (gradi, in senso orario): ruotare = seguire il dito lungo l'arco
function angleOf(p) {
  const dx = p.x - CX;
  const dy = CY - p.y;
  if (Math.hypot(dx, dy) < 30) return null;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function onDown(e) {
  lastA = angleOf(svgPoint(e));
  sx = e.clientX;
  sy = e.clientY;
  moved = false;
  dragging = true;
  vel = 0;
  target = null;
  lastT = performance.now();
  downEl = e.target.closest ? e.target.closest('[data-i]') : null;
  try {
    els.svg.setPointerCapture(e.pointerId);
  } catch (err) {
    // non essenziale
  }
  kick();
}

function onMove(e) {
  if (!dragging) return;
  if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) moved = true;
  const a = angleOf(svgPoint(e));
  if (a === null || lastA === null) {
    lastA = a;
    return;
  }
  let da = a - lastA;
  if (da > 180) da -= 360;
  if (da < -180) da += 360;
  lastA = a;
  pos -= da / STEP;
  // velocità in teste per fotogramma (16,7 ms), calcolata sul tempo reale: non dipende da quanti eventi manda il telefono
  const now = performance.now();
  const dt = Math.max(1, now - lastT);
  lastT = now;
  vel = vel * 0.5 + ((-da / STEP / dt) * 16.7) * 0.5;
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  if (performance.now() - lastT > 80) vel = 0; // dito fermo prima di rilasciare: nessuna spinta, si ferma sul numero più vicino
  if (!moved && downEl) {
    const i = Number(downEl.getAttribute('data-i'));
    // Toccare il numero già al centro lo sceglie (o lo toglie); toccarne un altro lo porta al centro
    if (i + 1 === sel && Math.abs(norm(i - pos)) < 0.5) toggle(sel);
    else goTo(i);
    vel = 0;
  } else if (Math.abs(vel) < 0.05) {
    vel = 0;
    target = Math.round(pos);
  } else {
    vel = Math.max(-1.2, Math.min(1.2, vel)); // spinta: continua da sola e si ferma sul numero più vicino
  }
  kick();
}

function goTo(i) {
  let diff = norm(i - pos);
  if (diff > N / 2) diff -= N;
  target = pos + diff; // sempre la strada più corta
  kick();
}

function stepBy(k) {
  const base = target !== null ? target : Math.round(pos);
  target = base + k;
  vel = 0;
  kick();
}
