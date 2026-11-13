// =============================================================
// testa-picker.js — Scelta delle teste del macchinario con un semicerchio di cerchi numerati
// =============================================================
// Uso: const r = await openTestaPicker({ machine: 'UNIFORMER', torri: [{ nome: 'Bordatura', teste: 8, tipo: 'doppia' }], selected: [], quantita: 1 });
// Ritorna { punti: [{ torre, testa, pos }], quantita } (punti ordinati: per torre, testa, superiore prima di inferiore) o null se annulla.
// pos è 'S' (superiore), 'I' (inferiore) o null (torre con testa singola); torre è '' se la torre non ha nome.
//
// Il macchinario può avere più torri (pulsanti in alto per passare dall'una all'altra: le scelte restano) e ogni torre un
// numero di teste diverso, singole oppure doppie (superiore/inferiore: due pulsanti scelgono quale delle due).
// La torre è disegnata come una STELLA DI TRASPORTO vista dall'alto (illustrazione piatta in acciaio, senza simboli da disegno
// tecnico): un disco con tanti alloggiamenti quante sono le teste, e in ogni alloggiamento la sua testa, come un barattolo
// nella stella. Si vede sempre la metà alta della stella. Il raggio è proporzionato al numero di teste (alloggiamenti sempre
// grandi quanto basta per toccarli): se le teste sono tante la stella cresce oltre lo schermo e se ne vede la parte in alto.
// La stella si ruota col dito (anche con una spinta: si ferma sulla testa più vicina) o toccando una testa; quella sotto il
// segnalino in alto è la «puntata»: «Aggiungi testa» la aggiunge alle scelte (o la toglie), come toccarla quando è già in
// alto. Frecce ◀ ▶ per spostarsi di una testa alla volta.
//
// Più teste (una piattella per testa): il numero delle teste deve combaciare con la quantità del prelievo.
//  - quantità impostata a Q > 1: servono esattamente Q teste; con meno non si conferma; con più si avvisa che non
//    combaciano (si può correggere oppure portare la quantità al numero di teste scelto);
//  - quantità lasciata a 1 e scelte più teste: si chiede di confermare quante piattelle sono state davvero prelevate.
// Senza nessuna scelta, con quantità 1, «Conferma» prende direttamente la testa puntata (il caso più comune).

import { openOverlay, closeOverlay, enableSheetDrag } from './ui-utils.js';

const NS = 'http://www.w3.org/2000/svg';
const VBW = 380; // dimensioni del disegno (viewBox)
const VBH = 282; // si vede la metà alta della stella: il centro è in basso
const CX = VBW / 2;
const TOP_Y = 58; // bordo alto della stella: la testa puntata sta sempre qui
const R_MIN = 175; // raggio minimo: la metà alta della stella occupa tutta la larghezza
const PITCH_MIN = 40; // distanza minima tra due alloggiamenti sul bordo: sotto non si toccherebbero bene
const EDGE = '#7b8494'; // bordo dell'acciaio
const POS_SHORT = { S: 'sup.', I: 'inf.' };
const CHIP_ON = 'bg-amber-400 border-amber-400 text-white';
const CHIP_OFF = 'bg-graphite-900 border-graphite-700 text-graphite-300';

