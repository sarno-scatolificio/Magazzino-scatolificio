// =============================================================
// manuals-external.js — Apre un manuale (o una sola sezione) con un'app
// ESTERNA per i PDF (Drive, Adobe Acrobat, Xodo…) scelta dall'utente tra
// quelle installate sul telefono.
//
// Un'app web non può elencare le app installate, ma su Android può chiedere
// al sistema di "aprire un PDF": Android mostra il suo menu «Apri con» con i
// lettori presenti. Si usa un indirizzo intent:// che punta al PDF.
//
// SEZIONE (es. pagine 100-120): l'app estrae quelle pagine in un PDF piccolo
// (con pdf-lib, sul telefono), lo carica nel bucket privato «manuali-temp»
// e passa al lettore l'indirizzo firmato (valido 1 ora). I file temporanei
// dell'utente più vecchi di 1 ora vengono eliminati a ogni nuova apertura.
//
// Fuori da Android, o se qualcosa non funziona, si usa il visualizzatore
// interno come prima (già alla pagina della sezione).
// =============================================================

import { supabase, getManualSignedUrl } from '../../data/supabase.js';
import { getCachedPdf, savePdf } from './pdf-cache.js';
import { toastInfo, toastWarning } from '../../shared/toast.js';
import { openManualViewer } from './manuals.js';

const TEMP_BUCKET = 'manuali-temp';
const TEMP_MAX_AGE_MS = 60 * 60 * 1000;
const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

let busy = false;
let pdfLibPromise = null;

/** Indirizzo intent:// che chiede ad Android di APRIRE (VIEW) il PDF con una delle app installate. */
function buildPdfIntentUrl(httpsUrl) {
  const u = new URL(httpsUrl);
  const scheme = u.protocol.replace(':', '');
  return (
    `intent://${u.host}${u.pathname}${u.search}` +
    `#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=application/pdf;` +
    `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`
  );
}

function ensurePdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_LIB_URL;
      script.async = true;
      script.onload = () => (window.PDFLib ? resolve(window.PDFLib) : reject(new Error('pdf-lib non disponibile')));
      script.onerror = () => {
        pdfLibPromise = null;
        reject(new Error('pdf-lib non caricato'));
      };
      document.head.appendChild(script);
    });
  }
  return pdfLibPromise;
}

/**
 * Android lancia un'altra app solo subito dopo un tocco. Se per preparare il file è passato
 * troppo tempo serve un secondo tocco: si mostra un pulsante.
 * @returns {Promise<boolean>} true se l'utente ha toccato, false se non l'ha fatto entro 15 s
 */
function askTap(label) {
  return new Promise((resolve) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'press-spring fixed left-1/2 -translate-x-1/2 z-[120] rounded-lg bg-amber-400 text-white font-display font-semibold uppercase tracking-wide text-sm px-5 min-h-[48px] shadow-lift';
    btn.style.bottom = 'calc(6rem + env(safe-area-inset-bottom, 0px))';
    btn.textContent = label;
    const timer = setTimeout(() => done(false), 15000);
    const done = (value) => {
      clearTimeout(timer);
      btn.remove();
      resolve(value);
    };
    btn.addEventListener('click', () => done(true));
    document.body.appendChild(btn);
  });
}

async function launchPdf(httpsUrl) {
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    const tapped = await askTap('Apri con un\u2019app\u2026');
    if (!tapped) return;
  }
  window.location.href = buildPdfIntentUrl(httpsUrl);
}

/** Byte del manuale intero: prima la copia sul telefono, altrimenti si scarica (e si salva per la prossima volta). */
async function getManualBytes(manual) {
  const cached = await getCachedPdf(manual);
  if (cached) return cached;
  toastInfo('Scarico il manuale…', 6000);
  const url = await getManualSignedUrl(manual.storage_path, manual.bucket);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  savePdf(manual, bytes).catch(() => {});
  return bytes;
}

/** Nuovo PDF con le sole pagine da `startPage` a `endPage` (incluse). */
async function extractPages(bytes, startPage, endPage) {
  const PDFLib = await ensurePdfLib();
  const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();
  const first = Math.min(Math.max(1, Math.round(startPage)), total);
  const last = Math.min(Math.max(first, Math.round(endPage || total)), total);
  const out = await PDFLib.PDFDocument.create();
  const indices = Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** Elimina i file temporanei dell'utente più vecchi di un'ora (best effort). */
async function cleanupOldTemp(uid) {
  try {
    const { data } = await supabase.storage.from(TEMP_BUCKET).list(uid, { limit: 100 });
    const old = (data || [])
      .filter((f) => Date.now() - new Date(f.created_at || f.updated_at || 0).getTime() > TEMP_MAX_AGE_MS)
      .map((f) => `${uid}/${f.name}`);
    if (old.length) await supabase.storage.from(TEMP_BUCKET).remove(old);
  } catch {
    /* pulizia non riuscita: ci riprova alla prossima apertura */
  }
}

/** Carica il PDF temporaneo e restituisce l'indirizzo firmato (1 ora). */
async function uploadTemp(pdfBytes, title) {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new Error('sessione non disponibile');
  await cleanupOldTemp(uid);
  const slug =
    String(title || 'sezione')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'sezione';
  const path = `${uid}/${slug}-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from(TEMP_BUCKET)
    .upload(path, new Blob([pdfBytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage.from(TEMP_BUCKET).createSignedUrl(path, 3600);
  if (signError || !data?.signedUrl) throw signError || new Error('indirizzo non creato');
  return data.signedUrl;
}

/**
 * @param {{ file_name: string, storage_path: string, bucket?: string }} manual
 * @param {{ title?: string, startPage?: number, endPage?: number }} opts stesse opzioni di openManualViewer:
 *   con startPage si apre solo quella sezione (PDF temporaneo), senza si apre il manuale intero.
 */
export async function openManualExternal(manual, opts = {}) {
  if (!manual || busy) return;
  busy = true;
  try {
    if (!/Android/i.test(navigator.userAgent)) {
      await openManualViewer(manual, opts);
      return;
    }
    let url;
    if (opts.startPage) {
      toastInfo('Preparo la sezione…', 8000);
      const bytes = await getManualBytes(manual);
      const sectionBytes = await extractPages(bytes, opts.startPage, opts.endPage);
      url = await uploadTemp(sectionBytes, opts.title);
    } else {
      // L'indirizzo firmato dura un'ora: basta per far scaricare il PDF all'app scelta.
      url = await getManualSignedUrl(manual.storage_path, manual.bucket);
    }
    await launchPdf(url);
  } catch (err) {
    console.warn('Apertura con app esterna non riuscita.', err);
    toastWarning('Impossibile aprire con un\u2019app esterna: uso il visualizzatore interno.');
    await openManualViewer(manual, opts);
  } finally {
    busy = false;
  }
}
