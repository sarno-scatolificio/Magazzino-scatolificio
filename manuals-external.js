// =============================================================
// manuals-external.js — Apre il PDF di un manuale con un'app ESTERNA
// scelta dall'utente tra quelle installate sul telefono.
//
// Un'app web non può elencare le app installate: lo fa il sistema (Android)
// con il suo foglio di condivisione, che propone i lettori PDF presenti. Il
// file viene inviato come allegato (dalla copia già salvata sul telefono, o
// scaricato una volta sola e salvato per le volte successive). Dove il
// sistema non lo permette (es. computer) o l'invio fallisce, si usa il
// visualizzatore interno come prima.
// =============================================================

import { getManualSignedUrl } from './supabase.js';
import { getCachedPdf, savePdf } from './pdf-cache.js';
import { toastInfo, toastWarning } from './toast.js';
import { openManualViewer } from './manuals.js';

let busy = false;

function canShareFiles() {
  try {
    const probe = new File([new Uint8Array(1)], 'prova.pdf', { type: 'application/pdf' });
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

function makeFile(bytes, manual) {
  let name = manual.file_name || 'manuale.pdf';
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return new File([bytes], name, { type: 'application/pdf' });
}

/**
 * Il foglio di condivisione si può aprire solo subito dopo un tocco. Se per scaricare il
 * manuale è passato troppo tempo, serve un secondo tocco: si mostra un pulsante.
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

/**
 * @param {{ file_name: string, storage_path: string, bucket?: string }} manual
 * @param {{ title?: string }} opts stesse opzioni di openManualViewer (servono anche se si ripiega sul visualizzatore interno)
 */
export async function openManualExternal(manual, opts = {}) {
  if (!manual || busy) return;
  busy = true;
  try {
    if (!canShareFiles()) {
      await openManualViewer(manual, opts);
      return;
    }

    let bytes = await getCachedPdf(manual);
    let downloaded = false;
    if (!bytes) {
      toastInfo('Scarico il manuale…', 6000);
      const url = await getManualSignedUrl(manual.storage_path, manual.bucket);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      downloaded = true;
      savePdf(manual, bytes).catch(() => {});
    }

    if (downloaded && navigator.userActivation && !navigator.userActivation.isActive) {
      const tapped = await askTap('Scegli l\u2019app per aprirlo');
      if (!tapped) return;
    }

    const title = opts.title || manual.file_name;
    await navigator.share({ files: [makeFile(bytes, manual)], title, text: title });
  } catch (err) {
    if (err?.name === 'AbortError') return; // ha chiuso il foglio senza scegliere: nessun messaggio
    console.warn('Apertura con app esterna non riuscita.', err);
    toastWarning('Impossibile aprire con un\u2019app esterna: uso il visualizzatore interno.');
    await openManualViewer(manual, opts);
  } finally {
    busy = false;
  }
}