const els = {};
let resolveFn = null;
let N = 0; // teste della torre mostrata
let torri = []; // torri del macchinario: [{ nome, teste, tipo }]
let tIdx = 0; // torre mostrata (indice in torri)
let curPos = 'S'; // posizione scelta nelle torri doppie: 'S' superiore, 'I' inferiore
let fixedPos = null; // posizione già decisa nella scheda articolo ('S' | 'I'): non si sceglie, vale per tutte le teste
let R = R_MIN; // raggio della stella della torre mostrata
let CY = TOP_Y + R_MIN; // centro della stella (fuori schermo se le teste sono tante)
let pitchDeg = 36; // gradi tra una testa e la successiva (360 / teste)
let holdDir = 0; // tasto ◀ ▶ tenuto premuto: -1 | 1, 0 = nessuno (la stella gira finché resta premuto)
let holdT0 = 0;
let holdLast = 0;
let holdTimer = null;
let pos = 0; // posizione fluida della rotazione, in "teste" (0 = testa 1 sotto il segnalino)
let vel = 0;
let target = null;
let dragging = false;
let running = false;
let sel = 0; // testa puntata (sotto il segnalino)
let nodes = [];
let rcNow = R_MIN; // raggio su cui stanno i centri delle teste
let headR = 17; // raggio del cerchio di una testa
let chosen = new Map(); // teste scelte: chiave "torre:testa:pos" -> { t: indice torre, n: testa, p: 'S' | 'I' | null }
let quantita = 1; // quantità del prelievo all'apertura
let lastA = null;
let lastT = 0; // istante dell'ultimo movimento del dito (per la velocità e per sapere se il dito si è fermato)
let sx = 0;
let sy = 0;
let moved = false;
let downEl = null;

const norm = (p) => ((p % N) + N) % N;
const plural = (n, one, many) => (n === 1 ? one : many);
const isDoppia = () => torri[tIdx]?.tipo === 'doppia';
const posNow = () => (isDoppia() ? curPos : null);
const keyOf = (t, n, p) => `${t}:${n}:${p || ''}`;
const sorted = () => [...chosen.values()].sort((a, b) => a.t - b.t || a.n - b.n || Number(a.p === 'I') - Number(b.p === 'I'));
const nowDesc = () => `testa ${sel}${isDoppia() ? ` ${POS_SHORT[curPos]}` : ''}`;
// Nome breve di una scelta: il nome della torre si mostra solo se serve (più torri, oppure la torre ne ha uno)
const descOf = (c) => `${torri.length > 1 || torri[c.t]?.nome ? `${torri[c.t]?.nome || `Torre ${c.t + 1}`} · ` : ''}${c.n}${c.p ? ` ${POS_SHORT[c.p]}` : ''}`;

export function initTestaPicker() {
  els.modal = document.getElementById('testa-picker-modal');
  if (!els.modal) return;
  enableSheetDrag(els.modal.querySelector('.modal-panel'), () => close(null));
  els.svg = document.getElementById('testa-picker-svg');
  els.layer = document.getElementById('testa-picker-heads');
  els.wheel = document.getElementById('testa-picker-wheel');
  els.star = document.getElementById('testa-picker-star');
  els.grad = document.getElementById('testa-picker-grad');
  els.ring = document.getElementById('testa-picker-ring');
  els.hub = document.getElementById('testa-picker-hub');
  els.shadow1 = document.getElementById('testa-picker-shadow1');
  els.shadow2 = document.getElementById('testa-picker-shadow2');
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
  els.torri = document.getElementById('testa-picker-torri');
  els.posWrap = document.getElementById('testa-picker-pos');
  els.posBtns = els.posWrap ? [...els.posWrap.querySelectorAll('[data-pos]')] : [];

  document.getElementById('testa-picker-close').addEventListener('click', () => close(null));
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) close(null);
  });
  els.modal.addEventListener('overlay-cancel', () => close(null)); // chiusura forzata (indietro, disconnessione)
  els.ok.addEventListener('click', tryConfirm);
  els.add.addEventListener('click', () => toggle(sel));
  bindHoldButton(document.getElementById('testa-picker-prev'), -1);
  bindHoldButton(document.getElementById('testa-picker-next'), 1);
  els.posBtns.forEach((b) =>
    b.addEventListener('click', () => {
      curPos = b.dataset.pos;
      refreshPos();
      render();
      refreshLabels();
    })
  );

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
 * @param {{machine: string, torri: {nome: string, teste: number, tipo: 'singola'|'doppia'}[], selected?: {torre: string, testa: number, pos: string|null}[], quantita?: number}} opts
 * @returns {Promise<{punti: {torre: string, testa: number, pos: string|null}[], quantita: number}|null>}
 */
