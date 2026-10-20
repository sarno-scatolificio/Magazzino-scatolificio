// =============================================================
// desktop.js — Interazione desktop (≥1024px): tastiera e scorciatoie. Non cambia la logica dei moduli:
// si appoggia ai pulsanti già presenti (clic simulati), quindi ogni funzione resta quella dell'app.
// Esc chiude · Ctrl/⌘+Invio salva · Invio avanza di campo · frecce nelle scelte · / cerca · Alt+1…5 sezioni · N nuovo intervento
// =============================================================

const mq = window.matchMedia('(min-width: 1024px)');
const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const visible = (el) => !!el && el.offsetParent !== null && !el.closest('[inert]');

/** Modale aperta in primo piano (z-index più alto) */
function topModal() {
  const open = [...document.querySelectorAll('.modal-overlay.modal-visible')];
  return open.sort((a, b) => (parseInt(getComputedStyle(b).zIndex, 10) || 0) - (parseInt(getComputedStyle(a).zIndex, 10) || 0))[0] || null;
}

/** Pulsante principale (salva/conferma) della modale: nel piede, poi il submit del modulo, poi un id che finisce per -save */
function primaryButton(modal) {
  const sel = ['[data-primary]', '[id$="-save"]', '.modal-panel > .shrink-0 button.bg-amber-400', 'form [type="submit"]'];
  for (const s of sel) {
    const b = [...modal.querySelectorAll(s)].find((x) => !x.disabled && visible(x));
    if (b) return b;
  }
  return null;
}

const fields = (modal) => [...modal.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, select')].filter((f) => !f.disabled && visible(f));

function onKey(e) {
  if (!mq.matches || e.isComposing) return;
  const modal = topModal();
  const el = document.activeElement;

  if (modal) {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true })); // stessa via del tocco sullo sfondo
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const b = primaryButton(modal);
      if (b) {
        e.preventDefault();
        b.click();
      }
      return;
    }
    // Frecce: scelte in elenco (opzioni e caselle) e controlli a scorrimento (linee, tipo)
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && el) {
      const role = el.getAttribute('role');
      if (role === 'option' || role === 'checkbox') {
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        const sibs = [...el.parentElement.children].filter((x) => x.getAttribute('role') === role);
        const next = sibs[sibs.indexOf(el) + dir];
        if (next && dir) {
          e.preventDefault();
          next.focus();
          next.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      const seg = el.closest('.seg');
      if (seg && el.tagName === 'BUTTON' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const tabs = [...seg.querySelectorAll('button')];
        const next = tabs[tabs.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          next.focus();
          next.click();
        }
        return;
      }
    }
    // Invio: avanza al campo successivo; sull'ultimo conferma. Nei moduli <form> e nei campi che gestiscono già Invio non interviene.
    if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented && el?.tagName === 'INPUT' && !el.closest('form') && el.type !== 'checkbox') {
      const list = fields(modal);
      const next = list[list.indexOf(el) + 1];
      e.preventDefault();
      if (next) next.focus();
      else primaryButton(modal)?.click();
    }
    return;
  }

  // Nessuna modale aperta: scorciatoie globali
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const item = [...document.querySelectorAll('[data-nav-target]')].filter(visible)[Number(e.key) - 1];
    if (item) {
      e.preventDefault();
      item.click();
    }
    return;
  }
  if (typing(el) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    const s = document.getElementById('hsearch-input');
    if (visible(s)) {
      e.preventDefault();
      s.focus();
      s.select();
    }
  } else if (e.key.toLowerCase() === 'n') {
    const fab = document.getElementById('int-fab');
    if (fab?.classList.contains('int-fab--on')) {
      e.preventDefault();
      fab.click();
    }
  }
}

/** Numero scorciatoia sulle voci della barra laterale (Alt+1…) */
function labelNav() {
  [...document.querySelectorAll('[data-nav-target]')].filter(visible).forEach((b, i) => {
    b.dataset.kbd = `Alt+${i + 1}`;
    b.title = `${b.textContent.trim()} (Alt+${i + 1})`;
  });
}

/** Riga suggerimenti in fondo alle modali con un pulsante principale (una volta sola) */
function addHints() {
  document.querySelectorAll('.modal-overlay .modal-panel').forEach((p) => {
    if (p.querySelector('.dk-hint') || !p.querySelector('[id$="-save"], .shrink-0 button.bg-amber-400')) return;
    const h = document.createElement('div');
    h.className = 'dk-hint';
    h.innerHTML = '<span><kbd>Invio</kbd>campo successivo</span><span><kbd>Ctrl</kbd>+<kbd>Invio</kbd>salva</span><span><kbd>Esc</kbd>chiudi</span>';
    p.appendChild(h);
  });
}

document.addEventListener('keydown', onKey);
let navObs = null;
function sync() {
  document.body.classList.toggle('is-desktop', mq.matches);
  if (!mq.matches) return;
  labelNav();
  addHints();
  if (!navObs) {
    // le voci riservate all'Admin compaiono dopo il login: si rinumera quando la barra cambia
    const nav = document.querySelector('.nav-glass');
    if (nav) (navObs = new MutationObserver(labelNav)).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden', 'style'] });
  }
}
mq.addEventListener('change', sync);
window.addEventListener('load', sync);
