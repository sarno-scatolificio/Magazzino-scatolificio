// =============================================================
// low-stock-unseen.js — Articoli andati SOTTO SCORTA MINIMA da poco (pallino + avviso sul pulsante Movimenti)
// =============================================================
// Il database segna, su ogni articolo, l'istante in cui è sceso sotto la scorta minima (products.sotto_scorta_dal).
// Per ogni utente, sul suo dispositivo, si ricorda quali di queste discese ha già visto. Un articolo è «nuovo» se è
// sceso sotto scorta dopo la prima volta che questo utente ha usato la funzione e non l'ha ancora visto nelle
// piastrelle «Articoli sotto scorta» della sezione Movimenti: lo si vede quando si apre la piastrella dello scaffale
// in cui compare. Gli articoli già sotto scorta alla prima apertura non fanno pallino (non sono «appena scesi»).
// Se un articolo torna a posto e poi riscende, è una nuova discesa: il pallino ricompare.
//
// Il numero degli articoli nuovi compare anche sul pulsante «Movimenti» della barra in basso e come pallino sulla
// scheda «Articoli sotto scorta» (anche chiusa): si controlla all'avvio, una volta al minuto, quando l'app torna in
// primo piano e dopo ogni movimento registrato da questo dispositivo. Vale per tutti gli utenti, Admin compresi.

import { authState } from '../../core/auth.js';
import { supabase } from '../../data/supabase.js';
import { UNSEEN_DOT_HTML, dismissDot } from '../interventi/interventi-unseen.js';

export { UNSEEN_DOT_HTML, dismissDot };

const MAX_SEEN = 500;
const CHECK_EVERY_MS = 60 * 1000;
const CHANGED_EVENT = 'lowstock-unseen-changed';

const keyFor = (uid) => `magazzino-scorta-nuovi-v1:${uid}`;
const myId = () => authState.profile?.id || null;
/** Ogni discesa è un evento a sé: id + istante, così una nuova discesa dello stesso articolo fa ricomparire il pallino */
const seenKey = (p) => `${p.id}@${p.sotto_scorta_dal}`;

function load(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(uid)) || 'null');
    if (raw && Number.isFinite(raw.baseline) && Array.isArray(raw.seen)) return raw;
  } catch {
    /* memoria locale non leggibile: si riparte */
  }
  const fresh = { baseline: Date.now(), seen: [] };
  save(uid, fresh);
  return fresh;
}

function save(uid, state) {
  try {
    localStorage.setItem(keyFor(uid), JSON.stringify(state));
  } catch {
    /* memoria piena: il pallino potrebbe ricomparire, nient'altro */
  }
}

/** true se l'articolo è sceso sotto scorta dopo che questo utente ha iniziato a usare la funzione e non è ancora stato visto */
export function isUnseen(product) {
  const uid = myId();
  if (!uid || !product?.id || !product.sotto_scorta_dal) return false;
  const st = load(uid);
  const since = new Date(product.sotto_scorta_dal).getTime();
  return Number.isFinite(since) && since > st.baseline && !st.seen.includes(seenKey(product));
}

/** Segna come visti questi articoli (quando compaiono nella piastrella aperta). Un solo aggiornamento per tutti. */
export function markSeenMany(products) {
  const uid = myId();
  if (!uid) return;
  const st = load(uid);
  let changed = false;
  products.forEach((p) => {
    if (!p?.id || !p.sotto_scorta_dal) return;
    const key = seenKey(p);
    if (st.seen.includes(key)) return;
    st.seen.push(key);
    changed = true;
  });
  if (!changed) return;
  if (st.seen.length > MAX_SEEN) st.seen = st.seen.slice(-MAX_SEEN);
  save(uid, st);
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

// ---------------------------------------------------------------- Avvisi: pulsante «Movimenti» e scheda --

let fetchedRows = []; // [{ id, sotto_scorta_dal }] sceso sotto scorta dopo la mia baseline
let badgeEl = null;
let started = false;

function unseenCount() {
  const uid = myId();
  if (!uid) return 0;
  const seen = new Set(load(uid).seen);
  return fetchedRows.filter((r) => !seen.has(seenKey(r))).length;
}

function ensureBadge() {
  if (badgeEl?.isConnected) return badgeEl;
  const wrap = document.querySelector('[data-nav-target="scanner"] .nav-icon-wrap');
  if (!wrap) return null;
  badgeEl = document.createElement('span');
  badgeEl.className = 'unseen-badge hidden';
  badgeEl.setAttribute('aria-hidden', 'true');
  wrap.appendChild(badgeEl);
  return badgeEl;
}

function paintBadge(count) {
  const badge = ensureBadge();
  if (!badge) return;
  badge.classList.toggle('hidden', count === 0);
  badge.textContent = count > 9 ? '9+' : String(count);
  const button = badge.closest('[data-nav-target]');
  if (button) button.setAttribute('aria-label', count ? `Movimenti: ${count} articoli appena andati sotto scorta` : 'Movimenti');
}

/** Pallino sulla scheda «Articoli sotto scorta» (visibile anche a scheda chiusa) finché ci sono articoli nuovi da vedere */
function paintHeaderDot(count) {
  const header = document.getElementById('scanner-lowstock-btn');
  if (!header) return;
  const has = !!header.querySelector('[data-unseen-hit]');
  if (count > 0 && !has) header.insertAdjacentHTML('afterbegin', UNSEEN_DOT_HTML);
  else if (count === 0 && has) dismissDot(header);
}

function paint() {
  const count = unseenCount();
  paintBadge(count);
  paintHeaderDot(count);
}

/** Interroga il database: quali articoli sono scesi sotto scorta dopo la mia baseline (e non ho ancora visto) */
export async function refreshLowStockUnseen() {
  const uid = myId();
  if (!uid) {
    fetchedRows = [];
    paint();
    return;
  }
  try {
    const { baseline } = load(uid);
    const { data, error } = await supabase
      .from('products')
      .select('id, sotto_scorta_dal')
      .not('sotto_scorta_dal', 'is', null) // null = a posto (o già sotto scorta prima dell'attivazione della funzione)
      .gt('sotto_scorta_dal', new Date(baseline).toISOString())
      .limit(200);
    if (error) throw error;
    fetchedRows = data || [];
    paint();
  } catch (err) {
    console.warn('Controllo articoli appena andati sotto scorta non riuscito.', err);
  }
}

export function initLowStockUnseen() {
  if (started) return;
  started = true;
  window.addEventListener(CHANGED_EVENT, paint);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshLowStockUnseen();
  });
  window.addEventListener('online', refreshLowStockUnseen);
  // Dopo un movimento registrato da questo dispositivo la giacenza può essere scesa sotto scorta
  window.addEventListener('products-version-bumped', () => setTimeout(refreshLowStockUnseen, 400));
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshLowStockUnseen();
  }, CHECK_EVERY_MS);
  refreshLowStockUnseen();
}