export function openTestaPicker({ machine, torri: towers, selected = [], quantita: qty = 1, posizione = null }) {
  return new Promise((resolve) => {
    resolveFn = resolve;
    torri = towers && towers.length ? towers : [{ nome: '', teste: 1, tipo: 'singola' }];
    quantita = Math.max(1, Math.round(qty) || 1);
    chosen = new Map();
    // posizione fissa dalla scheda articolo: conta solo con una torre a teste doppie
    fixedPos = (posizione === 'S' || posizione === 'I') && torri.some((x) => x.tipo === 'doppia') ? posizione : null;
    selected.forEach((s) => {
      let t = torri.findIndex((x) => x.nome.trim().toLowerCase() === String(s.torre || '').trim().toLowerCase());
      if (t < 0) t = 0;
      const p = torri[t].tipo === 'doppia' ? (fixedPos || (s.pos === 'I' ? 'I' : 'S')) : null;
      if (Number.isInteger(s.testa) && s.testa >= 1 && s.testa <= torri[t].teste) chosen.set(keyOf(t, s.testa, p), { t, n: s.testa, p });
    });
    els.title.textContent = quantita > 1 || chosen.size > 1 ? 'Teste montate' : 'Testa montata';
    els.sub.textContent = (torri.length === 1 && torri[0].nome ? `${machine} · ${torri[0].nome}` : machine) + (fixedPos ? ` · ${fixedPos === 'S' ? 'superiore' : 'inferiore'}` : '');
    const first = sorted()[0];
    curPos = fixedPos || first?.p || 'S';
    hideNote();
    setTower(first ? first.t : 0);
    openOverlay(els.modal);
  });
}

function close(value) {
  holdDir = 0;
  clearTimeout(holdTimer);
  if (!resolveFn) return;
  dragging = false;
  hideNote();
  closeOverlay(els.modal);
  const resolve = resolveFn;
  resolveFn = null;
  resolve(value);
}

/** Mostra la torre i: ricostruisce i cerchi con le sue teste (le scelte fatte sulle altre torri restano) */
function setTower(i) {
  tIdx = i;
  N = torri[i].teste;
  els.of.textContent = `su ${N}`;
  els.svg.setAttribute('aria-valuemin', '1');
  els.svg.setAttribute('aria-valuemax', String(N));
  build();
  const mine = sorted().filter((c) => c.t === i);
  pos = mine.length ? mine[0].n - 1 : 0; // si parte dalla prima testa già scelta di questa torre
  vel = 0;
  target = null;
  sel = 0;
  buildChips();
  refreshPos();
  hideNote();
  render();
  refreshLabels();
}

/** Pulsanti delle torri (solo se sono più d'una), con il numero di teste già scelte su ognuna */
function buildChips() {
  if (!els.torri) return;
  els.torri.innerHTML = '';
  els.torri.classList.toggle('hidden', torri.length < 2);
  if (torri.length < 2) return;
  torri.forEach((t, i) => {
    const count = [...chosen.values()].filter((c) => c.t === i).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === tIdx));
    b.className = `press-spring shrink-0 min-h-[36px] px-3 rounded-lg border text-xs font-display font-semibold uppercase tracking-wide transition-colors ${i === tIdx ? CHIP_ON : CHIP_OFF}`;
    b.textContent = `${t.nome || `Torre ${i + 1}`}${count ? ` · ${count}` : ''}`;
    b.addEventListener('click', () => {
      if (i !== tIdx) setTower(i);
    });
    els.torri.appendChild(b);
  });
}

/** Superiore / Inferiore: visibile solo per le torri con teste doppie */
function refreshPos() {
  if (!els.posWrap) return;
  els.posWrap.classList.toggle('hidden', !isDoppia() || !!fixedPos); // con la posizione decisa nella scheda articolo non si sceglie
  els.posBtns.forEach((b) => {
    const on = b.dataset.pos === curPos;
    b.setAttribute('aria-pressed', String(on));
    b.className = `press-spring flex-1 min-h-[40px] rounded-lg border text-xs font-display font-semibold uppercase tracking-wide transition-colors ${on ? CHIP_ON : CHIP_OFF}`;
  });
}

