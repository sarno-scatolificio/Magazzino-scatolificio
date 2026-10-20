// =============================================================
// interventi-operatori-pick.js — Tendina «Operatori» condivisa (nuovo intervento e dettaglio)
// Si sceglie da elenco (anche più di uno) oppure si scrive un nome a mano: i nomi scritti a mano
// (es. meccanici o elettricisti esterni) restano solo su quell'intervento, NON entrano nell'elenco
// delle Impostazioni.
// =============================================================

import { state } from './interventi-shared.js';
import { formatOperatore, sortOperatori } from './interventi-data.js';
import feedback from '../../shared/feedback.js';

const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ');
const HINT = 'normal-case tracking-normal text-graphite-500 font-sans font-normal';

/** Testo dell'etichetta: con «già effettuato» sono chi ha fatto il lavoro, altrimenti gli assegnati */
export const operatoriLabelHtml = (fatto) =>
  fatto
    ? `Operatori che hanno effettuato il lavoro <span class="${HINT}">(puoi sceglierne più di uno)</span>`
    : `Operatori assegnati <span class="${HINT}">(facoltativo, puoi sceglierne più di uno)</span>`;

/**
 * Collega la tendina i cui elementi hanno gli id `${prefix}-btn | -value | -chevron | -list | -empty`.
 * `get()` restituisce i nomi scelti, `set(nomi)` li memorizza; `onChange` è chiamata dopo ogni modifica.
 */
export function createOperatoriPicker(prefix, { get, set, onChange = () => {} }) {
  const el = (s) => document.getElementById(`${prefix}-${s}`);
  const btn = el('btn');
  const value = el('value');
  const chevron = el('chevron');
  const list = el('list');
  const empty = el('empty');
  let open = false;

  // Nome scritto a mano: campo + «Aggiungi», sotto l'elenco (si crea una volta sola, così il testo non si perde ai ridisegni)
  const manual = document.createElement('div');
  manual.className = 'hidden mt-1.5';
  manual.innerHTML =
    '<div class="flex items-center gap-2">' +
    '<input type="text" maxlength="60" autocomplete="off" data-no-clear placeholder="Altro nome (es. ditta esterna)" aria-label="Scrivi il nome di un operatore non in elenco" class="flex-1 min-w-0 w-full rounded-lg bg-graphite-800 border border-graphite-700 px-3.5 py-2.5 text-sm focus:border-amber-400 outline-none transition-colors min-h-[44px]">' +
    '<button type="button" class="press-spring shrink-0 rounded-lg bg-amber-400 hover:bg-amber-300 text-white font-display font-semibold uppercase tracking-wide text-xs px-4 min-h-[44px]">Aggiungi</button>' +
    '</div>' +
    '<p class="ui-note text-graphite-500 mt-1">Scrivi «Nome Cognome». Il nome vale solo per questo intervento e non viene salvato in elenco.</p>';
  empty.insertAdjacentElement('afterend', manual);
  const input = manual.querySelector('input');

  function addManual() {
    const name = cleanName(input.value);
    if (!name) return;
    const sel = get();
    // Se coincide con un nome già in elenco (o già scelto) si usa quello, senza doppioni
    const known = [...state.operatori, ...sel].find((n) => n.toLowerCase() === name.toLowerCase());
    const finalName = known || name;
    if (!sel.includes(finalName)) set([...sel, finalName]);
    input.value = '';
    feedback.presetPick();
    paint();
    onChange();
  }
  manual.querySelector('button').addEventListener('click', addManual);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addManual();
  });

  btn.addEventListener('click', () => {
    open = !open;
    feedback.tap();
    paint();
  });

  function paint() {
    const selected = get();
    // Elenco + eventuali nomi già scelti ma non (o non più) in elenco: restano visibili e si possono togliere
    const names = sortOperatori([...new Set([...state.operatori, ...selected])]);

    value.textContent = selected.length ? sortOperatori(selected).map(formatOperatore).join(', ') : 'Seleziona operatori…';
    value.classList.toggle('text-graphite-400', !selected.length);
    value.classList.toggle('text-graphite-100', !!selected.length);
    btn.setAttribute('aria-expanded', String(open));
    chevron.style.transform = open ? 'rotate(180deg)' : '';

    list.classList.toggle('hidden', !open || !names.length);
    list.innerHTML = '';
    names.forEach((n, idx) => {
      if (idx > 0) {
        const d = document.createElement('div');
        d.setAttribute('role', 'separator');
        d.className = 'h-px bg-graphite-700/70 mx-3.5';
        list.appendChild(d);
      }
      const on = selected.includes(n);
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', String(on));
      row.className = 'w-full flex items-center gap-3 px-3.5 min-h-[48px] text-left text-sm text-graphite-100';
      row.innerHTML = `<span class="int-check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:${on ? 1 : 0}"><path d="m5 12 5 5 9-10"/></svg></span><span class="min-w-0 truncate" data-name></span>`;
      row.querySelector('[data-name]').textContent = formatOperatore(n); // es. "N. VORRARO" (testo, mai HTML)
      row.addEventListener('click', () => {
        // Selezione multipla: la tendina resta aperta, ogni tocco aggiunge o toglie quel nome
        set(on ? get().filter((x) => x !== n) : [...get(), n]);
        feedback.presetPick();
        paint();
        onChange();
      });
      list.appendChild(row);
    });
    empty.classList.toggle('hidden', !open || state.operatori.length > 0);
    manual.classList.toggle('hidden', !open);
  }

  return {
    paint,
    /** Richiude la tendina e svuota il campo del nome a mano (nuova bozza, intervento diverso) */
    close() {
      open = false;
      input.value = '';
      paint();
    },
  };
}
