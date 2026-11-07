// =============================================================
// webauthn.ts — Verifica WebAuthn (passkey) senza librerie esterne
// =============================================================
// Solo funzioni pure su Web Crypto (uguale in Deno e Node): niente accesso a database o rete, così si può
// provare da sola. Usata da index.ts. Supporta ES256 (-7) e RS256 (-257), cioè le passkey di Android, iPhone e Windows.

const enc = new TextEncoder();

export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(text: string): Uint8Array {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- Sfida (challenge) senza stato ------------------------------
// 55 byte: nonce(16) | scadenza ms(6) | scopo(1) | utente(16, a zero nel login) | firma HMAC troncata(16).
// Così il server non deve ricordare le sfide emesse: la firma dice che le ha emesse lui, quando scadono e per cosa.
export const PURPOSE_REGISTER = 1;
export const PURPOSE_LOGIN = 2;
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

async function hmac(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource)).slice(0, 16);
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('uuid non valido');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export async function makeChallenge(secret: string, purpose: number, userId?: string, now = Date.now()): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const exp = new Uint8Array(6);
  let t = now + CHALLENGE_TTL_MS;
  for (let i = 5; i >= 0; i -= 1) {
    exp[i] = t % 256;
    t = Math.floor(t / 256);
  }
  const body = concat(nonce, exp, Uint8Array.of(purpose), userId ? uuidBytes(userId) : new Uint8Array(16));
  return concat(body, await hmac(secret, body));
}

/** Controlla firma, scopo, scadenza e (in registrazione) utente. Restituisce il nonce, o null se la sfida non è valida. */
export async function checkChallenge(
  secret: string,
  challenge: Uint8Array,
  purpose: number,
  userId?: string,
  now = Date.now()
): Promise<{ nonce: string; expiresAt: number } | null> {
  if (challenge.length !== 55) return null;
  const body = challenge.slice(0, 39);
  if (!equalBytes(await hmac(secret, body), challenge.slice(39))) return null;
  if (body[22] !== purpose) return null;
  if (!equalBytes(body.slice(23, 39), userId ? uuidBytes(userId) : new Uint8Array(16))) return null;
  let expiresAt = 0;
  for (let i = 16; i < 22; i += 1) expiresAt = expiresAt * 256 + body[i];
  if (expiresAt < now) return null;
  return { nonce: b64uEncode(body.slice(0, 16)), expiresAt };
}

// --- Dati inviati dal telefono ----------------------------------
export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

/** Legge clientDataJSON e controlla tipo e origine (il sito che ha chiesto l'impronta). Restituisce i byte della sfida. */
export function readClientData(clientDataJSON: Uint8Array, expectedType: string, allowedOrigins: string[]): { challenge: Uint8Array; origin: string } | null {
  let data: ClientData;
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return null;
  }
  if (!data || data.type !== expectedType || typeof data.challenge !== 'string' || typeof data.origin !== 'string') return null;
  if (!allowedOrigins.includes(data.origin)) return null;
  try {
    return { challenge: b64uDecode(data.challenge), origin: data.origin };
  } catch {
    return null;
  }
}

export interface AuthData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
}

export function parseAuthData(authData: Uint8Array): AuthData | null {
  if (authData.length < 37) return null;
  const flags = authData[32];
  const signCount = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
  return { rpIdHash: authData.slice(0, 32), userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), signCount };
}

/** Il dominio del sito (rpId) deve coincidere con quello per cui la passkey è stata creata. Impronta/volto obbligatori. */
export async function checkAuthData(authData: Uint8Array, rpId: string): Promise<AuthData | null> {
  const parsed = parseAuthData(authData);
  if (!parsed) return null;
  if (!equalBytes(parsed.rpIdHash, await sha256(enc.encode(rpId)))) return null;
  if (!parsed.userPresent || !parsed.userVerified) return null;
  return parsed;
}

// --- Firma ------------------------------------------------------
// ES256: l'autenticatore firma in DER, Web Crypto vuole r||s da 64 byte.
export function derToRawEcdsa(der: Uint8Array, size = 32): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = (): Uint8Array | null => {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) return null;
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = r && readInt();
  return r && s ? concat(r, s) : null;
}

/** Verifica la firma sulla concatenazione authenticatorData || SHA-256(clientDataJSON). */
export async function verifyAssertionSignature(
  publicKeySpki: Uint8Array,
  alg: number,
  authData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  const signed = concat(authData, await sha256(clientDataJSON));
  try {
    if (alg === -7) {
      const raw = derToRawEcdsa(signature);
      if (!raw) return false;
      const key = await crypto.subtle.importKey('spki', publicKeySpki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw as BufferSource, signed as BufferSource);
    }
    if (alg === -257) {
      const key = await crypto.subtle.importKey('spki', publicKeySpki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, signed as BufferSource);
    }
  } catch {
    return false;
  }
  return false;
}

/** In registrazione: la chiave pubblica inviata deve essere una chiave valida di un tipo supportato. */
export async function isUsablePublicKey(publicKeySpki: Uint8Array, alg: number): Promise<boolean> {
  try {
    if (alg === -7) {
      await crypto.subtle.importKey('spki', publicKeySpki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return true;
    }
    if (alg === -257) {
      await crypto.subtle.importKey('spki', publicKeySpki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