const NUM = (n) => n.toFixed(2);
// Punto a distanza r dal centro della stella, ad angolo f (gradi, orario da in alto), nel disegno non ruotato
const polar = (r, f) => {
  const rad = (f * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
};

/**
 * Disegna la stella della torre mostrata e le sue teste. Il raggio cresce col numero di teste (PITCH_MIN tra un alloggiamento
 * e l'altro); il centro si abbassa in modo che il bordo alto resti sempre a TOP_Y.
 */
function build() {
  pitchDeg = 360 / N;
  R = Math.max(R_MIN, Math.min(1800, (N * PITCH_MIN) / (2 * Math.PI)));
  CY = TOP_Y + R;
  const pitchArc = (2 * Math.PI * R) / N;
  const rn = Math.min(30, pitchArc * 0.44); // raggio dell'alloggiamento (più largo della testa: resta un bordo visibile)
  headR = Math.max(6, rn - 5);
  const rc = R - rn * 0.3; // centro degli alloggiamenti: la testa sta dentro per la maggior parte e sporge un poco, come un barattolo
  // incrocio tra il bordo della stella e l'alloggiamento: x lungo il raggio, ±h di lato
  const px = (rc * rc + R * R - rn * rn) / (2 * rc);
  const h = Math.sqrt(Math.max(0, R * R - px * px));
  const halfAng = (Math.asin(Math.min(1, h / R)) * 180) / Math.PI;

  // Contorno: alloggiamento (arco concavo) e tratto di bordo fino al successivo
  let d = '';
  for (let i = 0; i < N; i += 1) {
    const f = i * pitchDeg;
    const a = polar(R, f - halfAng); // lato antiorario dell'alloggiamento
    const b = polar(R, f + halfAng);
    const next = polar(R, f + pitchDeg - halfAng);
    const span = pitchDeg - 2 * halfAng;
    d += `${i === 0 ? 'M' : 'L'}${NUM(a.x)} ${NUM(a.y)}A${NUM(rn)} ${NUM(rn)} 0 1 0 ${NUM(b.x)} ${NUM(b.y)}`;
    d += `A${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${NUM(next.x)} ${NUM(next.y)}`;
  }
  els.star.setAttribute('d', `${d}Z`);

  // Sfumatura d'acciaio centrata sulla stella, anello interno e mozzo (tutto si sposta col centro)
  els.grad.setAttribute('cx', String(CX));
  els.grad.setAttribute('cy', NUM(CY));
  els.grad.setAttribute('r', NUM(R));
  els.grad.setAttribute('fx', String(CX));
  els.grad.setAttribute('fy', NUM(CY - R * 0.35));
  els.ring.setAttribute('cy', NUM(CY));
  els.ring.setAttribute('r', NUM(Math.max(40, R - rn * 2 - 14)));
  els.hub.setAttribute('cy', NUM(CY));
  for (const sh of [els.shadow1, els.shadow2]) {
    sh.setAttribute('cy', NUM(CY + 3));
    sh.setAttribute('r', NUM(R + 1));
  }

  els.layer.innerHTML = '';
  nodes = [];
  rcNow = rc;
  for (let i = 0; i < N; i += 1) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-i', String(i));
    g.style.cursor = 'pointer';
    // ombra fissa sotto la testa (un cerchio scuro e trasparente: niente filtri)
    const c0 = document.createElementNS(NS, 'circle');
    c0.setAttribute('r', NUM(headR + 0.8));
    c0.setAttribute('cy', '1.8');
    c0.setAttribute('fill', '#0d1117');
    c0.setAttribute('fill-opacity', '0.22');
    // la testa vista dall'alto, come il fondo di un barattolo: bordo d'acciaio e tondo interno
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', NUM(headR));
    c.setAttribute('fill', 'url(#testa-picker-rim)');
    const c2 = document.createElementNS(NS, 'circle');
    c2.setAttribute('r', NUM(headR * 0.76));
    c2.setAttribute('stroke-width', '1');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dy', '0.35em');
    t.setAttribute('font-size', String(Math.min(15, Math.max(8, headR * 0.72))));
    t.setAttribute('font-weight', '600');
    t.textContent = String(i + 1);
    g.append(c0, c, c2, t);
    els.layer.appendChild(g);
    nodes.push({ g, c, c2, t, vis: true, st: '' });
  }
}

