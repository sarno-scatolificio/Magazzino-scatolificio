// =============================================================
// label-pdf.js — Etichette con codice a barre in PDF, formato A5 verticale
// =============================================================
// Le misure impostate sono quelle REALI dell'etichetta (larghezza × altezza): ogni etichetta è esattamente di quella misura,
// attaccata alle vicine e con linea di taglio tratteggiata condivisa. Dentro: codice/nome articolo (grande), descrizione sotto
// (poco più piccola) e in fondo il codice a barre piccolo, disegnato in vettoriale (nitido, preciso, file leggero).
// Il PDF chiede di essere stampato al 100%: con "adatta alla pagina" le misure sulla carta cambiano.
// Le misure si ricordano sul dispositivo (vedi LABEL_DEFAULTS).

import { loadLib } from './ui-utils.js';

export const PAGE_W = 148; // A5 verticale, mm
export const PAGE_H = 210;

/** Valori iniziali: etichetta 8 × 4 cm (1 colonna e 5 righe per foglio A5) */
export const LABEL_DEFAULTS = {
  labelW: 80, // larghezza dell'etichetta, mm
  labelH: 40, // altezza dell'etichetta, mm
  copies: 1, // copie di ogni etichetta
  showDesc: true, // descrizione dell'articolo sotto il nome
  cutBorder: true, // linee tratteggiate di taglio (condivise tra etichette vicine)
  multi: false, // più codici articolo insieme in una sola etichetta (senza barre), separati da linee sottili
  multiCount: 2, // quanti codici per etichetta quando `multi` è attivo (2, 3 o 4)
};

/** Limiti accettati per le misure (mm): l'etichetta deve stare nell'area utile dell'A5 */
export const LABEL_LIMITS = { labelW: [30, 138], labelH: [15, 200], copies: [1, 20], multiCount: [2, 4] };

const STORAGE_KEY = 'label_print_settings_v5'; // v5: le misure sono quelle dell'etichetta intera (prima del solo codice a barre)
const MARGIN = 5; // margine della pagina, mm (le stampanti d'ufficio non stampano oltre ~4 mm dal bordo)
const PAD_X = 2; // spazio interno laterale all'etichetta, mm
const PAD_Y = 1.6; // spazio interno sopra e sotto, mm
const GAP = 1.4; // spazio tra testo e barre, mm
const PT = 0.3528; // 1 punto tipografico in mm
const NAME_PT_MAX = 26; // riga 1 (codice/nome articolo): carattere massimo
const NAME_PT_MIN = 9;
const DESC_PT_MAX = 20; // riga 2 (descrizione): massimo, e comunque mai più grande dell'88% della riga 1
const DESC_PT_MIN = 8;
const DESC_RATIO = 0.88;
const LINES_MAX = 2; // righe massime per ciascun blocco di testo

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** Impostazioni salvate (o i valori iniziali), sempre dentro i limiti */
export function getLabelSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  return normalizeSettings({ ...LABEL_DEFAULTS, ...saved });
}

export function saveLabelSettings(settings) {
  const s = normalizeSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Impossibile salvare le impostazioni etichette.', err);
  }
  return s;
}

function normalizeSettings(s) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  return {
    labelW: clamp(num(s.labelW, LABEL_DEFAULTS.labelW), LABEL_LIMITS.labelW),
    labelH: clamp(num(s.labelH, LABEL_DEFAULTS.labelH), LABEL_LIMITS.labelH),
    copies: Math.round(clamp(num(s.copies, 1), LABEL_LIMITS.copies)),
    showDesc: s.showDesc !== false,
    cutBorder: s.cutBorder !== false,
    multi: s.multi === true,
    multiCount: Math.round(clamp(num(s.multiCount, 2), LABEL_LIMITS.multiCount)),
  };
}

/** Descrizione dell'articolo: per i cuscinetti il campo descrizione, per cinghie e ricambi il punto di utilizzo standard */
export function labelDescription(product) {
  if (!product) return '';
  const d = product.categoria === 'cuscinetti' ? product.descrizione : product.punto_utilizzo_standard;
  return String(d || '').trim();
}

