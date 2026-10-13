// =============================================================
// interventi-unseen.js — Interventi NUOVI inseriti da altri (pallino + avviso sul pulsante)
// =============================================================
// Per ogni utente registrato, sul suo telefono, si ricorda quali interventi ha già
// preso in visione. Un intervento è «nuovo» se: l'ha annotato un altro utente, è stato
// inserito dopo la prima volta che questo utente ha usato la funzione, e non è ancora
// stato aperto (o toccato sul pallino). Gli interventi già presenti alla prima apertura
// non vengono segnati (altrimenti sarebbero tutti «nuovi»).
//
// Il numero dei nuovi compare anche sul pulsante «Interventi» della barra in basso, così
// si nota un nuovo inserimento senza entrare nella sezione: si controlla all'avvio, una
// volta al minuto e quando l'app torna in primo piano.

import { authState } from './auth.js';
import { supabase } from './supabase.js';

const MAX_SEEN = 500;
const CHECK_EVERY_MS = 60 * 1000;
const CHANGED_EVENT = 'interventi-unseen-changed';

const keyFor = (uid) => `magazzino-interventi-nuovi-v1:${uid}`;
const myId = () => authState.profile?.id || null;

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

/** true se l'intervento è nuovo, inserito da un altro utente e non ancora preso in visione */
export function isUnseen(row) {
  const uid = myId();
  if (!uid || !row?.created_by || row.created_by === uid) return false;
  const st = load(uid);
  const created = new Date(row.created_at).getTime();
  return Number.isFinite(created) && created > st.baseline && !st.seen.includes(row.id);
}

/** Segna l'intervento come visto (quando lo si apre o si tocca il pallino) */
export function markSeen(row) {
  const uid = myId();
  if (!uid || !row?.id) return;
  const st = load(uid);
  if (st.seen.includes(row.id)) return;
  st.seen.push(row.id);
  if (st.seen.length > MAX_SEEN) st.seen = st.seen.slice(-MAX_SEEN);
  save(uid, st);
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Pallino con alone che pulsa; l'area toccabile è più grande del pallino (sta nel margine sinistro della riga) */
export const UNSEEN_DOT_HTML =
  '<span data-unseen-hit class="unseen-hit" role="button" aria-label="Nuovo intervento: tocca per segnarlo come visto"><span class="unseen-dot"></span></span>';

/** Presa visione: il pallino si ingrandisce e poi implode. Chiamare subito dopo markSeen. */
export function dismissDot(row) {
  const hit = row.querySelector('[data-unseen-hit]');
  if (!hit) return;
  const dot = hit.querySelector('.unseen-dot');
  const remove = () => hit.remove();
  if (!dot) return remove();
  dot.classList.add('unseen-dot-out');
  dot.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 800); // rete di sicurezza se l'animazione non parte
}

// ---------------------------------------------------------------- Avviso sul pulsante «Interventi» --

let fetchedIds = [];
let badgeEl = null;
let started = false;

function ensureBadge() {
  if (badgeEl?.isConnected) return badgeEl;
  const wrap = document.querySelector('[data-nav-target="interventi"] .nav-icon-wrap');
  if (!wrap) return null;
  badgeEl = document.createElement('span');
  badgeEl.className = 'unseen-badge hidden';
  badgeEl.setAttribute('aria-hidden', 'true');
  wrap.appendChild(badgeEl);
  return badgeEl;
}

function paintBadge() {
  const uid = myId();
  const badge = ensureBadge();
  if (!badge) return;
  const seen = uid ? new Set(load(uid).seen) : new Set();
  const count = uid ? fetchedIds.filter((id) => !seen.has(id)).length : 0;
  badge.classList.toggle('hidden', count === 0);
  badge.textContent = count > 9 ? '9+' : String(count);
  const button = badge.closest('[data-nav-target]');
  if (button) button.setAttribute('aria-label', count ? `Interventi: ${count} nuovi` : 'Interventi');
}

/** Interroga il database: quanti interventi di altri, nuovi per me, non ho ancora preso in visione */
export async function refreshUnseenBadge() {
  const uid = myId();
  if (!uid) {
    fetchedIds = [];
    paintBadge();
    return;
  }
  try {
    const { baseline } = load(uid);
    const { data, error } = await supabase
      .from('manutenzioni_soste')
      .select('id')
      .gt('created_at', new Date(baseline).toISOString())
      .neq('created_by', uid)
      .limit(200);
    if (error) throw error;
    fetchedIds = (data || []).map((r) => r.id);
    paintBadge();
  } catch (err) {
    console.warn('Controllo interventi nuovi non riuscito.', err);
  }
}

export function initUnseenBadge() {
  if (started) return;
  started = true;
  window.addEventListener(CHANGED_EVENT, paintBadge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshUnseenBadge();
  });
  window.addEventListener('online', refreshUnseenBadge);
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshUnseenBadge();
  }, CHECK_EVERY_MS);
  refreshUnseenBadge();
}