/** Aspetto di una testa per stato; si applica solo quando lo stato cambia, non a ogni fotogramma */
function applyState(n, st) {
  n.st = st;
  const rim = (stroke, w) => {
    n.c.setAttribute('stroke', stroke);
    n.c.setAttribute('stroke-width', w);
  };
  const inner = (fill, stroke, text) => {
    n.c2.setAttribute('fill', fill);
    n.c2.setAttribute('stroke', stroke);
    n.t.setAttribute('fill', text);
  };
  if (st === 'chosen') {
    // scelta: tondo pieno nel colore dell'app (se è anche quella puntata, resta più grande)
    rim(EDGE, '1.2');
    inner('var(--accent)', 'var(--accent-dark, #24406f)', '#ffffff');
  } else if (st === 'cursor') {
    // puntata ma non ancora scelta: bordo spesso nel colore dell'app
    rim('var(--accent)', '3');
    inner('#ffffff', '#c5ccd6', 'var(--accent)');
  } else if (st === 'other') {
    // testa già scelta ma nell'altra posizione: contorno nel colore dell'app, senza riempimento
    rim('var(--accent)', '2');
    inner('var(--accent-tint-soft, #f3f4f8)', 'var(--accent)', 'var(--accent)');
  } else {
    rim(EDGE, '1.2');
    inner('#f7f8fa', '#c5ccd6', 'var(--ink, #0d1117)');
  }
}

