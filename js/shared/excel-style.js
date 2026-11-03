// =============================================================
// excel-style.js — Aspetto uniforme di tutti i file Excel esportati dall'app
// =============================================================
// Intestazioni colorate e in grassetto, larghezza colonne adattata al contenuto, testo centrato in orizzontale e in
// verticale, bordi sottili e filtro sulla prima riga. Serve la libreria SheetJS con gli stili (xlsx-js-style,
// caricata da loadLib('xlsx')). Uso: const ws = styledSheetFromRows(XLSX, righe);

const HEADER_FILL = '2F4F94'; // blu dell'app
const HEADER_TEXT = 'FFFFFF';
const BORDER_COLOR = 'BFC5CE';
const MIN_WIDTH = 10; // caratteri
const MAX_WIDTH = 60;

const border = () => {
  const side = { style: 'thin', color: { rgb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
};

/** Testo mostrato in una cella (formattato se c'è, altrimenti il valore) */
function cellText(cell) {
  if (!cell) return '';
  return String(cell.w ?? cell.v ?? '');
}

/** Foglio da un elenco di oggetti, già formattato */
export function styledSheetFromRows(XLSX, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  styleSheet(XLSX, ws);
  return ws;
}

/** Applica lo stile a un foglio esistente (la prima riga è l'intestazione) */
export function styleSheet(XLSX, ws) {
  if (!ws || !ws['!ref']) return ws; // foglio vuoto
  const range = XLSX.utils.decode_range(ws['!ref']);
  const widths = [];

  for (let c = range.s.c; c <= range.e.c; c += 1) {
    let longest = 0;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const isHeader = r === range.s.r;
      cell.s = isHeader
        ? {
            font: { bold: true, color: { rgb: HEADER_TEXT } },
            fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: border(),
          }
        : {
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: border(),
          };
      // la riga più lunga di un testo a più righe decide la larghezza
      const longestLine = cellText(cell)
        .split('\n')
        .reduce((m, line) => Math.max(m, line.length), 0);
      longest = Math.max(longest, isHeader ? longestLine + 2 : longestLine); // l'intestazione in grassetto è un po' più larga
    }
    widths.push({ wch: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2)) });
  }

  ws['!cols'] = widths;
  ws['!rows'] = [{ hpt: 24 }]; // intestazione un po' più alta
  ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}
