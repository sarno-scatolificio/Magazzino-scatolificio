// =============================================================
// manuals-external.js — Apre il PDF di un manuale con un'app ESTERNA
// per i PDF (Drive, Adobe Acrobat, Xodo…) scelta dall'utente tra quelle
// installate sul telefono.
//
// Un'app web non può elencare le app installate, ma su Android può chiedere
// al sistema di "aprire un PDF": Android mostra il suo menu «Apri con» con i
// lettori presenti. Si usa un indirizzo di tipo intent:// (lo capisce Chrome
// su Android) che punta al PDF; se nessuna app lo accetta, Chrome apre
// l'indirizzo normale. Fuori da Android, o in caso di errore, si usa il
// visualizzatore interno come prima.
// =============================================================

import { getManualSignedUrl } from './supabase.js';
import { toastWarning } from './toast.js';
import { openManualViewer } from './manuals.js';

let busy = false;

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

/**
 * @param {{ file_name: string, storage_path: string, bucket?: string }} manual
 * @param {{ title?: string }} opts stesse opzioni di openManualViewer (servono se si ripiega sul visualizzatore interno)
 */
export async function openManualExternal(manual, opts = {}) {
  if (!manual || busy) return;
  busy = true;
  try {
    if (!/Android/i.test(navigator.userAgent)) {
      await openManualViewer(manual, opts);
      return;
    }
    // L'indirizzo firmato dura un'ora: basta per far scaricare il PDF all'app scelta.
    const url = await getManualSignedUrl(manual.storage_path, manual.bucket);
    window.location.href = buildPdfIntentUrl(url);
  } catch (err) {
    console.warn('Apertura con app esterna non riuscita.', err);
    toastWarning('Impossibile aprire con un\u2019app esterna: uso il visualizzatore interno.');
    await openManualViewer(manual, opts);
  } finally {
    busy = false;
  }
}
