// =============================================================
// verbi-passato.js — Titolo dell'intervento: da infinito a participio passato
// =============================================================
// Quando un intervento "da fare" diventa "effettuato", i verbi all'infinito del titolo
// ("Sostituire cuscinetto e pulire sede") passano al participio ("Sostituito cuscinetto e pulito sede").
//
// Regole, senza intelligenza artificiale:
// - si converte solo il verbo a inizio titolo e quelli che iniziano una nuova azione: dopo "e", "ed",
//   "poi", "quindi", "infine", dopo una virgola, un punto e virgola, due punti o una barra;
//   le altre parole (anche se finiscono in -are/-ere/-ire) non si toccano;
// - -are → -ato, -ere → -uto, -ire → -ito; i verbi irregolari (fare, aprire, rimuovere, togliere…)
//   hanno il loro participio, anche con prefisso (rifare, riaprire, rimettere…);
// - il participio resta al maschile singolare ("Sostituito cuscinetti"): non si accorda al plurale o al femminile;
// - verbi con particella attaccata ("sostituirlo", "verificarne") e nomi ("revisione") restano come sono;
// - maiuscole e minuscole si mantengono ("Sostituire" → "Sostituito", "SOSTITUIRE" → "SOSTITUITO").

// Participi irregolari (verbo completo, già con eventuale prefisso)
const IRREGOLARI = {
  fare: 'fatto', rifare: 'rifatto', disfare: 'disfatto', soddisfare: 'soddisfatto', contraffare: 'contraffatto',
  dire: 'detto', ridire: 'ridetto',
  rimanere: 'rimasto',
  scendere: 'sceso', accendere: 'acceso', riaccendere: 'riacceso', spegnere: 'spento', rispegnere: 'rispento',
  tendere: 'teso', stendere: 'steso', estendere: 'esteso', attendere: 'atteso', spendere: 'speso', rendere: 'reso',
  chiedere: 'chiesto', richiedere: 'richiesto', decidere: 'deciso', dividere: 'diviso', suddividere: 'suddiviso',
  perdere: 'perso', correre: 'corso', scorrere: 'scorso', percorrere: 'percorso', cuocere: 'cotto', torcere: 'torto',
  svolgere: 'svolto', avvolgere: 'avvolto', volgere: 'volto', raccogliere: 'raccolto', scegliere: 'scelto', sciogliere: 'sciolto',
  spingere: 'spinto', respingere: 'respinto', stringere: 'stretto', restringere: 'ristretto',
  distruggere: 'distrutto', bere: 'bevuto', vedere: 'visto', rivedere: 'rivisto',
  includere: 'incluso', escludere: 'escluso', racchiudere: 'racchiuso', richiudere: 'richiuso', chiudere: 'chiuso',
  rompere: 'rotto', interrompere: 'interrotto',
};

// Radici irregolari che accettano un prefisso: "ri" + "messo" = "rimesso", "pro" + "dotto" = "prodotto"
const RADICI = [
  ['mettere', 'messo'], ['muovere', 'mosso'], ['prendere', 'preso'], ['scrivere', 'scritto'], ['leggere', 'letto'],
  ['reggere', 'retto'], ['correggere', 'corretto'], ['togliere', 'tolto'], ['coprire', 'coperto'], ['aprire', 'aperto'],
  ['offrire', 'offerto'], ['porre', 'posto'], ['trarre', 'tratto'], ['durre', 'dotto'], ['rompere', 'rotto'],
];

// Parole che lasciano "in attesa di un verbo": dopo "e" o "poi" ci si aspetta una nuova azione
const LEGAMI = new Set(['e', 'ed', 'poi', 'quindi', 'infine', 'successivamente', 'inoltre', 'eventualmente', 'anche', 'possibilmente']);

const WORD = /^([^A-Za-zÀ-ÖØ-öø-ÿ']*)([A-Za-zÀ-ÖØ-öø-ÿ]+)([^A-Za-zÀ-ÖØ-öø-ÿ]*)$/;

function participio(low) {
  if (IRREGOLARI[low]) return IRREGOLARI[low];
  for (const [inf, part] of RADICI) {
    if (low.endsWith(inf)) return low.slice(0, low.length - inf.length) + part;
  }
  const m = low.match(/^(.{2,})(are|ere|ire)$/);
  if (!m) return null;
  return m[1] + { are: 'ato', ere: 'uto', ire: 'ito' }[m[2]];
}

function keepCase(original, converted) {
  if (original.length > 1 && original === original.toUpperCase()) return converted.toUpperCase();
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) return converted[0].toUpperCase() + converted.slice(1);
  return converted;
}

/**
 * Converte in participio passato i verbi all'infinito che iniziano un'azione nel titolo.
 * @returns {{ testo: string, cambiato: boolean }}
 */
export function infinitoAPassato(titolo) {
  const input = String(titolo || '');
  const parts = input.split(/(\s+)/); // parole e spazi, per rimettere tutto com'era
  let expectVerb = true;
  let cambiato = false;

  const out = parts.map((tok) => {
    if (!tok.trim()) return tok; // spazio
    const m = tok.match(WORD);
    if (!m) {
      // "+", "/", "-" da soli: nuova azione
      if (/^[+/\-–]+$/.test(tok)) expectVerb = true;
      return tok;
    }
    const [, lead, word, trail] = m;
    const low = word.toLowerCase();
    let result = tok;
    if (expectVerb && !LEGAMI.has(low)) {
      const part = participio(low);
      if (part && part !== low) {
        result = lead + keepCase(word, part) + trail;
        cambiato = true;
      }
    }
    // Dopo un legame ("e", "poi"…) o una punteggiatura che chiude un'azione si aspetta un nuovo verbo
    expectVerb = LEGAMI.has(low) || /[.,;:\/]/.test(trail);
    return result;
  });

  return { testo: out.join(''), cambiato };
}
