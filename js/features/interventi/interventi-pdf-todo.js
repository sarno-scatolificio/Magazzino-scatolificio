// =============================================================
// interventi-pdf-todo.js — PDF degli interventi ANCORA DA EFFETTUARE, diviso per operatore
// Una sezione (pagina) per ogni operatore a cui sono stati assegnati dei lavori, poi gli "Non assegnati".
// Accanto a ogni lavoro c'è una casella vuota da spuntare a penna sulla carta.
// Dentro ogni operatore: Linea -> Macchina (ordine scelto in Impostazioni) -> lavori.
// Un lavoro assegnato a più operatori compare nella pagina di ciascuno.
// =============================================================

import { LINEE, compareOperatori, lineaLabel, operatoriDi } from './interventi-data.js';
import { loadLib } from '../../shared/ui-utils.js';
import { listDistinctMacchine } from '../../data/supabase.js';
import { confirmDialog } from '../../shared/ui-modal.js';

const ACCENT = [47, 79, 146];
const DEEP = [19, 34, 63];
const GREY = [98, 102, 110];
const LINE = [195, 201, 209];

const fmtDate = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * @param {Array} rows interventi aperti (da effettuare / da completare)
 * @returns {Promise<'empty'|'cancelled'|true>}
 */
export async function exportDaFarePdf(rows) {
  if (!rows?.length) return 'empty';
  await loadLib('jspdf');
  const { jsPDF } = window.jspdf;

  let order = [];
  try {
    order = await listDistinctMacchine();
  } catch (err) {
    console.warn('Ordine delle macchine non disponibile: si usa l\'alfabetico.', err);
  }
  const orderIdx = new Map(order.map((n, i) => [n.toLowerCase(), i]));
  const idxOf = (m) => (orderIdx.has(m.toLowerCase()) ? orderIdx.get(m.toLowerCase()) : 9999);
  const lineaIdx = (v) => (LINEE.findIndex((l) => l.value === v) + 1 || 99);

  // Raggruppa per operatore (un lavoro con più operatori finisce in ciascun gruppo)
  const groups = new Map(); // nome | '' -> rows
  rows.forEach((r) => {
    const ops = operatoriDi(r);
    (ops.length ? ops : ['']).forEach((n) => {
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(r);
    });
  });
  const names = [...groups.keys()].filter(Boolean).sort(compareOperatori);
  if (groups.has('')) names.push('');

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = PW - M * 2;
  const BOTTOM = PH - 16;
  const today = fmtDate(new Date());
  const LINE_H = 4.9;
  const BOX = 4.6; // lato della casella da spuntare (mm)
  let y = 0;

  const header = (nome, count, first) => {
    if (!first) doc.addPage();
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, PW, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('Interventi da effettuare', M, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Scatolificio Sarno  |  Foglio di lavoro', M, 19);
    doc.setFont('helvetica', 'bold');
    doc.text(today, PW - M, 12, { align: 'right' });
    y = 36;
    doc.setTextColor(...DEEP);
    doc.setFontSize(14);
    doc.text(nome ? nome.toUpperCase() : 'NON ASSEGNATI', M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...GREY);
    doc.text(`${count} ${count === 1 ? 'lavoro' : 'lavori'}`, PW - M, y, { align: 'right' });
    y += 3;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, y, PW - M, y);
    y += 8;
  };
  const ensure = (h, nome, count) => {
    if (y + h > BOTTOM) {
      header(nome, count, false);
    }
  };

  names.forEach((nome, gi) => {
    const list = groups.get(nome);
    header(nome, list.length, gi === 0);
    const linee = [...new Set(list.map((r) => r.linea))].sort((a, b) => lineaIdx(a) - lineaIdx(b));
    for (const linea of linee) {
      const inLinea = list.filter((r) => r.linea === linea);
      const machines = [...new Set(inLinea.map((r) => r.macchina))].sort((a, b) => idxOf(a) - idxOf(b) || a.localeCompare(b, 'it'));

      ensure(34, nome, list.length);
      doc.setFillColor(...DEEP);
      doc.roundedRect(M, y, CW, 8.5, 1.2, 1.2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.text(lineaLabel(linea).toUpperCase(), M + 3.5, y + 5.9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`${inLinea.length}`, PW - M - 3.5, y + 5.9, { align: 'right' });
      y += 13;

      for (const macchina of machines) {
        const items = inLinea.filter((r) => r.macchina === macchina).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        const firstLines = doc.splitTextToSize(items[0].descrizione || '', CW - 14);
        ensure(11 + Math.max(BOX, firstLines.length * LINE_H) + 3, nome, list.length);
        doc.setTextColor(...ACCENT);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(macchina.toUpperCase(), M + 1, y + 4, { maxWidth: CW - 14 });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...GREY);
        doc.text(`${items.length}`, PW - M - 1, y + 4, { align: 'right' });
        doc.setDrawColor(...ACCENT);
        doc.setLineWidth(0.4);
        doc.line(M, y + 6, PW - M, y + 6);
        doc.setLineWidth(0.2);
        y += 11.5;

        for (const r of items) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.5);
          const lines = doc.splitTextToSize(r.descrizione || '', CW - 14);
          const h = Math.max(BOX, lines.length * LINE_H);
          ensure(h + 4, nome, list.length);
          // casella vuota da spuntare a penna
          doc.setDrawColor(40, 40, 46);
          doc.setLineWidth(0.4);
          doc.rect(M + 1, y - 3.6, BOX, BOX);
          doc.setLineWidth(0.2);
          doc.setTextColor(30, 30, 34);
          doc.text(lines, M + 9, y);
          y += h + 3.2;
        }
        y += 3;
      }
      y += 3;
    }
  });

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`Pagina ${i} di ${total}`, PW - M, PH - 8, { align: 'right' });
    doc.text(`Interventi da effettuare ${today}`, M, PH - 8);
  }

  const name = `interventi_da_effettuare_${isoDay(new Date())}.pdf`;
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canShare) {
    const share = await confirmDialog({
      title: 'PDF pronto',
      message: `${rows.length} ${rows.length === 1 ? 'intervento da effettuare' : 'interventi da effettuare'}. Vuoi inviarlo (mail, WhatsApp…) o salvarlo sul telefono?`,
      confirmLabel: 'Invia',
      cancelLabel: 'Salva',
    });
    if (share) {
      try {
        await navigator.share({ files: [file], title: 'Interventi da effettuare', text: `Interventi da effettuare - ${today}` });
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  doc.save(name);
  return true;
}
