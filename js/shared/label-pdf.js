// =============================================================
// label-pdf.js — Etichette con codice a barre in PDF, formato A5 verticale
// =============================================================
// Più etichette sulla stessa pagina, a griglia compatta: le etichette sono attaccate l'una all'altra e condividono
// la stessa linea tratteggiata di taglio (nessuno spazio sprecato). Le colonne riempiono tutta la larghezza utile.
// Ogni etichetta contiene, dall'alto: il codice/nome dell'articolo (grassetto, il carattere più grande), subito sotto la
// descrizione o il punto di utilizzo (grassetto, leggermente più piccola) e in fondo il codice a barre piccolo: al lettore
// bastano barre ridotte, all'operatore serve leggere da lontano che ricambio c'è nel contenitore.
// Le misure si possono cambiare (vedi LABEL_DEFAULTS) e vengono ricordate sul telefono.

import { loadLib } from './ui-utils.js';

export const PAGE_W = 148; // A5 verticale, mm
export const PAGE_H = 210;

/** Valori iniziali: barre 4 × 0,8 cm, 2 colonne larghe (più spazio al testo) */
export const LABEL_DEFAULTS = {
  barW: 40, // larghezza del codice a barre, mm
  barH: 8, // altezza del codice a barre, mm
  copies: 1, // copie di ogni etichetta
  showDesc: true, // descrizione dell'articolo sopra le barre
  cutBorder: true, // linee tratteggiate di taglio (condivise tra etichette vicine)
};

/** Limiti accettati per le misure (mm) */
export const LABEL_LIMITS = { barW: [20, 120], barH: [8, 60], copies: [1, 20] };

const STORAGE_KEY = 'label_print_settings_v4'; // v4: testo in risalto e barre piccole, ripartono i valori iniziali
const MARGIN = 5; // margine della pagina, mm (le stampanti d'ufficio non stampano oltre ~4 mm dal bordo)
const PAD_X = 2; // spazio interno laterale all'etichetta, mm
const PAD_Y = 1.4; // spazio interno sopra e sotto, mm
const PT = 0.3528; // 1 punto tipografico in mm
const NAME_PT_MAX = 22; // riga 1 (codice/nome articolo): carattere massimo
const NAME_PT_MIN = 9;
const DESC_PT_MAX = 18; // riga 2 (descrizione): massimo, e comunque mai più grande dell'88% della riga 1
const DESC_PT_MIN = 8;
const DESC_RATIO = 0.88;
const LINES_MAX = 2; // righe massime per ciascun blocco di testo
const MIN_CELL_W = 60; // larghezza minima di una cella, mm: tiene le colonne a 2 così il testo resta grande

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
    barW: clamp(num(s.barW, LABEL_DEFAULTS.barW), LABEL_LIMITS.barW),
    barH: clamp(num(s.barH, LABEL_DEFAULTS.barH), LABEL_LIMITS.barH),
    copies: Math.round(clamp(num(s.copies, 1), LABEL_LIMITS.copies)),
    showDesc: s.showDesc !== false,
    cutBorder: s.cutBorder !== false,
  };
}

/** Descrizione dell'articolo: per i cuscinetti il campo descrizione, per cinghie e ricambi il punto di utilizzo standard */
export function labelDescription(product) {
  if (!product) return '';
  const d = product.categoria === 'cuscinetti' ? product.descrizione : product.punto_utilizzo_standard;
  return String(d || '').trim();
}

/** Barre del codice come immagine (senza cifre). Larghezza modulo alta = bordi nitidi. */
function barsImage(code) {
  const canvas = document.createElement('canvas');
  // eslint-disable-next-line no-undef
  JsBarcode(canvas, code, {
    format: 'CODE128',
    width: 6,
    height: 100,
    displayValue: false,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  });
  return canvas.toDataURL('image/png');
}

