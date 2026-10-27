// =============================================================
// scanner-shared.js — Stato (ss), riferimenti e costanti condivisi dei moduli Scanner
// =============================================================
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).



export const ss = {
  currentMode: null, // 'deposito' | 'prelievo'
  currentProduct: null,
  prestito: false, // prelievo registrato come prestito (da reintegrare)
  currentLocationId: null, // scaffale scelto per il movimento (obbligatorio se l'articolo sta su più scaffali)
  machinesCache: null, // macchine (con linee) per il campo Macchinario del prelievo cuscinetti
  codeSearchDebounce: null,
  codeSearchSeq: 0, // scarta risposte arrivate in ordine sbagliato (rete lenta + digitazione veloce)
  lastCode: null,
  lastCodeAt: 0,
  puntiSuggeriti: [],
  puntiSeq: 0,
  puntiOpen: false,
  puntoPrefilled: false, // il cuscinetto ha già un punto di utilizzo assegnato: niente suggerimenti, si scelgono solo linea e macchinario
};

export const els = {};

export const CATEGORY_BADGE_CLASSES = {
  cuscinetti: 'bg-graphite-700 text-graphite-200',
  cinghie: 'bg-emerald-500/15 text-emerald-700',
  pezzi_ricambio: 'bg-amber-500/15 text-amber-300',
};

/**
 * Linea del prelievo: quella scelta con i pulsanti; se non è stata scelta, quella ricavata dal macchinario selezionato
 * (macchina di reparto → 'REP', macchina presente su una sola linea → quella linea). '' se non si può ricavare.
 */
export function effectiveLinea() {
  const scelta = els.lineaInput?.value;
  if (scelta) return scelta;
  const nome = (els.macchinarioSelect?.value || '').trim().toLowerCase();
  if (!nome) return '';
  const entry = (ss.machinesCache || []).find((m) => (m.nome || '').toLowerCase() === nome);
  const linee = Array.isArray(entry?.linee) ? entry.linee : [];
  if (linee.includes('REP')) return 'REP';
  return linee.length === 1 ? linee[0] : '';
}
