// =============================================================
// push.js — Notifiche push del browser (nuovi interventi da effettuare)
// =============================================================
// Questo dispositivo si "abbona" alle notifiche tramite il service worker; l'abbonamento viene salvato sul
// database dell'app (supabase-push.js). A inviare le notifiche è la edge function «notify-nuovo-intervento»,
// che le manda a tutti tranne chi ha inserito l'intervento. Dalle 22 alle 7 le notifiche non partono: restano
// in coda sul server e vengono inviate dopo le 7.
//
// Chi è l'utente "acceso" su questo dispositivo lo ricorda localStorage (FLAG_KEY): così, se un collega
// entra con il suo account sullo stesso telefono, non eredita le notifiche di chi c'era prima.

import { savePushSubscription, deletePushSubscription } from '../data/supabase.js';

// Chiave PUBBLICA (VAPID): non è un segreto. Quella privata sta solo sul server.
const VAPID_PUBLIC_KEY = 'BCgqoDAvA-tzQJH6DB3joYyTQWWApbo_154_-fXGddatyjb5AfB_je76Ni9aByXEQiokX0g8FPFxEsnxD3VwTiQ';
const FLAG_KEY = 'magazzino-push-user';

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

function savedUser() {
  try {
    return localStorage.getItem(FLAG_KEY);
  } catch (err) {
    return null;
  }
}

function setSavedUser(uid) {
  try {
    if (uid) localStorage.setItem(FLAG_KEY, uid);
    else localStorage.removeItem(FLAG_KEY);
  } catch (err) {
    /* senza storage l'interruttore si riallinea ma non ricorda l'utente */
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

/** L'interruttore è acceso per questo utente su questo dispositivo? */
export async function isPushOn(uid) {
  if (!pushSupported() || Notification.permission !== 'granted' || savedUser() !== uid) return false;
  try {
    return !!(await currentSubscription());
  } catch (err) {
    return false;
  }
}

/** Attiva: chiede il permesso (serve un tocco dell'utente), si abbona e salva l'abbonamento */
export async function enablePush(uid) {
  if (!pushSupported()) throw new PushError('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied');
  const reg = await getRegistration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await savePushSubscription(subscription);
  setSavedUser(uid);
}

/** Disattiva: cancella l'abbonamento dal server e dal browser */
export async function disablePush() {
  setSavedUser(null);
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await deletePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch (err) {
    /* niente da disattivare */
  }
}

/** All'accesso: se per questo utente le notifiche erano accese, si riattivano (l'abbonamento si riaggancia a lui) */
export async function resumePush(uid) {
  if (!(await isPushOn(uid))) return false;
  try {
    const subscription = await currentSubscription();
    if (subscription) await savePushSubscription(subscription);
    return true;
  } catch (err) {
    return false;
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
