// =============================================================
// push-settings.js — Interruttore «Notifiche nuovi interventi» (Impostazioni → Preferenze)
// =============================================================

import { authState } from '../../core/auth.js';
import { pushSupported, pushPermission, isPushOn, enablePush, disablePush, resumePush, PushError } from '../../core/push.js';
import { toastError, toastSuccess } from '../../shared/toast.js';

const SUB_DEFAULT = 'Avviso quando un collega inserisce un intervento da effettuare. Dalle 22 alle 7 restano in attesa e arrivano dopo le 7.';
let toggle = null;
let sub = null;
let busy = false;

function setNote(text) {
  if (sub) sub.textContent = text || SUB_DEFAULT;
}

export function initPushSettings() {
  toggle = document.getElementById('push-toggle');
  sub = document.getElementById('push-sub');
  if (!toggle) return;

  if (!pushSupported()) {
    // iPhone/iPad: le notifiche esistono solo con l'app aggiunta alla schermata Home
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    toggle.disabled = true;
    setNote(ios ? 'Su iPhone e iPad le notifiche funzionano solo con l\'app aggiunta alla schermata Home: aggiungila e riaprila da lì.' : 'Questo browser non supporta le notifiche.');
    return;
  }

  toggle.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    const wantOn = toggle.checked;
    try {
      if (wantOn) {
        await enablePush(authState.profile?.id);
        setNote('');
        toastSuccess('Notifiche attivate su questo dispositivo');
      } else {
        await disablePush();
        toastSuccess('Notifiche disattivate su questo dispositivo');
      }
    } catch (err) {
      toggle.checked = !wantOn; // non è andata a buon fine: l'interruttore torna com'era
      if (err instanceof PushError && err.code === 'denied') {
        setNote('Le notifiche sono bloccate: abilitale per questa app dalle impostazioni del telefono o del browser, poi riprova.');
        toastError('Notifiche bloccate: abilitale dalle impostazioni del telefono o del browser.');
      } else {
        console.error(err);
        toastError('Impossibile cambiare le notifiche. Controlla la connessione e riprova.');
      }
    } finally {
      busy = false;
    }
  });
}

/** Dopo l'accesso: allinea l'interruttore e, se per questo utente erano accese, riattiva l'abbonamento */
export async function syncPushToggle(uid) {
  if (!toggle || !uid || !pushSupported()) return;
  try {
    const on = await resumePush(uid);
    toggle.checked = on || (await isPushOn(uid));
    if (pushPermission() === 'denied') setNote('Le notifiche sono bloccate: abilitale per questa app dalle impostazioni del telefono o del browser.');
    else setNote('');
  } catch (err) {
    console.error(err);
  }
}
