// =============================================================
// passkey — Edge Function (Supabase): accesso con impronta (WebAuthn)
// =============================================================
// Azioni (POST JSON { action, ... }):
//   register-options / register-verify  → l'utente GIÀ CONNESSO attiva l'impronta su questo dispositivo
//   login-options    / login-verify     → senza password: verifica l'impronta e restituisce una sessione
// La chiave privata resta nel telefono; qui si salva solo la chiave pubblica (tabella passkey_credentials).
// Il login controlla: sfida firmata dal server e non scaduta, usata una volta sola, sito (origine) ammesso, dominio
// della passkey, impronta/volto eseguiti sul telefono, firma e contatore. Poi apre la sessione dell'utente
// (generateLink + verifyOtp) e restituisce i token: nessuna email viene inviata.
//
// MESSA IN OPERA (una volta, da chi amministra Supabase):
//   1) eseguire database/migrazioni/2026-11-07-passkey.sql nel SQL Editor (meglio prima su un progetto di prova)
//   2) indicare l'indirizzo ESATTO del sito (anche più di uno, separati da virgola, senza / finale):
//        supabase secrets set PASSKEY_ORIGINS=https://tuo-sito.pages.dev
//      (la passkey è legata al dominio: se il dominio cambia vanno riattivate)
//   3) pubblicare la funzione SENZA verifica JWT (la chiave dell'app è "publishable", non un JWT; chi chiama la
//      funzione si autentica da solo: sessione in registrazione, impronta nel login):
//        supabase functions deploy passkey --no-verify-jwt
// Le variabili SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY le fornisce Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PURPOSE_LOGIN,
  PURPOSE_REGISTER,
  b64uDecode,
  b64uEncode,
  checkAuthData,
  checkChallenge,
  isUsablePublicKey,
  makeChallenge,
  readClientData,
  verifyAssertionSignature,
} from './webauthn.ts';

const MAX_PASSKEYS_PER_USER = 5;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

