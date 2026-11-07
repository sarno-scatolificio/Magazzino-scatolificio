// =============================================================
// supabase-passkey.js — Accesso con impronta (passkey): Edge Function `passkey` e passkey dell'utente
// =============================================================
// La verifica vera sta nella Edge Function (supabase/functions/passkey): qui solo le chiamate. Le passkey le
// crea e le controlla solo la funzione; dall'app si possono leggere ed eliminare le proprie (RLS).

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

export class PasskeyServerError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'PasskeyServerError';
    this.code = code; // network | config | not_authenticated | unknown_credential | limit | duplicate | server | ...
    this.status = status;
  }
}

/** Chiama una azione della funzione. `accessToken` serve solo in registrazione (utente già connesso). */
export async function passkeyRequest(action, body = {}, accessToken = null) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/passkey`, { method: 'POST', headers, body: JSON.stringify({ action, ...body }) });
  } catch (err) {
    throw new PasskeyServerError('network', 'Connessione assente');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    // risposta senza JSON (es. funzione non pubblicata): resta l'errore generico qui sotto
  }
  if (!res.ok) throw new PasskeyServerError(data?.code || (res.status === 404 ? 'config' : 'server'), data?.error || 'Errore del server', res.status);
  return data;
}

/** Apre la sessione con i token restituiti dalla funzione dopo la verifica dell'impronta. */
export async function applyPasskeySession({ access_token, refresh_token }) {
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

/** Passkey dell'utente connesso (una per dispositivo su cui ha attivato l'impronta). */
export async function listMyPasskeys() {
  const { data, error } = await supabase
    .from('passkey_credentials')
    .select('id, credential_id, device_label, created_at, last_used_at')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function deleteMyPasskey(credentialId) {
  const { error } = await supabase.from('passkey_credentials').delete().eq('credential_id', credentialId);
  if (error) throw error;
}
