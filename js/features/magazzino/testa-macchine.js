// =============================================================
// testa-macchine.js — Macchinari con torri e teste, e ricambi da registrare per testa
// =============================================================
// Solo 4 macchinari hanno teste (TASI TEST, PROVATRICE BONI, UNIFORMER, CAN-O-MAT). Ognuno ha una o più TORRI, e ogni torre
// ha un nome, un numero di teste e un tipo: «singola» (una testa per posizione) oppure «doppia» (ogni posizione ha una
// testa superiore e una inferiore). La configurazione si fa in Impostazioni → Gestione macchine e vive nella colonna
// `machines.torri` (jsonb): [{ nome, teste, tipo }].
// TASI TEST e PROVATRICE BONI, finché non vengono configurate, valgono come una sola torre senza nome (40 e 72 teste singole),
// come prima; UNIFORMER e CAN-O-MAT non chiedono la testa finché non si imposta almeno una torre.
//
// Su quali teste è montato un ricambio si salva in uno di due modi (colonne di `transactions`):
//  - `teste` (integer[]): macchinario con una sola torre senza nome e teste singole (il caso storico: Tasi test, Boni);
//  - `punti_testa` (jsonb): [{ torre, testa, pos }] con pos 'S' (superiore), 'I' (inferiore) o null, per tutti gli altri.
// Un ricambio si lega a una torre nella scheda articolo (colonna `products.torre`, solo Ricambi tecnici con macchina che ha
// torri con nome): nel Prelievo il selettore delle teste mostra solo le teste di quella torre.
// Per ESTENDERE: altri ricambi da registrare per testa → cambiare richiedeTesta()/isPiattella().

import { normPunto } from './punti-utilizzo.js';

export const TIPO_SINGOLA = 'singola';
export const TIPO_DOPPIA = 'doppia'; // testa superiore + testa inferiore
export const MAX_TORRI = 12;
export const MAX_TESTE = 200;
export const MAX_NOME_TORRE = 40;

// nome del macchinario normalizzato (maiuscole e punteggiatura non contano) → torri predefinite (null = nessuna: va configurato)
const MACCHINE_CON_TESTE = {
  'tasi test': [{ nome: '', teste: 40, tipo: TIPO_SINGOLA }],
  'provatrice boni': [{ nome: '', teste: 72, tipo: TIPO_SINGOLA }],
  uniformer: null,
  'can o mat': null,
};

function chiave(nome) {
  const k = normPunto(nome);
  return k === 'canomat' ? 'can o mat' : k;
}

/** True se per questo macchinario si possono impostare torri e teste (solo i 4 macchinari con teste) */
export const macchinaHaTeste = (nome) => chiave(nome) in MACCHINE_CON_TESTE;

/** Pulisce un elenco di torri letto dal database o dal modulo: scarta le voci non valide */
export function sanitizeTorri(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({
      nome: String(t?.nome || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOME_TORRE),
      teste: Math.round(Number(t?.teste)),
      tipo: t?.tipo === TIPO_DOPPIA ? TIPO_DOPPIA : TIPO_SINGOLA,
    }))
    .filter((t) => Number.isInteger(t.teste) && t.teste >= 1 && t.teste <= MAX_TESTE)
    .slice(0, MAX_TORRI);
}

/** Torri predefinite del macchinario (copia): vuoto se va configurato da zero */
export function torriPredefinite(nome) {
  const def = MACCHINE_CON_TESTE[chiave(nome)];
  return def ? def.map((t) => ({ ...t })) : [];
}

/** Torri del macchinario (voce di listMachineEntries): quelle salvate, altrimenti le predefinite. Vuoto se non ha teste. */
export function torriDi(entry) {
  if (!macchinaHaTeste(entry?.nome)) return [];
  const salvate = sanitizeTorri(entry.torri);
  return salvate.length ? salvate : torriPredefinite(entry.nome);
}

/** Riepilogo per Impostazioni, es. «2 torri · 24 teste» */
export function riepilogoTorri(torri) {
  if (!torri.length) return 'Non configurate';
  const teste = torri.reduce((s, t) => s + t.teste * (t.tipo === TIPO_DOPPIA ? 2 : 1), 0);
  return `${torri.length === 1 ? '1 torre' : `${torri.length} torri`} · ${teste} ${teste === 1 ? 'testa' : 'teste'}`;
}

/** Le piattelle (per ora gli unici ricambi registrati per testa) */
export const isPiattella = (codiceArticolo) => /piattell/i.test(codiceArticolo || '');

/** Torre assegnata all'articolo nella scheda (campo `torre`): '' se non ce n'è */
export const torreDelProdotto = (product) => String(product?.torre || '').replace(/\s+/g, ' ').trim();

/**
 * Articoli registrati per testa: le piattelle e ogni ricambio con una torre assegnata nella scheda (es. gommino di
 * bordatura → torre «Bordatura» dell'Uniformer). Senza macchina la torre non ha senso e non conta.
 */
export const richiedeTesta = (product) => isPiattella(product?.codice_articolo) || (!!torreDelProdotto(product) && !!String(product?.macchina || '').trim());

/** Nomi delle torri con un nome (le uniche assegnabili a un articolo) del macchinario indicato (voce di listMachineEntries) */
export const torriAssegnabili = (entry) => torriDi(entry).filter((t) => t.nome).map((t) => t.nome);

// --- Punti (torre + testa + posizione) -------------------------------------
// Un punto: { torre: string ('' se la torre non ha nome), testa: number, pos: 'S' | 'I' | null }

