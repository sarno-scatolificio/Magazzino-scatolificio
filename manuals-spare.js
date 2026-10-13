// =============================================================
// manuals-spare.js — Pulsanti Spare parts (manuali ricambi)
// =============================================================
// Parte di quello che prima era un unico manuals-browser.js (vedi manuals-browser.js).

import { els, ms } from './manuals-shared.js';
import { escapeHtml } from './html-utils.js';
import { getAnyManualForMachine, getManualsForMachine } from './manuals.js';
import { openManualExternal } from './manuals-external.js';
import { toastWarning } from './toast.js';

// ---------------------------------------------------------------- Spare Parts --

const SPARE_GROUP_CLASS =
  'spare-group inline-flex flex-col items-stretch rounded-xl bg-amber-400 shadow-sm shadow-amber-500/10 overflow-hidden';
const SPARE_MAIN_CLASS =
  'press-spring inline-flex items-center justify-center gap-1.5 hover:bg-amber-300 text-white font-display font-bold uppercase tracking-wide text-xs px-3.5 py-2.5';
const SPARE_ROW_CLASS =
  'press-spring flex w-full items-center gap-1.5 text-left hover:bg-amber-300 text-white font-display font-bold uppercase tracking-wide text-xs px-3.5 py-2.5 border-t border-white/25';

function spareLineLabel(linea) {
  if (!linea) return 'Generale';
  const num = linea.replace(/^l/i, '').trim();
  return num ? `Linea ${num}` : linea;
}

function openSpareManual(machine, manual, title) {
  if (!manual) {
    toastWarning(`Nessun manuale ricambi caricato per "${machine.nome}". Puoi caricarlo da Impostazioni → Gestione macchine.`);
    return;
  }
  // Dal pulsante Spare parts della sezione Manuali il PDF si apre con un'app esterna a scelta
  // dell'utente (la ricerca di un codice dalla scheda articolo usa invece il visualizzatore interno).
  openManualExternal(manual, { title });
}

/**
 * Se esistono sia il manuale della Linea 1 sia quello della Linea 2, la voce combinata
 * (es. "L1-L2") è superflua e non viene mostrata.
 */
function visibleSpareEntries(manuals) {
  const norm = (k) => String(k || '').replace(/\s+/g, '').toLowerCase();
  const keys = [...manuals.keys()].map(norm);
  const hasBoth = keys.includes('l1') && keys.includes('l2');
  return [...manuals.entries()].filter(([linea]) => !(hasBoth && /^l1[-\u2013/&+]l2$/.test(norm(linea))));
}

/**
 * Un unico pulsante "Spare parts", sempre, anche con più manuali ricambi (una
 * linea a testa, es. Saldatrice L1/L2). Con un solo manuale il tocco lo apre; con
 * più manuali il tocco estende lo stesso pulsante mostrando, al suo interno, un
 * accesso per ciascuna linea.
 */
export function renderSpareButtons(machine) {
  const wrap = els.spareWrap;
  if (!wrap) return;
  if (ms.spareOutsideHandler) document.removeEventListener('pointerdown', ms.spareOutsideHandler, true);
  ms.spareOutsideHandler = null;
  wrap.innerHTML = '';

  const manuals = getManualsForMachine(machine.id);
  const entries = visibleSpareEntries(manuals);
  const multi = entries.length > 1;

  const group = document.createElement('div');
  group.className = SPARE_GROUP_CLASS;
  const main = document.createElement('button');
  main.type = 'button';
  main.id = 'manuals-detail-spare-parts';
  main.className = SPARE_MAIN_CLASS;
  main.innerHTML =
    '<i data-lucide="cog" class="w-4 h-4" stroke-width="2.2"></i> Spare parts' +
    (multi ? ' <i data-lucide="chevron-down" class="spare-chevron w-3.5 h-3.5 opacity-80" stroke-width="2.6"></i>' : '');
  group.appendChild(main);

  if (!multi) {
    main.addEventListener('click', () => openSpareManual(machine, getAnyManualForMachine(machine.id), 'Spare parts'));
    wrap.appendChild(group);
    window.lucide?.createIcons();
    return;
  }

  const listTrack = document.createElement('div');
  listTrack.className = 'spare-group-list-track';
  const list = document.createElement('div');
  list.className = 'spare-group-list';
  listTrack.appendChild(list);
  entries.forEach(([linea, manual]) => {
    const label = spareLineLabel(linea);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = SPARE_ROW_CLASS;
    row.innerHTML = `<i data-lucide="file-text" class="w-4 h-4" stroke-width="2.2"></i> ${escapeHtml(label)}`;
    row.addEventListener('click', () => {
      setExpanded(false);
      openSpareManual(machine, manual, `Spare parts — ${label}`);
    });
    list.appendChild(row);
  });
  group.appendChild(listTrack);

  let expanded = false;
  function setExpanded(value) {
    expanded = value;
    listTrack.classList.toggle('spare-group-list-open', value);
    group.dataset.open = value ? 'true' : 'false';
    main.setAttribute('aria-expanded', value ? 'true' : 'false');
    if (ms.spareOutsideHandler) document.removeEventListener('pointerdown', ms.spareOutsideHandler, true);
    ms.spareOutsideHandler = null;
    if (value) {
      ms.spareOutsideHandler = (e) => {
        if (!group.contains(e.target)) setExpanded(false);
      };
      document.addEventListener('pointerdown', ms.spareOutsideHandler, true);
      group.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Più manuali ricambi: un solo tocco estende/richiude il pulsante, la scelta della linea sta al suo interno.
  main.addEventListener('click', () => setExpanded(!expanded));

  wrap.appendChild(group);
  window.lucide?.createIcons();
}
