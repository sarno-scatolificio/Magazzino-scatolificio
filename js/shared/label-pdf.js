// =============================================================
// label-pdf.js — Etichette con codice a barre in PDF, formato A5 verticale
// =============================================================
// Più etichette sulla stessa pagina (a griglia, il numero di colonne e righe dipende dalla misura del codice a barre).
// Ogni etichetta contiene: le sole barre (senza il numero del codice sotto), poi il codice articolo in grassetto e,
// se presente, la descrizione tra parentesi. Le misure si possono cambiare (vedi LABEL_DEFAULTS) e vengono ricordate sul telefono.

import { loadLib } from './ui-utils.js';

export const PAGE_W = 148; // A5 verticale, mm
export const PAGE_H = 210;

/** Valori iniziali (richiesta di prova: codice a barre alto 2 cm e largo 5 cm) */
export const LABEL_DEFAULTS = {
  barW: 50, // larghezza del codice a barre, mm
  barH: 20, // altezza del codice a barre, mm
  copies: 1, // copie di ogni etichetta
  showDesc: true, // descrizione tra parentesi sotto il codice articolo
  cutBorder: true, // cornice tratteggiata per ritagliare
};

/** Limiti accettati per le misure (mm) */
export const LABEL_LIMITS = { barW: [20, 120], barH: [8, 60], copies: [1, 20] };

const STORAGE_KEY = 'label_print_settings_v1';
const MARGIN = 8; // margine della pagina, mm
const GAP = 3; // spazio tra le etichette, mm
const PAD = 2.5; // spazio interno all'etichetta, mm

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
  return out === text ? text : `${out.trimEnd()}…`;
}

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
  const cellW = Math.min(usableW, s.barW + PAD * 2);
  const barW = cellW - PAD * 2;
  const barsH = s.barH; // niente cifre sotto le barre: tutta l'altezza è del codice
  const descLinesMax = s.showDesc ? 2 : 0;
  const cellH = PAD + s.barH + 1.2 + 4.4 + descLinesMax * 3.4 + PAD;

  const cols = Math.max(1, Math.floor((usableW + GAP) / (cellW + GAP)));
  const rowsPerPage = Math.max(1, Math.floor((usableH + GAP) / (cellH + GAP)));
  const gridW = cols * cellW + (cols - 1) * GAP;
  const x0 = (PAGE_W - gridW) / 2;

  const all = [];
  for (const it of list) for (let c = 0; c < s.copies; c += 1) all.push(it);

  const imgCache = new Map();
  let pages = 1;
  all.forEach((it, idx) => {
    const perPage = cols * rowsPerPage;
    if (idx > 0 && idx % perPage === 0) {
      doc.addPage('a5', 'portrait');
      pages += 1;
    }
    const slot = idx % perPage;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = x0 + col * (cellW + GAP);
    const y = MARGIN + row * (cellH + GAP);

    if (s.cutBorder) {
      doc.setDrawColor(150);
      doc.setLineWidth(0.15);
      doc.setLineDashPattern([1, 1], 0);
      doc.rect(x, y, cellW, cellH);
      doc.setLineDashPattern([], 0);
    }

    const barcode = String(it.barcode).trim();
    if (!imgCache.has(barcode)) imgCache.set(barcode, barsImage(barcode));
    doc.addImage(imgCache.get(barcode), 'PNG', x + PAD, y + PAD, barW, barsH);
    doc.setTextColor(0);

    // Codice articolo (grassetto) e descrizione tra parentesi
    let ty = y + PAD + s.barH + 1.2 + 3.2;
    const code = String(it.code || '').trim();
    if (code) {
      doc.setFont('helvetica', 'bold');
      doc.text(fitLine(doc, code, cellW - 2, 10, 6), x + cellW / 2, ty, { align: 'center' });
    }
    const desc = s.showDesc ? String(it.description || '').trim() : '';
    if (desc) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      let lines = doc.splitTextToSize(`(${desc})`, cellW - 2);
      if (lines.length > descLinesMax) {
        lines = lines.slice(0, descLinesMax);
        const last = lines[descLinesMax - 1].replace(/\)?$/, '');
        lines[descLinesMax - 1] = `${last.slice(0, Math.max(1, last.length - 2)).trimEnd()}…)`;
      }
      lines.forEach((ln, i) => doc.text(ln, x + cellW / 2, ty + 3.6 + i * 3.4, { align: 'center' }));
    }
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(fileName || `etichette_${stamp}.pdf`);
  return { labels: all.length, pages };
}