/** Nome completo del punto, es. «Bordatura · Testa 5 superiore» */
export function labelTesta(p) {
  const pos = p.pos === 'S' ? ' superiore' : p.pos === 'I' ? ' inferiore' : '';
  return `${p.torre ? `${p.torre} · ` : ''}Testa ${p.testa}${pos}`;
}

/** Nome breve del punto, es. «Bordatura · 5 sup» */
export function labelBreve(p) {
  const pos = p.pos === 'S' ? ' sup' : p.pos === 'I' ? ' inf' : '';
  return `${p.torre ? `${p.torre} · ` : ''}${p.testa}${pos}`;
}

/** Chiave che identifica una testa fisica (per confrontare le sostituzioni della stessa testa) */
export const chiavePunto = (p) => `${normPunto(p.torre)}|${p.testa}|${p.pos || ''}`;

const POS_ORDER = { S: 0, I: 1 };
/** Ordine dei punti: per torre (nell'ordine delle torri della macchina), poi numero di testa, superiore prima dell'inferiore */
export function sortPunti(punti, torri = []) {
  const idx = (p) => {
    const i = torri.findIndex((t) => normPunto(t.nome) === normPunto(p.torre));
    return i < 0 ? 999 : i;
  };
  return [...punti].sort((a, b) => idx(a) - idx(b) || a.testa - b.testa || (POS_ORDER[a.pos] ?? 2) - (POS_ORDER[b.pos] ?? 2));
}

/** Punti di un movimento (qualunque sia la colonna usata per salvarli): [] se non ci sono */
export function puntiDiMovimento(r) {
  if (Array.isArray(r?.punti_testa) && r.punti_testa.length) {
    return r.punti_testa
      .map((p) => ({ torre: String(p?.torre || ''), testa: Number(p?.testa), pos: p?.pos === 'S' || p?.pos === 'I' ? p.pos : null }))
      .filter((p) => Number.isInteger(p.testa));
  }
  if (Array.isArray(r?.teste) && r.teste.length) return r.teste.map((n) => ({ torre: '', testa: Number(n), pos: null }));
  return [];
}

/**
 * Teste di un movimento per la visualizzazione (elenchi dei movimenti, Report): null se non ce ne sono.
 * Vale per qualsiasi articolo registrato per testa, non solo per le piattelle.
 * @param {number[]|null} teste colonna `teste`
 * @param {object[]|null} [puntiTesta] colonna `punti_testa`
 * @returns {{label: string, value: string}|null} es. { label: 'Testa', value: '17' } o { label: 'Teste', value: 'Bordatura · 5 sup, Bordatura · 6 sup' }
 */
export function formatTeste(teste, puntiTesta) {
  const punti = puntiDiMovimento({ teste, punti_testa: puntiTesta });
  if (!punti.length) return null;
  const label = punti.length === 1 ? 'Testa' : 'Teste';
  if (punti.every((p) => !p.torre && !p.pos)) return { label, value: punti.map((p) => p.testa).sort((a, b) => a - b).join(', ') };
  return { label, value: sortPunti(punti).map(labelBreve).join(', ') };
}

/**
 * Macchinari con teste presenti sulla linea (la piattella non chiede il macchinario: si ricava dalla linea).
 * Più di uno è possibile (es. Uniformer e Can-o-mat sulla stessa linea): allora si sceglie quale al momento della testa.
 * @returns {{nome: string, torri: object[]}[]}
 */
export function macchineConTeste(linea, machines) {
  if (!linea) return [];
  return (machines || [])
    .filter((m) => Array.isArray(m.linee) && m.linee.includes(linea))
    .map((m) => ({ nome: m.nome, torri: torriDi(m) }))
    .filter((m) => m.torri.length > 0);
}

/**
 * Macchinario indicato nella scheda articolo (campo «macchina»), se ha teste: ha la precedenza sulla linea, così con
 * un articolo montato su una macchina precisa non si chiede quale macchinario sia. Vuoto se non c'è o non ha teste.
 * Se nella scheda è assegnata anche una torre, del macchinario resta SOLO quella torre (nel Prelievo si vedono solo le
 * sue teste); se la torre non esiste più (rinominata o tolta in Gestione macchine) si ripiega su tutte le torri.
 * @returns {{nome: string, torri: object[]}[]}
 */
export function macchinaDelProdotto(product, machines) {
  const key = normPunto(product?.macchina);
  if (!key) return [];
  return (machines || [])
    .filter((m) => normPunto(m.nome) === key)
    .map((m) => ({ nome: m.nome, torri: soloTorre(torriDi(m), torreDelProdotto(product)) }))
    .filter((m) => m.torri.length > 0)
    .slice(0, 1);
}

/** Tiene solo la torre col nome indicato (senza badare a maiuscole e punteggiatura); se non c'è, le torri restano tutte */
function soloTorre(torri, nome) {
  if (!nome) return torri;
  const trovate = torri.filter((t) => normPunto(t.nome) === normPunto(nome));
  return trovate.length ? trovate : torri;
}

/** True se la macchina ha una sola torre senza nome con teste singole: si salva come prima, nella colonna `teste` */
export const salvaComeTeste = (torri) => torri.length === 1 && !torri[0].nome && torri[0].tipo === TIPO_SINGOLA;

/**
 * Da scelte (punti) a parametri della registrazione.
 * @returns {{teste: number[]|null, puntiTesta: object[]|null}}
 */
export function paramTeste(punti, torri) {
  if (!punti.length) return { teste: null, puntiTesta: null };
  if (salvaComeTeste(torri)) return { teste: punti.map((p) => p.testa).sort((a, b) => a - b), puntiTesta: null };
  return { teste: null, puntiTesta: sortPunti(punti, torri).map((p) => ({ torre: p.torre, testa: p.testa, pos: p.pos })) };
}
