// =============================================================
// push-settings.js — Interruttori delle notifiche (Impostazioni → Preferenze)
//   «Notifiche nuovi interventi» e «Notifiche articoli sotto scorta»
// =============================================================
// Le scelte valgono per questo dispositivo. Il permesso del telefono/browser si chiede la prima volta che se ne
// accende una (serve un tocco dell'utente).

import { authState } from '../../core/auth.js';
import { pushSupported, pushPermission, setPushPref, resumePush, PushError } from '../../core/push.js';
import { toastError, toastSuccess } from '../../shared/toast.js';

const TOGGLES = [
  {
    kind: 'interventi',
    toggleId: 'push-toggle',
    noteId: 'push-sub',
    name: 'nuovi interventi',
    note: 'Avviso quando un collega inserisce un intervento da effettuare. Dalle 22 alle 7 restano in attesa e arrivano dopo le 7.',
  },
  {
    kind: 'scorta',
    toggleId: 'push-scorta-toggle',
    noteId: 'push-scorta-sub',
    name: 'articoli sotto scorta',
    note: 'Avviso quando un articolo scende sotto la scorta minima. Dalle 22 alle 7 restano in attesa e arrivano dopo le 7 in un solo riepilogo.',
  },
];

let busy = false;

for (const t of TOGGLES) {
  t.el = null;
  t.noteEl = null;
}

function setNote(t, text) {
  if (t.noteEl) t.noteEl.textContent = text || t.note;
}

export function initPushSettings() {
  for (const t of TOGGLES) {
    t.el = document.getElementById(t.toggleId);
    t.noteEl = document.getElementById(t.noteId);
  }
  if (!pushSupported()) {
    // iPhone/iPad: le notifiche esistono solo con l'app aggiunta alla schermata Home
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    for (const t of TOGGLES) {
      if (!t.el) continue;
      t.el.disabled = true;
      setNote(t, ios ? 'Su iPhone e iPad le notifiche funzionano solo con l\'app aggiunta alla schermata Home: aggiungila e riaprila da lì.' : 'Questo browser non supporta le notifiche.');
    }
    return;
  }

  for (const t of TOGGLES) {
    t.el?.addEventListener('change', async () => {
      if (busy) {
        t.el.checked = !t.el.checked; // un cambio alla volta
        return;
      }
      busy = true;
      const wantOn = t.el.checked;
      try {
        await setPushPref(authState.profile?.id, t.kind, wantOn);
        setNote(t, '');
        toastSuccess(`Notifiche ${t.name} ${wantOn ? 'attivate' : 'disattivate'} su questo dispositivo`);
      } catch (err) {
        t.el.checked = !wantOn; // non è andata a buon fine: l'interruttore torna com'era
        if (err instanceof PushError && err.code === 'denied') {
          setNote(t, 'Le notifiche sono bloccate: abilitale per questa app dalle impostazioni del telefono o del browser, poi riprova.');
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
}

/** Dopo l'accesso: allinea gli interruttori e riattiva l'abbonamento di questo utente con le sue scelte */
export async function syncPushToggle(uid) {
  if (!uid || !pushSupported() || !TOGGLES.some((t) => t.el)) return;
  try {
    const prefs = await resumePush(uid);
    const blocked = pushPermission() === 'denied';
    for (const t of TOGGLES) {
      if (!t.el) continue;
      t.el.checked = !!prefs[t.kind];
      setNote(t, blocked ? 'Le notifiche sono bloccate: abilitale per questa app dalle impostazioni del telefono o del browser.' : '');
    }
  } catch (err) {
    console.error(err);
  }
}
