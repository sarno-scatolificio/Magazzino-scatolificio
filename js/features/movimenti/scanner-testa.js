// =============================================================
// scanner-testa.js — Campo «Testa» del Prelievo (piattelle)
// =============================================================
// Per le piattelle il prelievo chiede su quali teste vengono montate (una piattella per testa: tante teste quanta è la
// quantità): il macchinario si ricava dalla linea (vedi magazzino/testa-macchine.js; se sulla linea ce n'è più d'uno con
// teste, si sceglie quale) e torre e teste si scelgono con il semicerchio (shared/testa-picker.js), che controlla anche la quantità.
// Parte di quello che prima era un unico scanner.js (vedi scanner.js).

import { els, ss, effectiveLinea } from './scanner-shared.js';
import { listMachineEntries } from '../../data/supabase.js';
import feedback from '../../shared/feedback.js';
import { macchinaDelProdotto, macchineConTeste, richiedeTesta, riepilogoTorri, labelTesta, labelBreve, posizioneDelProdotto } from '../magazzino/testa-macchine.js';
import { openPicker } from '../../shared/picker.js';
import { openTestaPicker } from '../../shared/testa-picker.js';
import { setQty } from './scanner-result.js';

function paintTesta() {
  if (!els.testaValue) return;
  const v = ss.testa?.value || [];
  els.testaValue.textContent = !v.length
    ? 'Seleziona testa…'
    : v.length === 1
      ? labelTesta(v[0])
      : `Teste ${v.length > 4 ? `${v.slice(0, 3).map(labelBreve).join(', ')}… (${v.length})` : v.map(labelBreve).join(', ')}`;
  els.testaValue.classList.toggle('text-graphite-400', !v.length);
  els.testaValue.classList.toggle('text-graphite-100', v.length > 0);
}

const sameCandidates = (a, b) => a.length === b.length && a.every((c, i) => c.nome === b[i].nome && JSON.stringify(c.torri) === JSON.stringify(b[i].torri));

/** Mostra o nasconde il campo in base ad articolo, modalità e linea. Se cambiano i macchinari possibili la scelta si azzera. */
export function syncTestaField() {
  if (!els.testaWrap) return;
  const serve = ss.currentMode === 'prelievo' && ss.currentProduct && richiedeTesta(ss.currentProduct);
  // Prima la macchina indicata nella scheda articolo (es. piattelle della Provatrice boni); solo senza, quelle presenti sulla linea
  const cand = !serve ? [] : macchinaDelProdotto(ss.currentProduct, ss.machinesCache).length ? macchinaDelProdotto(ss.currentProduct, ss.machinesCache) : macchineConTeste(effectiveLinea(), ss.machinesCache);
  if (!cand.length) {
    ss.testa = null;
    els.testaWrap.classList.add('hidden');
    paintTesta();
    return;
  }
  if (!ss.testa || !sameCandidates(ss.testa.candidates, cand)) {
    const only = cand.length === 1 ? cand[0] : null; // con più macchinari possibili si sceglie al momento della testa
    ss.testa = { candidates: cand, macchinario: only?.nome || null, torri: only?.torri || [], value: [] };
  }
  els.testaWrap.classList.remove('hidden');
  els.testaMachine.textContent = ss.testa.macchinario ? `${ss.testa.macchinario} · ${riepilogoTorri(ss.testa.torri)}` : `${cand.length} macchinari con teste`;
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
  // Più macchinari con teste sulla linea (es. Uniformer e Can-o-mat): prima si sceglie quale
  if (ss.testa.candidates.length > 1) {
    const picked = await openPicker({
      title: 'Macchinario con teste',
      options: ss.testa.candidates.map((c) => c.nome),
      keepOrder: true,
      currentValue: ss.testa.macchinario || '',
    });
    if (!picked || !ss.testa) return; // annullato (o nel frattempo il campo è sparito)
    const c = ss.testa.candidates.find((x) => x.nome === picked);
    if (!c) return;
    if (c.nome !== ss.testa.macchinario) ss.testa = { ...ss.testa, macchinario: c.nome, torri: c.torri, value: [] };
    els.testaMachine.textContent = `${c.nome} · ${riepilogoTorri(c.torri)}`;
    paintTesta();
  }
  const qty = parseInt(els.qtyInput.value, 10) || 1;
  const res = await openTestaPicker({ machine: ss.testa.macchinario, torri: ss.testa.torri, selected: ss.testa.value, quantita: qty, posizione: posizioneDelProdotto(ss.currentProduct, ss.testa.torri) });
  if (res === null || !ss.testa) return; // annullato (o nel frattempo il campo è sparito)
  ss.testa.value = res.punti;
  if (res.quantita !== qty) setQty(res.quantita); // confermata dal selettore (es. «Sì, 5 piattelle»): la quantità segue le teste
  feedback.stepDone();
  paintTesta();
}
