// =============================================================
// supabase-shelf-photos.js — Foto degli scaffali e posizione degli articoli sulla foto
// =============================================================
// Le foto stanno nella cartella privata `scaffali-foto` dello storage (si leggono con link temporanei);
// la tabella `shelf_photos` dice quale file appartiene a quale scaffale, `product_shelf_positions` dove si trova
// l'articolo sulla foto (x, y in frazione 0-1). Scrittura solo Admin (lo garantiscono le policy del database).
// Se la migrazione 2026-10-27-foto-scaffali.sql non è stata eseguita, tutto resta semplicemente vuoto.

import { supabase } from './supabase-client.js';
import { normalizeMachineName } from './supabase-machines.js';

export const SHELF_PHOTO_BUCKET = 'scaffali-foto';

/** Chiave di uno scaffale: nome con gli spazi ridotti, in minuscolo (la stessa logica degli altri elenchi di scaffali) */
export const shelfKey = (nome) => normalizeMachineName(nome).toLowerCase();

let photos = null; // Map chiave -> riga di shelf_photos
let loadedAt = 0;
const PHOTOS_TTL_MS = 60 * 1000;

/** Elenco delle foto degli scaffali (in memoria per un minuto). In caso di errore resta quanto già in memoria. */
export async function loadShelfPhotos(force = false) {
  if (!force && photos && Date.now() - loadedAt < PHOTOS_TTL_MS) return photos;
  try {
    const { data, error } = await supabase.from('shelf_photos').select('*');
    if (error) throw error;
    photos = new Map((data || []).map((r) => [r.locazione_key, r]));
    loadedAt = Date.now();
  } catch (err) {
    console.warn('Impossibile leggere le foto degli scaffali.', err);
    photos ||= new Map();
  }
  return photos;
}

/** Foto dello scaffale (dopo loadShelfPhotos) oppure null */
export function getShelfPhoto(nome) {
  return photos?.get(shelfKey(nome)) || null;
}

const urlCache = new Map(); // percorso -> { url, exp }
const URL_TTL_S = 3600;

/** Link temporaneo per mostrare la foto (riusato finché non sta per scadere) */
export async function getShelfPhotoUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now() + 60 * 1000) return hit.url;
  const { data, error } = await supabase.storage.from(SHELF_PHOTO_BUCKET).createSignedUrl(path, URL_TTL_S);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + URL_TTL_S * 1000 });
  return data.signedUrl;
}

/**
 * Salva la foto (già ritagliata e compressa) di uno scaffale; se ne esisteva una, la sostituisce e toglie il vecchio file.
 * Le posizioni degli articoli restano come sono.
 */
export async function uploadShelfPhoto(nome, blob, { width = null, height = null } = {}) {
  await loadShelfPhotos();
  const key = shelfKey(nome);
  const old = photos.get(key)?.storage_path || null;
  const path = `${crypto.randomUUID()}.jpg`; // nome nuovo a ogni foto: niente cache vecchia
  const up = await supabase.storage.from(SHELF_PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (up.error) throw up.error;
  const row = { locazione_key: key, locazione: normalizeMachineName(nome), storage_path: path, width, height, size_bytes: blob.size, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('shelf_photos').upsert(row, { onConflict: 'locazione_key' });
  if (error) {
    await supabase.storage.from(SHELF_PHOTO_BUCKET).remove([path]); // niente file orfano
    throw error;
  }
  if (old) await supabase.storage.from(SHELF_PHOTO_BUCKET).remove([old]);
  photos.set(key, row);
  return row;
}

/** Toglie la foto dello scaffale e le posizioni degli articoli su quella foto (non avrebbero più senso) */
export async function deleteShelfPhoto(nome) {
  await loadShelfPhotos();
  const key = shelfKey(nome);
  const row = photos.get(key);
  if (!row) return;
  const del = await supabase.from('shelf_photos').delete().eq('locazione_key', key);
  if (del.error) throw del.error;
  photos.delete(key);
  await supabase.storage.from(SHELF_PHOTO_BUCKET).remove([row.storage_path]);
  await supabase.from('product_shelf_positions').delete().eq('locazione_key', key);
}

/** Posizione dell'articolo sulla foto dello scaffale: { x, y } oppure null */
export async function getProductPosition(productId, nome) {
  const { data, error } = await supabase
    .from('product_shelf_positions')
    .select('x, y')
    .eq('product_id', productId)
    .eq('locazione_key', shelfKey(nome))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Posizioni dell'articolo su tutte le foto: Map chiave scaffale -> { x, y } (vuota se non ce ne sono) */
export async function listProductPositions(productId) {
  const { data, error } = await supabase.from('product_shelf_positions').select('locazione_key, x, y').eq('product_id', productId);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.locazione_key, { x: r.x, y: r.y }]));
}

export async function setProductPosition(productId, nome, x, y) {
  const row = { product_id: productId, locazione_key: shelfKey(nome), x, y, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('product_shelf_positions').upsert(row, { onConflict: 'product_id,locazione_key' });
  if (error) throw error;
}

export async function clearProductPosition(productId, nome) {
  const { error } = await supabase.from('product_shelf_positions').delete().eq('product_id', productId).eq('locazione_key', shelfKey(nome));
  if (error) throw error;
}
