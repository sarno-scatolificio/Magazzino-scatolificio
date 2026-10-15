// =============================================================
// interventi-shared.js — Stato e riferimenti condivisi dei moduli Interventi
// =============================================================
// Parte di quello che prima era un unico interventi.js (vedi interventi.js).

import { authState } from '../../core/auth.js';

export const $ = (id) => document.getElementById(id);
export const els = {};

export const state = {
  tab: 'open',            // 'open' | 'done'
  open: [],
  done: [],               // effettuati del giorno scelto (scheda Effettuati)
  doneRecent: [],         // ultimi effettuati di qualunque giorno: servono solo alla ricerca in testata
  doneDays: new Set(),    // giorni (AAAA-MM-GG) con almeno un intervento effettuato: pallini blu del calendario
  doneDay: '',            // giorno mostrato nella scheda Effettuati
  machineOrder: [],       // macchine nell'ordine scelto dall'admin: raggruppamento dell'elenco
  tableMissing: false,
  loaded: false,
  loading: false,
  filterLinea: '',        // '' = tutte
  filterMacchina: '',
  rapidi: [],
  rapidiLoaded: false,
  operatori: [],          // persone che eseguono gli interventi (elenco gestito dall'admin)
  operatoriLoaded: false,
};

// Bozza del nuovo intervento: resta in memoria se si chiude il foglio, così non si perde
// quanto già scritto (si azzera col salvataggio o col pulsante "Azzera").
// `fatto`: l'intervento è già stato effettuato (inserimento rapido, non preventivato).
export const draft = { linea: '', macchina: '', desc: '', foto: null, fotoUrl: '', fatto: false };


export const STATO_CHIP = {
  da_effettuare: 'bg-[#eaedf4] text-amber-300',
  sospeso: 'bg-orange-100 text-orange-800',
  effettuato: 'bg-emerald-100 text-emerald-800',
};

// Segnalazione "Ricambi da indicare" (intervento effettuato senza ricambi registrati)
export const CHIP_RICAMBI = 'bg-orange-100 text-orange-800';

export const authorName = () => authState.profile?.full_name || authState.profile?.email || '';
