// =============================================================
// manuals-shared.js — Stato (ms), riferimenti e utilità condivisi dei moduli Manuali
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).



export const ms = {
  loaded: false, // dopo il primo caricamento, i rientri nella vista non mostrano più lo scheletro
  cachedMachines: [],
  currentMachine: null,
  pendingIconFile: null,
  editingSection: null, // null = si sta creando un nuovo pulsante; altrimenti quello in modifica
  reorderMode: false,
  reorderSaving: false,
  detailLayer: null, // voce di cronologia del dettaglio macchina (tasto indietro del telefono)
  reorderLayer: null, // voce di cronologia della modalità modifica
  editingGroup: null, // null = si sta creando un nuovo gruppo; altrimenti quello in modifica
  listReorderMode: false, // modalità modifica dell'ELENCO macchine (riordino + icone), distinta da quella del dettaglio
  listReorderSaving: false,
  listReorderLayer: null, // voce di cronologia della modalità modifica dell'elenco
  editingMachine: null, // macchina di cui si sta cambiando l'icona
  pendingMachineIconFile: null,
  removeMachineIcon: false,
  lastRenderedIds: [], // id delle piastrelle mostrate nell'ultimo disegno (per capire se l'ordine è stato cambiato)
  listScrollY: 0, // posizione dell'elenco macchine prima di aprire un dettaglio
  spareOutsideHandler: null, // chiude il pulsante Spare parts esteso al tocco fuori
};

export const els = {};

















export const activeGroupByMachine = new Map(); // machine_id -> id del gruppo (tab) aperto, oppure NO_GROUP
export const NO_GROUP = 'none'; // tab "Altro": piastrelle senza gruppo
export const GROUP_TAB_STORAGE_KEY = 'magazzino-manuali-tab:';



const LONG_PRESS_MS = 450;
const LONG_PRESS_TOLERANCE_PX = 10;

/**
 * Pressione prolungata via Pointer Events: scatta dopo LONG_PRESS_MS se il dito
 * non si sposta (altrimenti è uno scroll/trascinamento e il timer si annulla).
 * Il click che segue il rilascio dopo uno scatto viene soppresso. Va chiamata
 * PRIMA di registrare il listener di click dell'elemento.
 */
export function attachLongPress(el, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLongPress(e);
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_TOLERANCE_PX) clear();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => el.addEventListener(type, clear));
  el.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.noHaptic = true; // il rilascio dopo la pressione prolungata non è un tocco
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  // Su Android/desktop la pressione prolungata apre anche il menu contestuale: va evitato.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