Deno.serve(async (req: Request) => {
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  const allowed = (Deno.env.get('PASSKEY_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const corsOk = allowed.includes(origin);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Vary: 'Origin' };
  if (corsOk) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const fail = (code: string, status = 401) => json({ error: 'Accesso con impronta non riuscito', code }, status);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);
  if (allowed.length === 0) return json({ error: 'Configurazione mancante: segreto PASSKEY_ORIGINS non impostato', code: 'config' }, 500);
  if (!corsOk) return json({ error: 'Origine non ammessa', code: 'origin' }, 403);

  const rpId = new URL(origin).hostname;
  // Le chiamate arrivano dal browser: il corpo è un JSON con "action"
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Richiesta non valida', code: 'bad_request' }, 400);
  }

  try {
    // ---------- Registrazione (utente già connesso) ----------
    if (body.action === 'register-options' || body.action === 'register-verify') {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: userData, error: userError } = token ? await admin.auth.getUser(token) : { data: null, error: new Error('no token') };
      const user = userData?.user;
      if (userError || !user) return fail('not_authenticated');

      const { data: existing, error: existingError } = await admin.from('passkey_credentials').select('credential_id').eq('user_id', user.id);
      if (existingError) throw existingError;

      if (body.action === 'register-options') {
        const challenge = await makeChallenge(SECRET, PURPOSE_REGISTER, user.id);
        return json({
          challenge: b64uEncode(challenge),
          rp: { id: rpId, name: 'MATE Magazzino' },
          user: {
            id: b64uEncode(new TextEncoder().encode(user.id)),
            name: user.email || user.id,
            displayName: (user.user_metadata?.full_name as string) || user.email || 'Utente',
          },
          excludeCredentials: (existing || []).map((c) => c.credential_id),
          timeout: 60000,
        });
      }

      const credentialId = str(body.credentialId, 1400);
      const clientDataB64 = str(body.clientDataJSON, 4000);
      const authDataB64 = str(body.authenticatorData, 4000);
      const publicKeyB64 = str(body.publicKey, 2000);
      const alg = Number(body.publicKeyAlgorithm);
      if (!credentialId || !clientDataB64 || !authDataB64 || !publicKeyB64) return json({ error: 'Richiesta non valida', code: 'bad_request' }, 400);

      const clientDataBytes = b64uDecode(clientDataB64);
      const client = readClientData(clientDataBytes, 'webauthn.create', [origin]);
      if (!client || client.origin !== origin) return fail('client_data');
      if (!(await checkChallenge(SECRET, client.challenge, PURPOSE_REGISTER, user.id))) return fail('challenge');
      const auth = await checkAuthData(b64uDecode(authDataB64), rpId);
      if (!auth) return fail('auth_data');
      const publicKey = b64uDecode(publicKeyB64);
      if (!(await isUsablePublicKey(publicKey, alg))) return fail('public_key', 400);
      if ((existing || []).length >= MAX_PASSKEYS_PER_USER) return json({ error: 'Troppi dispositivi: toglierne uno prima', code: 'limit' }, 409);

      const transports = Array.isArray(body.transports) ? body.transports.filter((t) => typeof t === 'string').slice(0, 6) : null;
      const { error: insertError } = await admin.from('passkey_credentials').insert({
        user_id: user.id,
        credential_id: credentialId,
        public_key: publicKeyB64,
        alg,
        sign_count: auth.signCount,
        transports,
        device_label: str(body.deviceLabel, 80),
      });
      if (insertError) {
        if (insertError.code === '23505') return json({ error: 'Passkey già registrata', code: 'duplicate' }, 409);
        throw insertError;
      }
      return json({ ok: true });
    }

    // ---------- Accesso (senza sessione) ----------
    if (body.action === 'login-options') {
      const challenge = await makeChallenge(SECRET, PURPOSE_LOGIN);
      return json({ challenge: b64uEncode(challenge), rpId, timeout: 60000 });
    }

    if (body.action === 'login-verify') {
      const credentialId = str(body.credentialId, 1400);
      const clientDataB64 = str(body.clientDataJSON, 4000);
      const authDataB64 = str(body.authenticatorData, 4000);
      const signatureB64 = str(body.signature, 2000);
      if (!credentialId || !clientDataB64 || !authDataB64 || !signatureB64) return json({ error: 'Richiesta non valida', code: 'bad_request' }, 400);

      const { data: cred, error: credError } = await admin
        .from('passkey_credentials')
        .select('id, user_id, public_key, alg, sign_count')
        .eq('credential_id', credentialId)
        .maybeSingle();
      if (credError) throw credError;
      if (!cred) return fail('unknown_credential'); // revocata o mai registrata: l'app toglie il pulsante da questo telefono

      const clientDataBytes = b64uDecode(clientDataB64);
      const authDataBytes = b64uDecode(authDataB64);
      const client = readClientData(clientDataBytes, 'webauthn.get', [origin]);
      if (!client || client.origin !== origin) return fail('client_data');
      const challenge = await checkChallenge(SECRET, client.challenge, PURPOSE_LOGIN);
      if (!challenge) return fail('challenge');
      const auth = await checkAuthData(authDataBytes, rpId);
      if (!auth) return fail('auth_data');
      if (!(await verifyAssertionSignature(b64uDecode(cred.public_key), cred.alg, authDataBytes, clientDataBytes, b64uDecode(signatureB64)))) {
        return fail('signature');
      }
      // Contatore: se il dispositivo lo usa deve solo crescere (un valore che non cresce indica una passkey clonata)
      if ((cred.sign_count > 0 || auth.signCount > 0) && auth.signCount <= Number(cred.sign_count)) return fail('counter');

      // Una sfida vale una volta sola: la stessa risposta non si può riusare
      await admin.from('passkey_challenges_used').delete().lt('expires_at', new Date().toISOString());
      const { error: usedError } = await admin.from('passkey_challenges_used').insert({
        nonce: challenge.nonce,
        expires_at: new Date(challenge.expiresAt + 60_000).toISOString(),
      });
      if (usedError) {
        if (usedError.code === '23505') return fail('replay');
        throw usedError;
      }

      await admin.from('passkey_credentials').update({ sign_count: auth.signCount, last_used_at: new Date().toISOString() }).eq('id', cred.id);

      // Sessione dell'utente: link di accesso generato dal server e riscattato subito (nessuna email inviata)
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(cred.user_id);
      const email = userData?.user?.email;
      if (userError || !email) return fail('user');
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const tokenHash = link?.properties?.hashed_token;
      if (linkError || !tokenHash) throw linkError || new Error('hashed_token mancante');
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { data: sessionData, error: otpError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
      const session = sessionData?.session;
      if (otpError || !session) throw otpError || new Error('sessione non creata');
      return json({ access_token: session.access_token, refresh_token: session.refresh_token });
    }

    return json({ error: 'Azione sconosciuta', code: 'bad_request' }, 400);
  } catch (err) {
    console.error('passkey:', err);
    return json({ error: 'Errore del server', code: 'server' }, 500);
  }
});
