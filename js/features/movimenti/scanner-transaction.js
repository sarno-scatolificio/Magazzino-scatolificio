// =============================================================
// scanner-transaction.js — Conferma del movimento: registrazione, coda offline e azzeramento
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { adjustCachedProductQuantity, bumpProductsVersion, getProductLocations, processPrestito, processTransaction } from '../../data/supabase.js';
import { animateNumber, replayAnimation, setButtonBusy } from '../../shared/ui-utils.js';
import { closeScanModal, showFindMethods } from './scanner-camera.js';
import { els, ss } from './scanner-shared.js';
import { enqueueTransaction, isNetworkError } from '../../core/offline-queue.js';
import feedback from '../../shared/feedback.js';
import { loadIdlePanel } from './scanner-idle.js';
import { normPunto } from '../magazzino/punti-utilizzo.js';
import { paintPunti } from './scanner-punti.js';
import { refreshPrestitiCount } from './prestiti.js';
import { toastError, toastSuccess, toastWarning } from '../../shared/toast.js';

export function resetResult() {
  ss.currentProduct = null;
  ss.puntiSuggeriti = [];
  ss.puntiOpen = false;
  if (els.puntoSuggest) paintPunti();
  ss.currentLocationId = null;
  els.resultCard.classList.add('hidden');
  els.resultSkeleton.classList.add('hidden');
  // Si torna alla schermata "scansiona o cerca" solo se la modalità è
  // ancora attiva: durante resetAll() (si lascia la vista Scanner) mode è
  // già stato azzerato prima di arrivare qui, quindi la modale resta chiusa.
  if (ss.currentMode) showFindMethods();
}

export function resetAll() {
  closeScanModal();
}

/**
 * Esegue la transazione vera e propria: online la registra subito, offline
 * la accoda per la sincronizzazione automatica e aggiorna otticamente la
 * giacenza in cache.
 */
async function runTransaction({ product, quantita, puntoUtilizzo, linea, macchinario, locationId }) {
  const tipo = ss.currentMode;
  try {
    const result = await processTransaction({
      productId: product.id,
      tipo,
      quantita,
      puntoUtilizzo,
      linea,
      macchinario,
      locationId,
    });

    if (tipo === 'deposito') feedback.transactionDeposito();
    else feedback.transactionPrelievo();

    toastSuccess(
      `${tipo === 'deposito' ? 'Deposito' : 'Prelievo'} registrato: ${result.codice_articolo} → nuova giacenza ${result.nuova_giacenza}${
        getProductLocations(product).length > 1 && result.locazione_scaffale ? ` (${result.locazione_scaffale}: ${result.giacenza_scaffale})` : ''
      }`
    );

    if (result.sotto_scorta) {
      // Il secondo avviso arriva subito dopo il tono di conferma: un piccolo
      // ritardo evita che le due sequenze sonore si sovrappongano.
      setTimeout(() => feedback.lowStockAlert(), 350);
      toastWarning(`⚠️ Scorta minima raggiunta per ${result.codice_articolo}.`, 6000);
    }
    return { ok: true, nuovaGiacenza: result.nuova_giacenza };
  } catch (err) {
    if (isNetworkError(err)) {
      const saved = enqueueTransaction({ productId: product.id, tipo, quantita, puntoUtilizzo, linea, macchinario, locationId, codice_articolo: product.codice_articolo });
      if (!saved) {
        // Senza rete e senza spazio sul dispositivo il movimento andrebbe perso:
        // meglio dirlo chiaramente che far credere che sia stato salvato.
        feedback.errorAction();
        toastError('Movimento NON registrato: manca la connessione e la memoria del dispositivo è piena. Riprova con la rete attiva.');
        return { ok: false };
      }
      const delta = tipo === 'deposito' ? quantita : -quantita;
      adjustCachedProductQuantity(product.id, delta, locationId);
      feedback.offlineQueued();
      toastWarning(
        `${tipo === 'deposito' ? 'Deposito' : 'Prelievo'} salvato offline (${product.codice_articolo}): verrà sincronizzato alla riconnessione.`,
        5000
      );
      return { ok: true, offline: true, nuovaGiacenza: (product.quantita_disponibile || 0) + delta };
    }
    console.error(err);
    feedback.errorAction();
    toastError(err.message?.includes('Giacenza insufficiente') ? err.message : 'Errore durante la registrazione della transazione.');
    return { ok: false };
  }
}

