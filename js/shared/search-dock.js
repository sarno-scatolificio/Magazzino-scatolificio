// =============================================================
// search-dock.js — la barra di ricerca (e il tasto di scansione) in basso, sopra la barra di navigazione,
// come nella One UI di Samsung. Solo su telefono/tablet (< 1024 px): su desktop restano nella testata.
// Gli elementi sono gli stessi (#hsearch, #hsearch-scan-btn): global-search.js continua a funzionare senza modifiche,
// qui si spostano soltanto nel DOM. Con la tastiera aperta la barra sale sopra di essa (visualViewport).
// =============================================================
let dock = null;
let pill = null;

const desktopMq = window.matchMedia('(min-width: 1024px)');

/** Sezioni col pulsante «+»: la barra ha la stessa lunghezza di Movimenti e trasla solo a sinistra (margini in style.css) */
const DOCK_VIEWS_WITH_FAB = new Set(['products', 'interventi']);

function place() {
  const search = document.getElementById('hsearch');
  const scan = document.getElementById('hsearch-scan-btn');
  const right = document.querySelector('.hdr-right');
  if (!dock || !search || !right) return;
  if (desktopMq.matches) {
    // Desktop: la ricerca torna nella testata, prima dei pulsanti di destra
    right.before(search);
    if (scan) right.before(scan);
  } else {
    pill.append(search);
    if (scan) pill.append(scan);
  }
}

/** La barra sale sopra la tastiera: --kb-h = altezza coperta in basso, --dock-lift = distanza della barra dal fondo */
function measure() {
  if (!dock) return;
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const open = kb > 80;
  document.documentElement.style.setProperty('--kb-h', `${open ? Math.round(kb) : 0}px`);
  dock.classList.toggle('dock-kb', open);
  const lift = Math.max(0, window.innerHeight - dock.getBoundingClientRect().top);
  document.documentElement.style.setProperty('--dock-lift', `${Math.round(lift)}px`);
}

export function initSearchDock() {
  if (dock) return;
  const shell = document.getElementById('app-shell');
  if (!shell) return;
  dock = document.createElement('div');
  dock.id = 'search-dock';
  dock.className = 'search-dock';
  dock.dataset.view = 'scanner';
  pill = document.createElement('div');
  pill.className = 'dock-pill';
  dock.append(pill);
  shell.append(dock);
  place();
  desktopMq.addEventListener('change', () => { place(); measure(); });
  window.visualViewport?.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('scroll', measure);
  window.addEventListener('resize', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(dock);
  measure();
}

/** A ogni cambio di sezione: margini giusti e, nelle Impostazioni, niente barra di ricerca */
export function syncSearchDock(view) {
  if (!dock) return;
  dock.dataset.view = view;
  dock.classList.toggle('dock-hidden', view === 'settings');
  dock.classList.toggle('dock-fab', DOCK_VIEWS_WITH_FAB.has(view));
  document.getElementById('app-shell')?.classList.toggle('has-dock', view !== 'settings');
  requestAnimationFrame(measure);
}
