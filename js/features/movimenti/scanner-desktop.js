// =============================================================
// scanner-desktop.js — Movimenti su desktop (≥1024px): postazione rapida
// Campo «scansiona o cerca» sempre pronto (il lettore barcode USB scrive come una tastiera e conferma con Invio),
// modalità Deposito/Prelievo con D e P, ricerca e conferma da tastiera nella finestra di movimento.
// Le piastrelle «sotto scorta» e «prestiti» restano quelle del mobile (a destra, si allargano al clic).
// =============================================================

import { els } from './scanner-shared.js';
import { selectMode } from './scanner-camera.js';
import { onProductMatched } from './scanner-result.js';
import { getCachedProductByBarcode, getProductByBarcode } from '../../data/supabase.js';
import feedback from '../../shared/feedback.js';

const MQ = window.matchMedia('(min-width: 1024px)');
const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function initScannerDesktop() {
  const input = document.getElementById('scanner-desk-input');
  const btns = [...document.querySelectorAll('[data-desk-mode]')];
  if (!input || !btns.length) return;
  let mode = 'prelievo'; // il movimento più frequente

  const paint = () => btns.forEach((b) => b.classList.toggle('is-on', b.dataset.deskMode === mode));
  const setMode = (m, { focus = true } = {}) => {
    mode = m;
    paint();
    if (focus) input.focus();
  };
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      feedback.modeSelect();
      setMode(b.dataset.deskMode);
    })
  );
  paint();

  /** Invio nel campo: codice a barre esatto → articolo subito; altrimenti la ricerca per testo nella finestra */
  async function run() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    selectMode(mode);
    let product = null;
    try {
      product = await getProductByBarcode(text);
    } catch {
      product = getCachedProductByBarcode(text) || null; // offline: dalla copia locale
    }
    if (product) {
      onProductMatched(product);
      return;
    }
    els.codeSearchInput.value = text;
    els.codeSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.codeSearchInput.focus();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });

  // Nella finestra di movimento: Invio sceglie il primo risultato, ↑ ↓ scorrono i risultati, Ctrl+Invio conferma
  const opts = () => [...els.codeSearchResults.querySelectorAll('.custom-select-option')];
  els.codeSearchInput.addEventListener('keydown', (e) => {
    if (!MQ.matches) return;
    if (e.key === 'Enter') {
      const first = opts()[0];
      if (first) {
        e.preventDefault();
        first.click();
      }
    } else if (e.key === 'ArrowDown') {
      const first = opts()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  els.codeSearchResults.addEventListener('keydown', (e) => {
    if (!MQ.matches || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const list = opts();
    const i = list.indexOf(document.activeElement);
    e.preventDefault();
    if (e.key === 'ArrowUp' && i <= 0) els.codeSearchInput.focus();
    else list[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
  });
  els.confirmBtn?.setAttribute('data-primary', ''); // Ctrl+Invio (desktop.js) conferma il movimento

  // D / P: sceglie la modalità e porta il cursore nel campo (solo a vista Movimenti aperta, senza modali e senza scrivere altrove)
  document.addEventListener('keydown', (e) => {
    if (!MQ.matches || e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
    if (document.getElementById('view-scanner')?.offsetParent === null || document.querySelector('.modal-overlay.modal-visible')) return;
    const k = e.key.toLowerCase();
    if (k === 'd' || k === 'p') {
      e.preventDefault();
      feedback.modeSelect();
      setMode(k === 'd' ? 'deposito' : 'prelievo');
    }
  });
}
