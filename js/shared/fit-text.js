// =============================================================
// fit-text.js — Rimpicciolisce il testo (in modo dinamico) finché la parola più lunga sta su una riga
// =============================================================
// Pensato per i nomi degli scaffali (es. "SA005", "Cassa deposito"): le parole non vanno mai spezzate a metà.
// "Cassa deposito" può andare su due righe, "SA005" resta su una sola, e se lo spazio è poco il carattere si
// riduce da solo. Si usa mettendo l'attributo data-fit-text sull'elemento (con la classe .fit-text) e chiamando
// fitTextIn(contenitore): da lì in poi il contenitore viene tenuto d'occhio e ricalcolato a ogni cambio di larghezza.

const MIN_SCALE = 0.5; // sotto la metà della dimensione originale non si scende

const observed = new WeakSet();

/**
 * Parte dalla dimensione originale e la riduce finché nessuna parola esce dalla larghezza disponibile
 * (una parola troppo lunga sporge: scrollWidth > clientWidth). Misura il testo vero nel browser, quindi
 * tiene conto di font, spaziatura lettere e maiuscole senza calcoli a parte.
 */
function fitOne(el) {
  el.style.fontSize = ''; // si riparte sempre dalla dimensione originale
  el.style.overflowWrap = '';
  if (!el.clientWidth) return; // elemento nascosto: si ricalcola quando compare
  const base = parseFloat(getComputedStyle(el).fontSize);
  if (!base) return;
  const floor = base * MIN_SCALE;
  let size = base;
  for (let i = 0; i < 6; i += 1) {
    const avail = el.clientWidth;
    const need = el.scrollWidth;
    if (need <= avail + 0.5) return; // ogni parola sta nella riga
    size = Math.max(floor, size * (avail / need) * 0.99);
    el.style.fontSize = `${size.toFixed(2)}px`;
    if (size <= floor) {
      el.style.overflowWrap = 'anywhere'; // ultima risorsa: parola enorme, si spezza solo se proprio non ci sta
      return;
    }
  }
}

/** Adatta tutti gli elementi [data-fit-text] dentro `container` */
function fitAll(container) {
  container.querySelectorAll('[data-fit-text]').forEach(fitOne);
}

/**
 * Adatta ora i testi [data-fit-text] di `container` e continua a farlo quando la sua larghezza cambia
 * (rotazione, apertura del cassetto, font caricato). Si può richiamare più volte: l'osservatore è uno solo.
 */
export function fitTextIn(container) {
  if (!container) return;
  fitAll(container);
  if (observed.has(container)) return;
  observed.add(container);
  let raf = 0;
  const refit = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => fitAll(container));
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refit).observe(container);
  document.fonts?.ready.then(refit).catch(() => {});
}
