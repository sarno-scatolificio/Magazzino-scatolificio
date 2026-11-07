// =============================================================
// passkey.js — Accesso con impronta/volto (WebAuthn) lato telefono
// =============================================================
// Il telefono tiene la chiave privata e mostra la schermata dell'impronta; la verifica la fa la Edge Function
// (js/data/supabase-passkey.js). Su questo dispositivo si ricordano gli utenti che hanno attivato l'impronta
// (solo identificativo della passkey, email e nome: nessun segreto), per proporre l'accesso giusto alla riapertura.

import { applyPasskeySession, passkeyRequest, PasskeyServerError } from '../data/supabase.js';

const HINTS_KEY = 'mate.passkeys';
const MAX_HINTS = 5;

export class PasskeyError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PasskeyError';
    this.code = code; // cancelled | unsupported | already | unknown_credential | network | config | failed ...
  }
}

// --- base64url ---------------------------------------------------
const toBytes = (b64u) => {
  const b64 = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const toB64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// --- Supporto del telefono -----------------------------------------
export function passkeySupported() {
  return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials);
}

/** True se il telefono ha un blocco con impronta/volto/PIN utilizzabile per le passkey. */
export async function passkeyPlatformReady() {
  if (!passkeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (err) {
    return false;
  }
}

// --- Utenti ricordati su questo dispositivo --------------------------
export function getPasskeyHints() {
  try {
    const list = JSON.parse(localStorage.getItem(HINTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((h) => h && typeof h.credentialId === 'string') : [];
  } catch (err) {
    return [];
  }
}

function saveHints(list) {
  try {
    localStorage.setItem(HINTS_KEY, JSON.stringify(list.slice(0, MAX_HINTS)));
  } catch (err) {
    // non essenziale: senza memoria locale il pulsante sul login semplicemente non compare
  }
}

/** Mette in testa (ultimo usato) la passkey di questo utente. */
export function rememberPasskey({ credentialId, email, name }) {
  saveHints([{ credentialId, email: email || '', name: name || '' }, ...getPasskeyHints().filter((h) => h.credentialId !== credentialId)]);
}

export function forgetPasskey(credentialId) {
  saveHints(getPasskeyHints().filter((h) => h.credentialId !== credentialId));
}

/** L'utente che di solito accede da questo dispositivo (l'ultimo che ha usato o attivato l'impronta). */
export function lastPasskeyHint() {
  return getPasskeyHints()[0] || null;
}

function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Dispositivo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${browser ? ` · ${browser}` : ''}`;
}

function mapError(err) {
  if (err instanceof PasskeyError) return err;
  if (err instanceof PasskeyServerError) return new PasskeyError(err.code, err.message);
  // Annullato dall'utente o tempo scaduto (NotAllowedError), oppure richiesta sostituita da un'altra (AbortError)
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return new PasskeyError('cancelled');
  if (err?.name === 'InvalidStateError') return new PasskeyError('already');
  if (err?.name === 'NotSupportedError' || err?.name === 'SecurityError') return new PasskeyError('unsupported');
  return new PasskeyError('failed', err?.message);
}

// --- Attivazione (utente già connesso) -----------------------------------
/** Crea la passkey su questo dispositivo (schermata dell'impronta) e la registra sul server. */
export async function registerPasskey({ accessToken, email, name }) {
  if (!passkeySupported()) throw new PasskeyError('unsupported');
  try {
    const opts = await passkeyRequest('register-options', {}, accessToken);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: toBytes(opts.challenge),
        rp: opts.rp,
        user: { id: toBytes(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: (opts.excludeCredentials || []).map((id) => ({ type: 'public-key', id: toBytes(id) })),
        timeout: opts.timeout,
        attestation: 'none',
      },
    });
    if (!cred) throw new PasskeyError('cancelled');
    const r = cred.response;
    // Chiave pubblica e dati dell'autenticatore: metodi presenti nei browser recenti (Chrome/Edge 85+, Safari 16+, Firefox 119+)
    if (typeof r.getPublicKey !== 'function' || typeof r.getAuthenticatorData !== 'function' || !r.getPublicKey()) {
      throw new PasskeyError('unsupported');
    }
    await passkeyRequest(
      'register-verify',
      {
        credentialId: cred.id,
        clientDataJSON: toB64u(r.clientDataJSON),
        authenticatorData: toB64u(r.getAuthenticatorData()),
        publicKey: toB64u(r.getPublicKey()),
        publicKeyAlgorithm: r.getPublicKeyAlgorithm(),
        transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
        deviceLabel: deviceLabel(),
      },
      accessToken
    );
    rememberPasskey({ credentialId: cred.id, email, name });
    return cred.id;
  } catch (err) {
    throw mapError(err);
  }
}

// --- Accesso -------------------------------------------------------------
/**
 * Mostra la schermata dell'impronta per le passkey ricordate su questo dispositivo e, se la verifica del server va
 * a buon fine, apre la sessione. Lancia PasskeyError (code 'cancelled' se l'utente annulla).
 */
export async function loginWithPasskey() {
  if (!passkeySupported()) throw new PasskeyError('unsupported');
  const hints = getPasskeyHints();
  if (hints.length === 0) throw new PasskeyError('unknown_credential');
  let assertion = null;
  try {
    const opts = await passkeyRequest('login-options');
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: toBytes(opts.challenge),
        rpId: opts.rpId,
        allowCredentials: hints.map((h) => ({ type: 'public-key', id: toBytes(h.credentialId), transports: ['internal'] })),
        userVerification: 'required',
        timeout: opts.timeout,
      },
    });
    if (!assertion) throw new PasskeyError('cancelled');
    const r = assertion.response;
    const tokens = await passkeyRequest('login-verify', {
      credentialId: assertion.id,
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature),
    });
    await applyPasskeySession(tokens);
    const hint = hints.find((h) => h.credentialId === assertion.id);
    if (hint) rememberPasskey(hint); // l'ultimo che ha acceduto passa in testa
    return assertion.id;
  } catch (err) {
    const mapped = mapError(err);
    // Passkey revocata o non più presente sul server: da questo telefono non va più proposta
    if (mapped.code === 'unknown_credential' && assertion?.id) forgetPasskey(assertion.id);
    throw mapped;
  }
}
