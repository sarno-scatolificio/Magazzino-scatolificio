// =============================================================
// interventi-pdf.js — PDF degli interventi effettuati in una giornata (o periodo)
// Organizzato per linea e, dentro ogni linea, per macchina (ordine scelto in Impostazioni, come
// nell'app). Se i lavori sono di più giorni, il PDF è prima diviso per GIORNO (una fascia con la data e il numero
// di lavori, in ordine cronologico) e dentro ogni giorno resta la stessa organizzazione per linea e macchina. Per ogni intervento si legge solo il lavoro effettuato: niente orari o nomi,
// e niente data/ora di generazione. Le foto e i dettagli (dettagli e note dell'esito) ci sono solo per gli interventi per cui chi genera il PDF li sceglie.
// Grafica pensata per la stampa: intestazione e fasce chiare (poco toner), niente grandi campiture scure. Sui telefoni che lo supportano si apre il foglio di
// condivisione (mail, WhatsApp…); altrimenti il file viene scaricato.
// =============================================================

import { listEffettuatiRange, LINEE, dettagliPdf, lineaLabel, signedUrls } from './interventi-data.js';

export { listEffettuatiRange };
import { loadLib } from '../../shared/ui-utils.js';
import { listDistinctMacchine } from '../../data/supabase.js';
import { confirmDialog } from '../../shared/ui-modal.js';

export const ACCENT = [47, 79, 146];
export const DEEP = [19, 34, 63];
export const GREY = [98, 102, 110];
export const LINE = [195, 201, 209];
export const BAND = [232, 236, 245]; // fascia chiara (linea, giorno): al posto delle campiture scure, per risparmiare toner

export const PHOTO_MAX_W = 62; // mm: larghezza massima della foto nel PDF
export const PHOTO_MAX_H = 52; // mm: altezza massima

/** Foto dell'intervento: quella dell'esito, altrimenti quella del promemoria */
export const photoPathOf = (r) => r.foto_esito_path || r.foto_promemoria_path || '';

