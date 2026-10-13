// =============================================================
// interventi-unseen.js — Interventi NUOVI inseriti da altri (pallino blu)
// =============================================================
// Per ogni utente registrato, sul suo telefono, si ricorda quali interventi ha già
// aperto. Un intervento è «nuovo» se: l'ha annotato un altro utente, è stato inserito
// dopo la prima volta che questo utente ha usato la funzione, e non è ancora stato aperto.
// Gli interventi già presenti alla prima apertura non vengono segnati (altrimenti
// sarebbero tutti «nuovi»). Il pallino sparisce toccando l'intervento.

import { authState } from './auth.js';

const MAX_SEEN = 500;

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

/** true se l'intervento è nuovo, inserito da un altro utente e non ancora aperto da chi guarda */
export function isUnseen(row) {
  const uid = myId();
  if (!uid || !row?.created_by || row.created_by === uid) return false;
  const st = load(uid);
  const created = new Date(row.created_at).getTime();
  return Number.isFinite(created) && created > st.baseline && !st.seen.includes(row.id);
}

/** Segna l'intervento come visto (chiamata quando lo si apre) */
export function markSeen(row) {
  const uid = myId();
  if (!uid || !row?.id) return;
  const st = load(uid);
  if (st.seen.includes(row.id)) return;
  st.seen.push(row.id);
  if (st.seen.length > MAX_SEEN) st.seen = st.seen.slice(-MAX_SEEN);
  save(uid, st);
}

/** Pallino blu da mettere accanto alla riga (posizionato nel margine sinistro, senza spostare il testo) */
export const UNSEEN_DOT_HTML =
  '<span data-unseen-dot class="absolute left-1 top-[1.1rem] w-2 h-2 rounded-full" style="background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)" role="img" aria-label="Nuovo"></span>';

/** Piccola legenda sopra l'elenco, per chi non sa cosa significa il pallino */
export const UNSEEN_LEGEND_HTML =
  '<p class="ui-note text-graphite-500 flex items-center gap-1.5 px-1"><span class="w-2 h-2 rounded-full shrink-0" style="background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)"></span> Nuovo inserito da altri \u2014 il pallino sparisce quando lo apri</p>';
