// =============================================================
// passkey-settings.js — Interruttore «Accesso con impronta» (Impostazioni → Preferenze)
// =============================================================
// Vale per questo dispositivo: attivandolo, il telefono crea la passkey (schermata dell'impronta) e da quel momento
// alla riapertura dell'app compare l'impronta al posto della password. Spegnendolo la passkey di questo
// dispositivo viene eliminata. Le passkey di altri dispositivi dello stesso utente non si toccano.

import { authState } from '../../core/auth.js';
import { forgetPasskey, getPasskeyHints, PasskeyError, passkeyPlatformReady, passkeySupported, registerPasskey } from '../../core/passkey.js';
import { deleteMyPasskey, getSession, listMyPasskeys } from '../../data/supabase.js';
import { toastError, toastInfo, toastSuccess } from '../../shared/toast.js';

const OFFERED_KEY = 'mate.passkey.offered';
const NOTE = 'Entra con impronta o volto al posto della password, su questo telefono.';

let toggleEl = null;
let noteEl = null;
let busy = false;

const setNote = (text) => {
  if (noteEl) noteEl.textContent = text || NOTE;
};

const myHint = () => {
  const email = (authState.profile?.email || '').toLowerCase();
  return getPasskeyHints().find((h) => (h.email || '').toLowerCase() === email) || null;
};

export function initPasskeySettings() {
  toggleEl = document.getElementById('passkey-toggle');
  noteEl = document.getElementById('passkey-sub');
  if (!toggleEl) return;

  if (!passkeySupported()) {
    toggleEl.disabled = true;
    setNote('Questo browser non supporta l\'accesso con impronta (serve il sito in HTTPS e un browser aggiornato).');
    return;
  }
  passkeyPlatformReady().then((ready) => {
    if (ready) return;
    toggleEl.disabled = true;
    setNote('Questo telefono non ha un blocco schermo con impronta o volto attivo: impostalo nelle impostazioni del telefono, poi riprova.');
  });

  toggleEl.addEventListener('change', async () => {
    if (busy) {
      toggleEl.checked = !toggleEl.checked; // un cambio alla volta
      return;
    }
    busy = true;
    const wantOn = toggleEl.checked;
    try {
      if (wantOn) {
        const session = await getSession();
        if (!session) throw new PasskeyError('not_authenticated');
        await registerPasskey({ accessToken: session.access_token, email: authState.profile?.email, name: authState.profile?.full_name });
        setNote('');
        toastSuccess('Accesso con impronta attivato su questo telefono');
      } else {
        const hint = myHint();
        if (hint) {
          await deleteMyPasskey(hint.credentialId);
          forgetPasskey(hint.credentialId);
        }
        setNote('');
        toastSuccess('Accesso con impronta disattivato su questo telefono');
      }
    } catch (err) {
      toggleEl.checked = !wantOn; // non è andata a buon fine: l'interruttore torna com'era
      if (err instanceof PasskeyError && err.code === 'cancelled') return; // annullato dall'utente: nessun messaggio
      console.error(err);
      if (err instanceof PasskeyError && err.code === 'already') {
        setNote('Su questo telefono c\'è già una passkey per il tuo utente: se l\'accesso con impronta non compare, eliminala dalle impostazioni del telefono e riattiva qui.');
        toastError('Passkey già presente su questo telefono.');
      } else if (err instanceof PasskeyError && err.code === 'unsupported') {
        setNote('Questo telefono o browser non supporta ancora l\'accesso con impronta.');
        toastError('Accesso con impronta non supportato da questo browser.');
      } else if (err instanceof PasskeyError && err.code === 'limit') {
        toastError('Hai già 5 dispositivi con l\'impronta: toglila da uno prima.');
      } else if (err instanceof PasskeyError && err.code === 'config') {
        setNote('Il server non è ancora pronto per l\'accesso con impronta (funzione non pubblicata o segreto mancante).');
        toastError('Accesso con impronta non ancora configurato sul server.');
      } else {
        toastError('Impossibile cambiare l\'accesso con impronta. Controlla la connessione e riprova.');
      }
    } finally {
      busy = false;
    }
  });
}

/** Dopo l'accesso: allinea l'interruttore e, la prima volta su un dispositivo, ricorda che l'impronta esiste. */
export async function syncPasskeyToggle(profile) {
  if (!toggleEl || !profile || !passkeySupported()) return;
  const hint = myHint();
  toggleEl.checked = !!hint;
  if (hint) {
    // Se la passkey è stata eliminata dal server (altro dispositivo, amministratore) da questo telefono non va più proposta
    try {
      const rows = await listMyPasskeys();
      if (!rows.some((r) => r.credential_id === hint.credentialId)) {
        forgetPasskey(hint.credentialId);
        toggleEl.checked = false;
      }
    } catch (err) {
      // senza rete si tiene com'era
    }
    return;
  }
  try {
    if (localStorage.getItem(OFFERED_KEY) || !(await passkeyPlatformReady())) return;
    localStorage.setItem(OFFERED_KEY, '1');
    toastInfo('Puoi entrare con l\'impronta: attivala da Impostazioni → Preferenze.', 7000);
  } catch (err) {
    // non essenziale
  }
}
