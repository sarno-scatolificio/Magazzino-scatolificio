// =============================================================
// push.js — Notifiche push del browser (nuovi interventi, articoli sotto scorta)
// =============================================================
// Questo dispositivo si "abbona" alle notifiche tramite il service worker; l'abbonamento viene salvato sul
// database dell'app (supabase-push.js) insieme alle due preferenze: «interventi» e «scorta». A inviare le
// notifiche sono le edge function «notify-nuovo-intervento» e «notify-sotto-scorta». Dalle 22 alle 7 non parte
// nulla: restano in coda sul server e vengono inviate dopo le 7.
//
// Chi è l'utente "acceso" su questo dispositivo e quali notifiche ha scelto lo ricorda localStorage (PREFS_KEY):
// così, se un collega entra con il suo account sullo stesso telefono, non eredita le notifiche di chi c'era prima.
// L'abbonamento del browser è uno solo: si cancella (dal server e dal browser) solo quando entrambe sono spente.

import { savePushSubscription, deletePushSubscription } from '../data/supabase.js';

// Chiave PUBBLICA (VAPID): non è un segreto. Quella privata sta solo sul server.
const VAPID_PUBLIC_KEY = 'BCgqoDAvA-tzQJH6DB3joYyTQWWApbo_154_-fXGddatyjb5AfB_je76Ni9aByXEQiokX0g8FPFxEsnxD3VwTiQ';
const PREFS_KEY = 'magazzino-push-prefs'; // { uid, interventi, scorta }
const LEGACY_KEY = 'magazzino-push-user'; // versione precedente: solo l'id utente (allora c'erano solo gli interventi)

export class PushError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'unsupported' | 'denied'
  }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission() {
  return 'Notification' in window ? Notification.permission : 'denied';
}

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const none = () => ({ interventi: false, scorta: false });
const anyOn = (prefs) => prefs.interventi || prefs.scorta;

/** Preferenze ricordate su questo dispositivo per questo utente */
function savedPrefs(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (raw && raw.uid === uid) return { interventi: !!raw.interventi, scorta: !!raw.scorta };
    if (localStorage.getItem(LEGACY_KEY) === uid) return { interventi: true, scorta: false };
  } catch (err) {
    /* memoria locale non leggibile: come se non ci fossero preferenze */
  }
  return none();
}

function storePrefs(uid, prefs) {
  try {
    localStorage.removeItem(LEGACY_KEY);
    if (anyOn(prefs)) localStorage.setItem(PREFS_KEY, JSON.stringify({ uid, ...prefs }));
    else localStorage.removeItem(PREFS_KEY);
  } catch (err) {
    /* senza storage l'interruttore si riallinea ma non ricorda le scelte */
  }
}

/** Service worker pronto (con un tempo massimo: se non è registrato non si resta in attesa all'infinito) */
async function getRegistration() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  if (!reg) throw new PushError('unsupported');
  return reg;
}

async function currentSubscription() {
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

/** Chiede il permesso (serve un tocco dell'utente) e si abbona, se non lo è già */
async function ensureSubscription() {
  if (!pushSupported()) throw new PushError('unsupported');
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new PushError('denied');
  }
  const reg = await getRegistration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  return subscription;
}

/**
 * Accende o spegne un tipo di notifica ('interventi' | 'scorta') su questo dispositivo.
 * Ritorna le preferenze aggiornate. Se si spegne l'ultima, l'abbonamento viene cancellato.
 */
export async function setPushPref(uid, kind, on) {
  const next = { ...savedPrefs(uid), [kind]: !!on };
  if (!anyOn(next)) {
    await disablePush();
    return next;
  }
  const subscription = await ensureSubscription();
  await savePushSubscription(subscription, next);
  storePrefs(uid, next);
  return next;
}

/** Spegne tutto: cancella l'abbonamento dal server e dal browser */
export async function disablePush() {
  try {
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch (err) {
    /* niente da pulire */
  }
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await deletePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch (err) {
    /* niente da disattivare */
  }
}

/** All'accesso: riattiva (con le stesse preferenze) l'abbonamento di questo utente. Ritorna le preferenze in vigore. */
export async function resumePush(uid) {
  const prefs = savedPrefs(uid);
  if (!pushSupported() || Notification.permission !== 'granted' || !anyOn(prefs)) return none();
  try {
    const subscription = await currentSubscription();
    if (!subscription) return none();
    await savePushSubscription(subscription, prefs);
    return prefs;
  } catch (err) {
    return none();
  }
}

/** All'uscita: l'abbonamento non resta legato all'utente appena uscito (non riceve più avvisi finché non rientra) */
export async function pausePush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const subscription = await currentSubscription();
    if (subscription) await deletePushSubscription(subscription.endpoint);
  } catch (err) {
    /* offline o non abbonato: nulla da fare */
  }
}