/** Moduli del CODE128 come stringa di 0/1 (1 = barra), per disegnarlo in vettoriale. null se non disponibile. */
function barModules(code) {
  try {
    const obj = {};
    // eslint-disable-next-line no-undef
    JsBarcode(obj, code, { format: 'CODE128', displayValue: false, margin: 0 });
    const bits = (obj.encodings || []).map((e) => e.data).join('');
    return /^[01]+$/.test(bits) ? bits : null;
  } catch {
    return null;
  }
}

/** Ripiego (se i moduli non sono leggibili): immagine piccola e compressa */
function barsImage(code) {
  const canvas = document.createElement('canvas');
  // eslint-disable-next-line no-undef
  JsBarcode(canvas, code, { format: 'CODE128', width: 3, height: 60, displayValue: false, margin: 0, background: '#ffffff', lineColor: '#000000' });
  return canvas.toDataURL('image/png');
}

/** Passo tra due righe (mm) per un dato corpo in punti */
const pitchOf = (pt) => pt * PT * 1.12;

/** Taglia `text` a `maxLines` righe con "…" finale */
function ellipsize(doc, text, w, maxLines) {
  let lines = doc.splitTextToSize(text, w);
  if (lines.length <= maxLines) return lines;
  lines = lines.slice(0, maxLines);
  let last = lines[maxLines - 1];
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > w) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.trimEnd()}…`;
  return lines;
}

/**
 * Sceglie i caratteri più grandi per nome e descrizione in modo che tutto stia nell'area di testo dell'etichetta
 * (larghezza `w`, altezza `areaH`). Il nome è sempre più grande della descrizione.
 */
function fitText(doc, name, desc, w, areaH, maxPt = NAME_PT_MAX) {
  doc.setFont('helvetica', 'bold');
  const lay = (text, pt) => {
    if (!text) return [];
    doc.setFontSize(pt);
    return doc.splitTextToSize(text, w);
  };
  const height = (lines, pt) => lines.length * pitchOf(pt);
  for (let npt = maxPt; npt >= NAME_PT_MIN; npt -= 0.5) {
    const dpt = Math.max(DESC_PT_MIN, Math.min(DESC_PT_MAX, npt * DESC_RATIO));
    const nl = lay(name, npt);
    const dl = lay(desc, dpt);
    if (nl.length <= LINES_MAX && dl.length <= LINES_MAX && height(nl, npt) + height(dl, dpt) <= areaH) {
      return { nameLines: nl, namePt: npt, descLines: dl, descPt: dpt };
    }
  }
  // Non sta nemmeno al minimo: si accorcia con "…", poi si riducono le righe finché entra in altezza
  const npt = NAME_PT_MIN;
  const dpt = DESC_PT_MIN;
  doc.setFontSize(npt);
  let nl = name ? ellipsize(doc, name, w, LINES_MAX) : [];
  doc.setFontSize(dpt);
  let dl = desc ? ellipsize(doc, desc, w, LINES_MAX) : [];
  const fits = () => height(nl, npt) + height(dl, dpt) <= areaH;
  if (!fits() && dl.length > 1) { doc.setFontSize(dpt); dl = ellipsize(doc, desc, w, 1); }
  if (!fits() && nl.length > 1) { doc.setFontSize(npt); nl = ellipsize(doc, name, w, 1); }
  return { nameLines: nl, namePt: npt, descLines: dl, descPt: dpt };
}

/**
 * Crea e scarica il PDF.
 * @param {{ barcode: string, code?: string, description?: string }[]} items etichette da stampare
 * @param {object} [options] impostazioni (se omesse, quelle salvate)
 * @param {string} [fileName]
 * @returns {Promise<{ labels: number, pages: number }>}
 */
export async function generateLabelsPdf(items, options = null, fileName = null) {
  // Un'etichetta serve anche senza codice a barre (solo testo): basta che ci sia il nome o la descrizione
  const list = (items || []).filter((i) => i && (String(i.barcode || '').trim() || String(i.code || '').trim() || String(i.description || '').trim()));
  if (!list.length) throw new Error('Nessuna etichetta da stampare.');
  await loadLib('jspdf'); // libreria PDF: caricata solo alla prima stampa
  const s = options ? normalizeSettings(options) : getLabelSettings();

  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait', compress: true });
  try {
    doc.viewerPreferences({ PrintScaling: 'None' }, true); // il lettore PDF propone la stampa al 100%
  } catch {
    /* funzione non disponibile in questa versione della libreria */
  }

  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const { labelW, labelH } = s;

  // Griglia: le etichette sono esattamente labelW × labelH, attaccate tra loro, centrate nella pagina
  const cols = Math.max(1, Math.floor((usableW + 0.001) / labelW));
  const rowsPerPage = Math.max(1, Math.floor((usableH + 0.001) / labelH));
  const perPage = cols * rowsPerPage;
  const x0 = MARGIN + (usableW - cols * labelW) / 2;

  // Codice a barre piccolo (al lettore basta poco) e area di testo = tutto il resto dell'etichetta
  const barW = Math.min(labelW - PAD_X * 2, Math.max(28, labelW * 0.55));
  const barH = Math.min(14, Math.max(6, labelH * 0.2));
  const textW = labelW - PAD_X * 2;
  const areaH = Math.max(4, labelH - PAD_Y * 2 - barH - GAP);

  // Con `multi` attivo: gli articoli con group=true vanno nelle etichette a più codici, gli altri restano classici (con barre)
  const classicList = s.multi ? list.filter((it) => !it.group) : list;
  const groupList = s.multi ? list.filter((it) => it.group) : [];
  const buildSingles = () => classicList.map((it) => {
    let name = String(it.code || '').trim();
    let desc = s.showDesc ? String(it.description || '').trim() : '';
    if (!name && desc) { name = desc; desc = ''; }
    const hasBar = Boolean(String(it.barcode || '').trim());
    const areaI = hasBar ? areaH : Math.max(4, labelH - PAD_Y * 2); // senza barre il testo usa tutta l'altezza
    return { it, hasBar, areaI, ...fitText(doc, name, desc, textW, areaI) };
  });

  // Modalità "più codici in una etichetta": i codici selezionati si raggruppano a 2, 3 o 4 per etichetta, solo codice articolo
  // (niente barre). 2 → due righe, 3 → tre righe, 4 → 2 righe × 2 colonne, separate da linee sottili continue.
  const buildMultis = () => {
    const out = [];
    for (let i = 0; i < groupList.length; i += s.multiCount) {
      const group = groupList
        .slice(i, i + s.multiCount)
        .map((it) => String(it.code || it.description || it.barcode || '').trim())
        .filter(Boolean);
      if (!group.length) continue;
      const cols = group.length === 4 ? 2 : 1;
      const rows = Math.ceil(group.length / cols);
      const cw = labelW / cols;
      const ch = labelH / rows;
      const fw = cw - PAD_X * 2;
      const fh = Math.max(4, ch - 2);
      // Stesso corpo in tutte le celle dell'etichetta: quello che sta anche al codice più lungo
      const first = group.map((t) => fitText(doc, t, '', fw, fh));
      const cap = Math.min(...first.map((f) => f.namePt));
      const fits = group.map((t) => fitText(doc, t, '', fw, fh, cap));
      out.push({ multi: true, cols, rows, cw, ch, fits });
    }
    return out;
  };

  const all = [];
  for (const p of [...buildSingles(), ...(s.multi ? buildMultis() : [])]) for (let c = 0; c < s.copies; c += 1) all.push(p);

  const modCache = new Map();
  const imgCache = new Map();
  let pages = 0;
  for (let start = 0; start < all.length; start += perPage) {
    const chunk = all.slice(start, start + perPage);
    if (pages > 0) doc.addPage('a5', 'portrait');
    pages += 1;

    // Linee tratteggiate: una sola volta per ogni lato, condivise dalle etichette vicine
    if (s.cutBorder) {
      const rowsUsed = Math.ceil(chunk.length / cols);
      const lastCount = chunk.length - (rowsUsed - 1) * cols;
      doc.setDrawColor(120);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([1.2, 1.2], 0);
      for (let r = 0; r <= rowsUsed; r += 1) {
        const w = (r === rowsUsed ? lastCount : cols) * labelW;
        doc.line(x0, MARGIN + r * labelH, x0 + w, MARGIN + r * labelH);
      }
      for (let c = 0; c <= cols; c += 1) {
        const rows = c > lastCount ? rowsUsed - 1 : rowsUsed;
        if (rows > 0) doc.line(x0 + c * labelW, MARGIN, x0 + c * labelW, MARGIN + rows * labelH);
      }
      doc.setLineDashPattern([], 0);
    }

    chunk.forEach((lab, slot) => {
      const x = x0 + (slot % cols) * labelW;
      const y = MARGIN + Math.floor(slot / cols) * labelH;
      const cx = x + labelW / 2;

      if (lab.multi) {
        // Più codici nella stessa etichetta: linee sottili continue tra le celle, in ogni cella solo il codice articolo
        doc.setDrawColor(70);
        doc.setLineWidth(0.25);
        for (let r = 1; r < lab.rows; r += 1) doc.line(x, y + r * lab.ch, x + labelW, y + r * lab.ch);
        for (let c = 1; c < lab.cols; c += 1) doc.line(x + c * lab.cw, y, x + c * lab.cw, y + labelH);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        lab.fits.forEach((f, i) => {
          const ccx = x + (i % lab.cols) * lab.cw + lab.cw / 2;
          const cy = y + Math.floor(i / lab.cols) * lab.ch;
          const used = f.nameLines.length * pitchOf(f.namePt);
          const t0 = cy + Math.max(0, (lab.ch - used) / 2);
          doc.setFontSize(f.namePt);
          f.nameLines.forEach((ln, k) => doc.text(ln, ccx, t0 + k * pitchOf(f.namePt) + f.namePt * PT * 0.8, { align: 'center' }));
        });
        return;
      }
      const { it, hasBar, areaI, nameLines, namePt, descLines, descPt } = lab;
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');

      // 1) Nome/codice articolo (grande) e 2) descrizione (poco più piccola), una sopra l'altra, centrati nell'area di testo
      const usedH = nameLines.length * pitchOf(namePt) + descLines.length * pitchOf(descPt);
      let top = y + PAD_Y + Math.max(0, (areaI - usedH) / 2);
      [[nameLines, namePt], [descLines, descPt]].forEach(([lines, pt]) => {
        doc.setFontSize(pt);
        lines.forEach((ln, i) => doc.text(ln, cx, top + i * pitchOf(pt) + pt * PT * 0.8, { align: 'center' }));
        top += lines.length * pitchOf(pt);
      });

      // 3) Codice a barre in fondo: rettangoli vettoriali (misure esatte, nessun ricampionamento)
      if (!hasBar) return;
      const barcode = String(it.barcode).trim();
      const by = y + labelH - PAD_Y - barH;
      if (!modCache.has(barcode)) modCache.set(barcode, barModules(barcode));
      const bits = modCache.get(barcode);
      if (bits) {
        const mw = barW / bits.length;
        const bx = cx - barW / 2;
        doc.setFillColor(0, 0, 0);
        for (let i = 0; i < bits.length; ) {
          if (bits[i] !== '1') { i += 1; continue; }
          let j = i;
          while (j < bits.length && bits[j] === '1') j += 1;
          doc.rect(bx + i * mw, by, (j - i) * mw, barH, 'F');
          i = j;
        }
      } else {
        if (!imgCache.has(barcode)) imgCache.set(barcode, barsImage(barcode));
        doc.addImage(imgCache.get(barcode), 'PNG', cx - barW / 2, by, barW, barH, `bc-${barcode}`, 'FAST');
      }
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(fileName || `etichette_${stamp}.pdf`);
  return { labels: all.length, pages };
}
