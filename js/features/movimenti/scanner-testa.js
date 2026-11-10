// =============================================================
// scanner-testa.js — Campo «Testa» del Prelievo (piattelle)
// =============================================================
// Per le piattelle il prelievo chiede su quali teste vengono montate (una piattella per testa: tante teste quanta è la
// quantità): il macchinario si ricava dalla linea (vedi magazzino/testa-macchine.js) e le teste si scelgono con il
// semicerchio (shared/testa-picker.js), che controlla anche la quantità.
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { els, ss, effectiveLinea } from './scanner-shared.js';
import { listMachineEntries } from '../../data/supabase.js';
import feedback from '../../shared/feedback.js';
import { macchinaConTeste, richiedeTesta } from '../magazzino/testa-macchine.js';
import { openTestaPicker } from '../../shared/testa-picker.js';
import { setQty } from './scanner-result.js';

function paintTesta() {
  if (!els.testaValue) return;
  const v = ss.testa?.value || [];
  els.testaValue.textContent = !v.length ? 'Seleziona testa…' : v.length === 1 ? `Testa ${v[0]}` : `Teste ${v.length > 6 ? `${v.slice(0, 5).join(', ')}… (${v.length})` : v.join(', ')}`;
  els.testaValue.classList.toggle('text-graphite-400', !v.length);
  els.testaValue.classList.toggle('text-graphite-100', v.length > 0);
}

/** Mostra o nasconde il campo in base ad articolo, modalità e linea. Se cambia macchinario la scelta si azzera. */
export function syncTestaField() {
  if (!els.testaWrap) return;
  const m =
    ss.currentMode === 'prelievo' && ss.currentProduct && richiedeTesta(ss.currentProduct)
      ? macchinaConTeste(effectiveLinea(), ss.machinesCache)
      : null;
  if (!m) {
    ss.testa = null;
    els.testaWrap.classList.add('hidden');
    paintTesta();
    return;
  }
  if (!ss.testa || ss.testa.macchinario !== m.nome) ss.testa = { macchinario: m.nome, total: m.teste, value: [] };
  els.testaWrap.classList.remove('hidden');
  els.testaMachine.textContent = `${m.nome} · ${m.teste} teste`;
  paintTesta();
}

export function resetTesta() {
  ss.testa = null;
  syncTestaField();
}

/** L'elenco macchine serve anche per le piattelle (per ricavare il macchinario dalla linea): se manca lo si legge */
export async function ensureMachinesForTesta() {
  if (ss.machinesCache || !richiedeTesta(ss.currentProduct)) return;
  try {
    ss.machinesCache = await listMachineEntries();
  } catch (err) {
    console.warn('Elenco macchine non disponibile (offline?): la testa non viene chiesta.', err);
    return;
  }
  syncTestaField();
}

export async function pickTesta() {
  if (!ss.testa) return;
  const qty = parseInt(els.qtyInput.value, 10) || 1;
  const res = await openTestaPicker({ machine: ss.testa.macchinario, total: ss.testa.total, selected: ss.testa.value, quantita: qty });
  if (res === null || !ss.testa) return; // annullato (o nel frattempo il campo è sparito)
  ss.testa.value = res.teste;
  if (res.quantita !== qty) setQty(res.quantita); // confermata dal selettore (es. «Sì, 5 piattelle»): la quantità segue le teste
  feedback.stepDone();
  paintTesta();
}