/** Prelievo registrato come prestito: serve la connessione (non passa dalla coda offline) */
async function runPrestito({ product, quantita, destinatario, locationId }) {
  try {
    const result = await processPrestito({ productId: product.id, quantita, destinatario, locationId });
    feedback.transactionPrelievo();
    toastSuccess(`Prestito registrato: ${result.codice_articolo} a ${destinatario} → nuova giacenza ${result.nuova_giacenza}`);
    if (result.sotto_scorta) {
      setTimeout(() => feedback.lowStockAlert(), 350);
      toastWarning(`⚠️ Scorta minima raggiunta per ${result.codice_articolo}.`, 6000);
    }
    refreshPrestitiCount(); // solo per l'admin: per gli altri non fa nulla
    return { ok: true, nuovaGiacenza: result.nuova_giacenza };
  } catch (err) {
    console.error(err);
    feedback.errorAction();
    if (isNetworkError(err)) toastError('Per registrare un prestito serve la connessione: il prestito NON è stato registrato.', 6000);
    else toastError(err.message?.includes('Giacenza insufficiente') ? err.message : 'Errore durante la registrazione del prestito.');
    return { ok: false };
  }
}

export async function confirmTransaction() {
  if (!ss.currentProduct || !ss.currentMode) return;
  const quantita = parseInt(els.qtyInput.value, 10);
  if (!quantita || quantita <= 0) {
    feedback.errorAction();
    toastError('Inserisci una quantità valida.');
    return;
  }

  // Articolo su più scaffali: lo scaffale va scelto, il movimento è sempre su uno scaffale preciso
  if (getProductLocations(ss.currentProduct).length > 1 && !ss.currentLocationId) {
    feedback.errorAction();
    toastError('Scegli lo scaffale.');
    return;
  }

  // Prestito: si indica solo a chi viene dato; niente linea, macchinario o punto di utilizzo
  if (ss.currentMode === 'prelievo' && ss.prestito) {
    const destinatario = els.prestitoDest.value.trim();
    if (!destinatario) {
      feedback.errorAction();
      flagMissing(els.prestitoDest);
      toastError('Indica a chi viene dato in prestito.');
      return;
    }
    setButtonBusy(els.confirmBtn, true, 'Registrazione…');
    const prod = ss.currentProduct;
    const res = await runPrestito({ product: prod, quantita, destinatario, locationId: ss.currentLocationId });
    setButtonBusy(els.confirmBtn, false);
    if (res.ok) {
      bumpProductsVersion();
      animateNumber(els.productStock, res.nuovaGiacenza, { from: prod.quantita_disponibile, duration: 550 });
      replayAnimation(els.productStock, 'stock-pulse');
      setTimeout(() => {
        resetResult();
        loadIdlePanel();
      }, 550);
    }
    return;
  }

  // Prelievo: linea sempre obbligatoria; per i cuscinetti anche macchinario e punto di utilizzo
  let linea = null;
  let macchinario = null;
  let punto = els.puntoInput.value.trim();
  if (ss.currentMode === 'prelievo') {
    linea = els.lineaInput.value;
    if (!linea) {
      feedback.errorAction();
      flagMissing(els.lineaGroup);
      toastError('Seleziona la linea (Linea 1, Linea 2 o Reparto).');
      return;
    }
    if (ss.currentProduct.categoria === 'cuscinetti') {
      macchinario = els.macchinarioSelect.value;
      if (!macchinario) {
        feedback.errorAction();
        flagMissing(els.macchinarioBtn);
        toastError('Seleziona il macchinario.');
        return;
      }
      if (!punto) {
        feedback.errorAction();
        toastError('Indica il punto di utilizzo del cuscinetto.');
        return;
      }
      // Se coincide (a meno di maiuscole, accenti, punteggiatura) con un punto già usato, si registra scritto come quello:
      // così lo stesso posto resta sempre un solo posto nel calcolo della vita utile
      const same = ss.puntiSuggeriti.find((s) => normPunto(s.punto) === normPunto(punto));
      if (same) punto = same.punto;
    }
  }

  setButtonBusy(els.confirmBtn, true, 'Registrazione…');
  const product = ss.currentProduct;
  const outcome = await runTransaction({ product, quantita, puntoUtilizzo: punto, linea, macchinario, locationId: ss.currentLocationId });
  setButtonBusy(els.confirmBtn, false);

  if (outcome.ok) {
    bumpProductsVersion(); // la lista del Magazzino verrà aggiornata in silenzio al rientro
    // Il numero conta visibilmente verso il nuovo valore invece di
    // cambiare di scatto, e lampeggia brevemente: il momento in cui il
    // pezzo viene registrato deve essere impossibile da non notare.
    animateNumber(els.productStock, outcome.nuovaGiacenza, { from: product.quantita_disponibile, duration: 550 });
    replayAnimation(els.productStock, 'stock-pulse');
    setTimeout(() => {
      resetResult();
      loadIdlePanel();
    }, 550);
  }
}

/** Evidenzia per un attimo il campo obbligatorio rimasto vuoto */
export function flagMissing(el) {
  if (!el) return;
  el.classList.add('field-missing');
  setTimeout(() => el.classList.remove('field-missing'), 1800);
}