function render() {
  const other = curPos === 'S' ? 'I' : 'S';
  els.wheel.setAttribute('transform', `rotate(${(-pos * pitchDeg).toFixed(2)} ${CX} ${NUM(CY)})`);
  for (let i = 0; i < N; i += 1) {
    let d = norm(i - pos);
    if (d >= N / 2) d -= N;
    const n = nodes[i];
    // la testa sta al suo posto sul bordo della stella; fuori dalla parte visibile non si tocca il DOM
    const p = polar(rcNow, d * pitchDeg);
    if (Math.abs(d * pitchDeg) > 100 || p.x < -45 || p.x > VBW + 45 || p.y > VBH + 45) {
      if (n.vis) {
        n.g.setAttribute('display', 'none');
        n.vis = false;
      }
      continue;
    }
    if (!n.vis) {
      n.g.removeAttribute('display');
      n.vis = true;
    }
    const scale = 1 + 0.2 * Math.max(0, 1 - Math.abs(d));
    n.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${scale.toFixed(2)})`);
    const st = chosen.has(keyOf(tIdx, i + 1, posNow()))
      ? 'chosen'
      : Math.abs(d) < 0.5
        ? 'cursor'
        : isDoppia() && chosen.has(keyOf(tIdx, i + 1, other)) // scelta nell'altra posizione (sup./inf.)
          ? 'other'
          : 'idle';
    if (st !== n.st) applyState(n, st);
  }
  const s = norm(Math.round(pos)) + 1;
  if (s !== sel) {
    sel = s;
    els.num.textContent = String(sel);
    els.svg.setAttribute('aria-valuenow', String(sel));
    refreshLabels();
    try {
      if (!holdDir) navigator.vibrate?.(6);
    } catch (err) {
      // non essenziale
    }
  }
}

/** Testi dei pulsanti e dell'elenco delle scelte (dipendono da testa puntata, scelte e quantità) */
function refreshLabels() {
  const n = chosen.size;
  const here = chosen.has(keyOf(tIdx, sel, posNow()));
  els.add.textContent = here ? `Togli ${nowDesc()}` : `Aggiungi ${nowDesc()}`;
  let ok;
  if (n === 0) ok = quantita === 1 ? `Conferma ${nowDesc()}` : `Scegli ${quantita} teste`;
  else if (quantita > 1) ok = `Conferma (${n} di ${quantita})`;
  else ok = n === 1 ? `Conferma ${descOf(sorted()[0]).replace(/^(.*· )?(\d+)/, '$1testa $2')}` : `Conferma ${n} teste`;
  els.ok.textContent = ok;
  if (n) {
    els.chosen.textContent = `${plural(n, 'Scelta', 'Scelte')}: ${sorted().map(descOf).join(' · ')}`;
    els.chosen.classList.remove('hidden');
  } else if (quantita > 1) {
    els.chosen.textContent = `Servono ${quantita} teste: puntale e tocca «Aggiungi testa»`;
    els.chosen.classList.remove('hidden');
  } else {
    els.chosen.classList.add('hidden');
  }
}

function toggle(n) {
  const k = keyOf(tIdx, n, posNow());
  if (chosen.has(k)) chosen.delete(k);
  else chosen.set(k, { t: tIdx, n, p: posNow() });
  hideNote();
  buildChips();
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
  close({ punti: list.map((c) => ({ torre: torri[c.t].nome, testa: c.n, pos: c.p })), quantita: qty });
}

function tryConfirm() {
  const picks = chosen.size ? sorted() : quantita === 1 ? [{ t: tIdx, n: sel, p: posNow() }] : [];
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
  if (holdDir) {
    // Tasto ◀ ▶ tenuto premuto: la stella gira da sola, sempre più veloce (tra 3 e 14 teste al secondo, in gradi
    // per essere ugualmente leggibile con poche o tante teste)
    const now = performance.now();
    const dt = Math.min(64, now - holdLast) / 1000;
    holdLast = now;
    const degPerSec = 150 + Math.min(300, ((now - holdT0) / 1000) * 260);
    pos += holdDir * Math.max(3, Math.min(14, degPerSec / pitchDeg)) * dt;
    vel = 0;
    target = null;
  } else if (!dragging) {
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
  if (holdDir || dragging || target !== null || Math.abs(vel) > 0.01) {
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
  return { x: ((e.clientX - r.left) * VBW) / r.width, y: ((e.clientY - r.top) * VBH) / r.height };
}

// Angolo del dito rispetto al centro della stella (gradi, in senso orario): ruotare = seguire il dito lungo il bordo
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
  pos -= da / pitchDeg;
  // velocità in teste per fotogramma (16,7 ms), calcolata sul tempo reale: non dipende da quanti eventi manda il telefono
  const now = performance.now();
  const dt = Math.max(1, now - lastT);
  lastT = now;
  vel = vel * 0.5 + ((-da / pitchDeg / dt) * 16.7) * 0.5;
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

/**
 * Pulsante ◀ ▶: un tocco sposta di una testa; tenuto premuto oltre 350 ms la stella gira di continuo finché non si rilascia,
 * poi si ferma sulla testa più vicina. Da tastiera (Invio/Spazio) è un passo alla volta.
 */
function bindHoldButton(btn, dir) {
  const stop = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (!holdDir) return;
    holdDir = 0;
    target = Math.round(pos);
    kick();
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    stepBy(dir); // subito, così il tocco breve risponde senza attese
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      // non essenziale
    }
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      holdDir = dir;
      holdT0 = performance.now();
      holdLast = holdT0;
      target = null;
      kick();
    }, 350);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => btn.addEventListener(t, stop));
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) stepBy(dir); // tastiera: il mouse e il tocco sono già gestiti da pointerdown
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // la pressione lunga sul telefono non apre il menu
}

function stepBy(k) {
  const base = target !== null ? target : Math.round(pos);
  target = base + k;
  vel = 0;
  kick();
}