/** Il carattere più grande (tra maxPt e minPt) con cui `text` sta in al massimo LINES_MAX righe; oltre, "…" */
function fitBlock(doc, text, maxW, maxPt, minPt) {
  doc.setFont('helvetica', 'bold');
  let pt = maxPt;
  let lines = [];
  for (; pt >= minPt; pt -= 0.5) {
    doc.setFontSize(pt);
    lines = doc.splitTextToSize(text, maxW);
    if (lines.length <= LINES_MAX) return { lines, pt };
  }
  pt = minPt;
  doc.setFontSize(pt);
  lines = doc.splitTextToSize(text, maxW).slice(0, LINES_MAX);
  let last = lines[lines.length - 1];
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > maxW) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last.trimEnd()}…`;
  return { lines, pt };
}

/** Passo tra due righe di descrizione (mm) per un dato corpo in punti */
const pitchOf = (pt) => pt * PT * 1.12;

/**
 * Crea e scarica il PDF.
 * @param {{ barcode: string, code?: string, description?: string }[]} items etichette da stampare
 * @param {object} [options] impostazioni (se omesse, quelle salvate)
 * @param {string} [fileName]
 * @returns {Promise<{ labels: number, pages: number }>}
 */
export async function generateLabelsPdf(items, options = null, fileName = null) {
  const list = (items || []).filter((i) => i && String(i.barcode || '').trim());
  if (!list.length) throw new Error('Nessuna etichetta da stampare.');
  await loadLib('jspdf'); // libreria PDF: caricata solo alla prima stampa
  const s = options ? normalizeSettings(options) : getLabelSettings();

  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });

  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;

  // Colonne: quante ne stanno con la larghezza del codice a barre; poi si allargano per riempire tutta la riga
  // (più spazio per il testo, nessun vuoto laterale). Le etichette sono attaccate: niente distanza tra l'una e l'altra.
  const cols = Math.max(1, Math.floor(usableW / Math.max(s.barW + PAD_X * 2, MIN_CELL_W)));
  const cellW = usableW / cols;
  const barW = Math.min(s.barW, cellW - PAD_X * 2);
  const textW = cellW - PAD_X * 2;

  // Testi di ogni etichetta: riga 1 = codice/nome (più grande), riga 2 = descrizione (poco più piccola).
  // Tutte le celle hanno la stessa altezza (quella dell'etichetta con più testo).
  const prepared = list.map((it) => {
    let name = String(it.code || '').trim();
    let desc = s.showDesc ? String(it.description || '').trim() : '';
    if (!name && desc) { name = desc; desc = ''; }
    const nameFit = name ? fitBlock(doc, name, textW, NAME_PT_MAX, NAME_PT_MIN) : null;
    const descMax = Math.min(DESC_PT_MAX, (nameFit ? nameFit.pt : NAME_PT_MAX) * DESC_RATIO);
    const descFit = desc ? fitBlock(doc, desc, textW, descMax, Math.min(DESC_PT_MIN, descMax)) : null;
    return { it, nameFit, descFit };
  });
  const blockH = (f) => (f ? f.lines.length * pitchOf(f.pt) : 0);
  const textH = Math.max(0, ...prepared.map((p) => blockH(p.nameFit) + blockH(p.descFit)));

  const cellH = PAD_Y + (textH ? textH + 1.2 : 0) + s.barH + PAD_Y;
  const rowsPerPage = Math.max(1, Math.floor(usableH / cellH));
  const perPage = cols * rowsPerPage;
  const x0 = MARGIN;

  const all = [];
  for (const p of prepared) for (let c = 0; c < s.copies; c += 1) all.push(p);

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
        const w = (r === rowsUsed ? lastCount : cols) * cellW;
        doc.line(x0, MARGIN + r * cellH, x0 + w, MARGIN + r * cellH);
      }
      for (let c = 0; c <= cols; c += 1) {
        const rows = c > lastCount ? rowsUsed - 1 : rowsUsed;
        if (rows > 0) doc.line(x0 + c * cellW, MARGIN, x0 + c * cellW, MARGIN + rows * cellH);
      }
      doc.setLineDashPattern([], 0);
    }

    chunk.forEach(({ it, nameFit, descFit }, slot) => {
      const x = x0 + (slot % cols) * cellW;
      const y = MARGIN + Math.floor(slot / cols) * cellH;
      const cx = x + cellW / 2;
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      const usedH = blockH(nameFit) + blockH(descFit);
      let top = y + PAD_Y + (textH - usedH) / 2;

      // 1) Codice/nome articolo (grande) e 2) descrizione (poco più piccola), una sopra l'altra
      [nameFit, descFit].forEach((f) => {
        if (!f) return;
        doc.setFontSize(f.pt);
        const pitch = pitchOf(f.pt);
        f.lines.forEach((ln, i) => doc.text(ln, cx, top + i * pitch + f.pt * PT * 0.8, { align: 'center' }));
        top += f.lines.length * pitch;
      });

      // 3) Barre del codice, piccole, in fondo
      const barcode = String(it.barcode).trim();
      if (!imgCache.has(barcode)) imgCache.set(barcode, barsImage(barcode));
      doc.addImage(imgCache.get(barcode), 'PNG', cx - barW / 2, y + cellH - PAD_Y - s.barH, barW, s.barH);
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(fileName || `etichette_${stamp}.pdf`);
  return { labels: all.length, pages };
}
