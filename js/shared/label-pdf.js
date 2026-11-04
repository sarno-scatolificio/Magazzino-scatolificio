// =============================================================
// label-pdf.js — Etichette con codice a barre in PDF, formato A5 verticale
// =============================================================
// Più etichette sulla stessa pagina, a griglia compatta: le etichette sono attaccate l'una all'altra e condividono
// la stessa linea tratteggiata di taglio (nessuno spazio sprecato). Le colonne riempiono tutta la larghezza utile.
// Ogni etichetta contiene, dall'alto: la descrizione dell'articolo (grassetto, il carattere più grande possibile
// entro 2 righe), le barre del codice e, in basso, il codice articolo in grassetto.
// Le misure si possono cambiare (vedi LABEL_DEFAULTS) e vengono ricordate sul telefono.

import { loadLib } from './ui-utils.js';

export const PAGE_W = 148; // A5 verticale, mm
export const PAGE_H = 210;

/** Valori iniziali: barre 5,5 × 1,4 cm → 2 colonne e 6 righe = 12 etichette per foglio A5 */
export const LABEL_DEFAULTS = {
  barW: 55, // larghezza del codice a barre, mm
  barH: 14, // altezza del codice a barre, mm
  copies: 1, // copie di ogni etichetta
  showDesc: true, // descrizione dell'articolo sopra le barre
  cutBorder: true, // linee tratteggiate di taglio (condivise tra etichette vicine)
};

/** Limiti accettati per le misure (mm) */
export const LABEL_LIMITS = { barW: [20, 120], barH: [8, 60], copies: [1, 20] };

const STORAGE_KEY = 'label_print_settings_v2'; // v2: nuovo layout compatto, ripartono i valori iniziali
const MARGIN = 5; // margine della pagina, mm (le stampanti d'ufficio non stampano oltre ~4 mm dal bordo)
const PAD_X = 2; // spazio interno laterale all'etichetta, mm
const PAD_Y = 1.4; // spazio interno sopra e sotto, mm
const PT = 0.3528; // 1 punto tipografico in mm
const DESC_PT_MAX = 12; // descrizione: carattere massimo (si riduce solo se non sta in 2 righe)
const DESC_PT_MIN = 8.5;
const DESC_LINES_MAX = 2;
const CODE_PT_MAX = 14; // codice articolo: carattere massimo
const CODE_PT_MIN = 8;
const CODE_H = 4.8; // altezza riservata alla riga del codice articolo, mm

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

/** Riduce il carattere finché `text` sta in `maxW` mm; se non basta lo accorcia con "…" */
function fitLine(doc, text, maxW, startPt, minPt) {
  let pt = startPt;
  doc.setFontSize(pt);
  while (doc.getTextWidth(text) > maxW && pt > minPt) {
    pt -= 0.5;
    doc.setFontSize(pt);
  }
  let out = text;
  while (doc.getTextWidth(out) > maxW && out.length > 1) out = out.slice(0, -1);
  return { text: out === text ? text : `${out.trimEnd()}…`, pt };
}

/** Descrizione: il carattere più grande (tra DESC_PT_MAX e DESC_PT_MIN) con cui sta in al massimo 2 righe; oltre, "…" */
function fitDescription(doc, text, maxW) {
  doc.setFont('helvetica', 'bold');
  let pt = DESC_PT_MAX;
  let lines = [];
  for (; pt >= DESC_PT_MIN; pt -= 0.5) {
    doc.setFontSize(pt);
    lines = doc.splitTextToSize(text, maxW);
    if (lines.length <= DESC_LINES_MAX) return { lines, pt };
  }
  pt = DESC_PT_MIN;
  doc.setFontSize(pt);
  lines = doc.splitTextToSize(text, maxW).slice(0, DESC_LINES_MAX);
  let last = lines[DESC_LINES_MAX - 1];
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > maxW) last = last.slice(0, -1);
  lines[DESC_LINES_MAX - 1] = `${last.trimEnd()}…`;
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
  const cols = Math.max(1, Math.floor(usableW / (s.barW + PAD_X * 2)));
  const cellW = usableW / cols;
  const barW = Math.min(s.barW, cellW - PAD_X * 2);
  const textW = cellW - PAD_X * 2;

  // Misura la descrizione di ogni etichetta: tutte le celle hanno la stessa altezza (1 o 2 righe a seconda delle descrizioni)
  const prepared = list.map((it) => {
    const desc = s.showDesc ? String(it.description || '').trim() : '';
    return { it, desc: desc ? fitDescription(doc, desc, textW) : null };
  });
  const descH = s.showDesc ? Math.max(0, ...prepared.map((p) => (p.desc ? p.desc.lines.length * pitchOf(p.desc.pt) : 0))) : 0;

  const cellH = PAD_Y + (descH ? descH + 0.8 : 0) + s.barH + 0.8 + CODE_H + PAD_Y;
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

    chunk.forEach(({ it, desc }, slot) => {
      const x = x0 + (slot % cols) * cellW;
      const y = MARGIN + Math.floor(slot / cols) * cellH;
      const cx = x + cellW / 2;
      doc.setTextColor(0);
      let top = y + PAD_Y;

      // 1) Descrizione in alto (grassetto), centrata nello spazio riservato
      if (descH) {
        if (desc) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(desc.pt);
          const pitch = pitchOf(desc.pt);
          const off = (descH - desc.lines.length * pitch) / 2;
          desc.lines.forEach((ln, i) => doc.text(ln, cx, top + off + i * pitch + desc.pt * PT * 0.8, { align: 'center' }));
        }
        top += descH + 0.8;
      }

      // 2) Barre del codice
      const barcode = String(it.barcode).trim();
      if (!imgCache.has(barcode)) imgCache.set(barcode, barsImage(barcode));
      doc.addImage(imgCache.get(barcode), 'PNG', cx - barW / 2, top, barW, s.barH);
      top += s.barH + 0.8;

      // 3) Codice articolo in basso (grassetto)
      const code = String(it.code || '').trim();
      if (code) {
        doc.setFont('helvetica', 'bold');
        const fit = fitLine(doc, code, textW, CODE_PT_MAX, CODE_PT_MIN);
        doc.setFontSize(fit.pt);
        doc.text(fit.text, cx, top + (CODE_H - fit.pt * PT) / 2 + fit.pt * PT * 0.8, { align: 'center' });
      }
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(fileName || `etichette_${stamp}.pdf`);
  return { labels: all.length, pages };
}