/** Scarica la foto e la riduce (il PDF resta leggero da inviare): { data, w, h } o null se non disponibile */
async function loadPhoto(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const scale = Math.min(1, 1100 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return { data: canvas.toDataURL('image/jpeg', 0.78), w: canvas.width, h: canvas.height };
}

/** Foto richieste per gli interventi indicati, scaricate e ridotte: Map id intervento -> { data, w, h } */
export async function loadPhotos(rows, photoIds, onPhotosSkipped = null) {
  const photos = new Map();
  if (!photoIds?.size) return photos;
  const wanted = rows.filter((r) => photoIds.has(r.id) && photoPathOf(r));
  let skipped = 0;
  if (wanted.length) {
    let urls = {};
    try {
      urls = await signedUrls(wanted.map(photoPathOf));
    } catch (err) {
      console.warn('Foto non disponibili per il PDF.', err);
    }
    await Promise.all(
      wanted.map(async (r) => {
        try {
          const url = urls[photoPathOf(r)];
          if (!url) throw new Error('URL mancante');
          photos.set(r.id, await loadPhoto(url));
        } catch (err) {
          skipped += 1;
          console.warn('Foto non inclusa nel PDF.', err);
        }
      })
    );
  }
  if (skipped && onPhotosSkipped) onPhotosSkipped(skipped);
  return photos;
}

/** Dimensioni della foto nel PDF (mm), nel riquadro massimo */
export function photoSize(photo) {
  const k = Math.min(PHOTO_MAX_W / photo.w, PHOTO_MAX_H / photo.h);
  return { pw: photo.w * k, ph: photo.h * k };
}

/** Intestazione di pagina chiara: titolo colorato su fondo bianco e un filetto (niente barra piena: la pagina si stampa) */
export function drawHeader(doc, PW, M, title, subtitle, right) {
  doc.setTextColor(...DEEP);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(title, M, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(subtitle, M, 19.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ACCENT);
  doc.text(right, PW - M, 13, { align: 'right' });
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.7);
  doc.line(M, 24, PW - M, 24);
  doc.setLineWidth(0.2);
}

/** Fascia chiara con un filo colorato a sinistra (linea o giorno) */
export function drawBand(doc, M, CW, y, h, label, count) {
  doc.setFillColor(...BAND);
  doc.roundedRect(M, y, CW, h, 1.2, 1.2, 'F');
  doc.setFillColor(...ACCENT);
  doc.rect(M, y, 2.4, h, 'F');
  doc.setTextColor(...DEEP);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(label, M + 6, y + h / 2 + 1.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(count, M + CW - 3.5, y + h / 2 + 1.5, { align: 'right' });
}

const fmtDate = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * @param {Date} from inizio (00:00 del primo giorno)
 * @param {Date} to   fine (23:59:59 dell'ultimo giorno)
 * @returns {Promise<'empty'|'cancelled'|true>}
 */
export async function exportGiornoPdf(from, to, { rows: given = null, photoIds = null, detailIds = null, onPhotosSkipped = null } = {}) {
  // `rows`: gli interventi scelti dall'utente; senza, si prendono tutti quelli effettuati nel periodo
  const rows = given ?? (await listEffettuatiRange(from.toISOString(), to.toISOString()));
  if (!rows.length) return 'empty';

  const photos = await loadPhotos(rows, photoIds, onPhotosSkipped); // foto allegate (solo se richieste): prima di disegnare, così il PDF non resta a metà

  await loadLib('jspdf');
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = PW - M * 2;
  const BOTTOM = PH - 16;
  const sameDay = isoDay(from) === isoDay(to);
  const periodo = sameDay ? fmtDate(from) : `${fmtDate(from)} - ${fmtDate(to)}`;

  // ---- Intestazione (senza data/ora di generazione) ----
  drawHeader(doc, PW, M, 'Rapporto interventi di manutenzione', 'Scatolificio Sarno  |  Interventi effettuati', periodo);

  let y = 36;
  doc.setTextColor(...DEEP);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${rows.length} ${rows.length === 1 ? 'intervento effettuato' : 'interventi effettuati'}`, M, y);
  y += 3;
  doc.setDrawColor(...LINE);
  doc.line(M, y, PW - M, y);
  y += 7;

  const ensure = (h) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M + 2;
    }
  };

  // ---- Organizzazione: Linea -> Macchina (ordine come nell'app) -> interventi ----
  // Solo l'intervento eseguito: niente orari, né chi l'ha annotato o eseguito, né note e foto.
  let order = [];
  try {
    order = await listDistinctMacchine();
  } catch (err) {
    console.warn('Ordine delle macchine non disponibile: si usa l\'alfabetico.', err);
  }
  const orderIdx = new Map(order.map((n, i) => [n.toLowerCase(), i]));
  const idxOf = (m) => (orderIdx.has(m.toLowerCase()) ? orderIdx.get(m.toLowerCase()) : 9999);
  const lineaIdx = (v) => (LINEE.findIndex((l) => l.value === v) + 1 || 99);

  const LINE_H = 4.9; // altezza di una riga di testo (10,5 pt)

  // Più giorni: un gruppo per giorno (dal più vecchio al più recente); un solo giorno: un gruppo unico, senza fascia
  const dayOf = (r) => isoDay(new Date(r.esito_at));
  const days = [...new Set(rows.map(dayOf))].sort();
  const groups = days.length > 1 ? days.map((day) => ({ day, rows: rows.filter((r) => dayOf(r) === day) })) : [{ day: null, rows }];

  for (const group of groups) {
    if (group.day) {
      const [gy, gm, gd] = group.day.split('-').map(Number);
      const dayTitle = new Date(gy, gm - 1, gd).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      ensure(46); // la fascia del giorno non resta mai sola in fondo alla pagina
      drawBand(doc, M, CW, y, 10, dayTitle.toUpperCase(), `${group.rows.length} ${group.rows.length === 1 ? 'intervento' : 'interventi'}`);
      y += 15;
    }
    const linee = [...new Set(group.rows.map((r) => r.linea))].sort((a, b) => lineaIdx(a) - lineaIdx(b));

  for (const linea of linee) {
    const inLinea = group.rows.filter((r) => r.linea === linea);
    const machines = [...new Set(inLinea.map((r) => r.macchina))].sort((a, b) => idxOf(a) - idxOf(b) || a.localeCompare(b, 'it'));

    // fascia della linea (con almeno la prima macchina e il suo primo intervento sotto)
    ensure(34);
    drawBand(doc, M, CW, y, 8.5, lineaLabel(linea).toUpperCase(), `${inLinea.length}`);
    y += 13;

    for (const macchina of machines) {
      const items = inLinea
        .filter((r) => r.macchina === macchina)
        .sort((a, b) => new Date(a.esito_at) - new Date(b.esito_at));

      // intestazione della macchina: non resta mai sola in fondo alla pagina
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      const firstLines = doc.splitTextToSize(items[0].descrizione || '', CW - 12);
      ensure(11 + firstLines.length * LINE_H);
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
        const lines = doc.splitTextToSize(r.descrizione || '', CW - 12);
        const photo = photos.get(r.id);
        const { pw, ph } = photo ? photoSize(photo) : { pw: 0, ph: 0 };
        // dettagli scelti per questo intervento (dettagli e note dell'esito), in grigio sotto il titolo
        doc.setFontSize(9.5);
        const det = detailIds?.has(r.id) ? dettagliPdf(r).flatMap((t) => doc.splitTextToSize(t, CW - 12)) : [];
        doc.setFontSize(10.5);
        const DET_H = 4.3;
        // testo, dettagli e foto restano sulla stessa pagina
        ensure(lines.length * LINE_H + 3 + (det.length ? det.length * DET_H + 1 : 0) + (photo ? ph + 4 : 0));
        doc.setFillColor(...ACCENT);
        doc.circle(M + 3, y - 1.3, 0.9, 'F');
        doc.setTextColor(30, 30, 34);
        doc.text(lines, M + 7, y);
        y += lines.length * LINE_H + 2.4;
        if (det.length) {
          doc.setFontSize(9.5);
          doc.setTextColor(...GREY);
          doc.text(det, M + 7, y);
          doc.setFontSize(10.5);
          y += det.length * DET_H + 1;
        }
        if (photo) {
          doc.addImage(photo.data, 'JPEG', M + 7, y - 0.6, pw, ph);
          doc.setDrawColor(...LINE);
          doc.setLineWidth(0.2);
          doc.rect(M + 7, y - 0.6, pw, ph);
          y += ph + 4;
        }
      }
      y += 3;
    }
    y += 3;
  }
  }

  // ---- Numeri di pagina ----
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`Pagina ${i} di ${total}`, PW - M, PH - 8, { align: 'right' });
    doc.text(`Interventi ${periodo}`, M, PH - 8);
  }

  // ---- Consegna: condividi (mail…) o scarica ----
  const name = sameDay ? `interventi_${isoDay(from)}.pdf` : `interventi_${isoDay(from)}_${isoDay(to)}.pdf`;
  const blob = doc.output('blob');
  const file = new File([blob], name, { type: 'application/pdf' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canShare) {
    // Il foglio di condivisione richiede un tocco appena avvenuto: lo si ottiene dalla scelta
    const share = await confirmDialog({
      title: 'PDF pronto',
      message: `${rows.length} ${rows.length === 1 ? 'intervento' : 'interventi'} del ${periodo}. Vuoi inviarlo (mail, WhatsApp…) o salvarlo sul telefono?`,
      confirmLabel: 'Invia',
      cancelLabel: 'Salva',
    });
    if (share) {
      try {
        await navigator.share({ files: [file], title: `Interventi ${periodo}`, text: `Interventi di manutenzione effettuati - ${periodo}` });
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return 'cancelled';
        // se la condivisione non parte, ripiega sul download
      }
    }
  }
  doc.save(name);
  return true;
}
