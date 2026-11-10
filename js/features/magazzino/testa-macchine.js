// =============================================================
// testa-macchine.js — Macchinari con più teste e ricambi da registrare per testa
// =============================================================
// Su alcuni macchinari ogni testa monta la sua piattella: per calcolare la vita utile (Report) serve sapere su quale
// testa è stata montata, altrimenti la sostituzione di una testa sembra "anticipata" rispetto alle altre.
// Per ESTENDERE: nuovo macchinario con teste → aggiungerlo in TESTE (nome come in Impostazioni → Macchinari);
// altri ricambi da registrare per testa → cambiare richiedeTesta()/isPiattella().

import { normPunto } from './punti-utilizzo.js';

// nome del macchinario (maiuscole e punteggiatura non contano) → numero di teste
const TESTE = {
  'tasi test': 40,
  'provatrice boni': 72,
};

/** Numero di teste del macchinario (0 se non ha teste da registrare) */
export function testeDi(nome) {
  return TESTE[normPunto(nome)] || 0;
}

/** Le piattelle (per ora gli unici ricambi registrati per testa) */
export const isPiattella = (codiceArticolo) => /piattell/i.test(codiceArticolo || '');

export const richiedeTesta = (product) => isPiattella(product?.codice_articolo);

/**
 * Macchinario con teste presente sulla linea (la piattella non chiede il macchinario: si ricava dalla linea).
 * Restituisce null se non ce n'è uno solo (nessuno, oppure ambiguo): in quel caso la testa non si chiede.
 */
export function macchinaConTeste(linea, machines) {
  if (!linea) return null;
  const list = (machines || []).filter((m) => testeDi(m.nome) && Array.isArray(m.linee) && m.linee.includes(linea));
  return list.length === 1 ? { nome: list[0].nome, teste: testeDi(list[0].nome) } : null;
}
