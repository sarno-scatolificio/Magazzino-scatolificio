// =============================================================
// supabase-manuals.js — Manuali (ricambi e operatore), sezioni, gruppi e upload dei file
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';

// --- MANUALI RICAMBI (PDF allegati alle macchine) -----------------
// Un manuale per ogni coppia macchina+linea (tabella `machine_manuals`,
// vincolo UNIQUE su machine_id+linea): un nuovo upload sulla stessa coppia
// sostituisce il precedente. linea = '' significa "generale" (vale per
// tutte le linee di quella macchina, usato come ripiego se non esiste un
// manuale specifico per la linea del pezzo). Il file vero e proprio vive
// nel bucket privato `manuali-macchine` dello Storage; l'apertura in app
// passa sempre da un URL firmato a tempo (mai pubblico).
const MANUALS_BUCKET = 'manuali-macchine';

/** True se l'errore indica che la tabella `machine_manuals` non esiste (ancora) sul database */
function isMissingManualsTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || (/machine_manuals/.test(msg) && /schema cache|does not exist/i.test(msg));
}

/**
 * Elenco di tutti i manuali caricati (una riga per ogni coppia macchina+linea),
 * per sapere a colpo d'occhio quali sono già presenti (Impostazioni e scheda
 * articolo in Ricambi tecnici).
 * @returns {Promise<{ manuals: Array<{id:string, machine_id:string, linea:string, file_name:string, storage_path:string, created_at:string, machines:{nome:string}}>, tableMissing: boolean }>}
 */
export async function listMachineManuals() {
  const { data, error } = await supabase
    .from('machine_manuals')
    .select('id, machine_id, linea, file_name, storage_path, file_size, created_at, machines(nome)');
  if (error) {
    if (isMissingManualsTable(error)) return { manuals: [], tableMissing: true };
    throw error;
  }
  return { manuals: (data || []).map((r) => ({ ...r, bucket: MANUALS_BUCKET })), tableMissing: false };
}

// --- UPLOAD CON AVANZAMENTO ------------------------------------------------
// supabase-js non espone l'avanzamento dell'upload (usa fetch): qui si invia lo
// stesso file con XMLHttpRequest verso l'endpoint Storage, così si può
// riportare la percentuale. Stessa autenticazione e stesse policy RLS.
async function uploadWithProgress(bucket, storagePath, file, { contentType, onProgress } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || SUPABASE_ANON_KEY;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`;
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', contentType && file.type !== contentType ? new Blob([file], { type: contentType }) : file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      let message = `Caricamento non riuscito (errore ${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText);
        message = body.message || body.error || message;
      } catch (err) {
        /* risposta non JSON: resta il messaggio generico */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Connessione assente o interrotta durante il caricamento.'));
    xhr.onabort = () => reject(new Error('Caricamento annullato.'));
    xhr.send(form);
  });
}

/**
 * Carica (o sostituisce) il manuale PDF di una macchina per una specifica
 * linea (o generale, se `linea` è vuota/omessa): rimuove prima l'eventuale
 * file/riga precedente della stessa coppia macchina+linea, poi carica il
 * nuovo file nello Storage e registra la riga in `machine_manuals`. Solo
 * admin (RLS + policy Storage).
 * @param {string} machineId
 * @param {string} linea es. 'L1', 'L2', 'L1-L2', oppure '' per "generale"
 * @param {File} file
 * @param {(percent:number)=>void} [onProgress] avanzamento dell'upload, da 0 a 100
 */
export async function uploadMachineManual(machineId, linea, file, onProgress) {
  if (!file) throw new Error('Nessun file selezionato.');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Il manuale deve essere un file PDF.');
  }
  const lineaValue = linea || '';

  // Rimuove l'eventuale manuale precedente della stessa coppia macchina+linea (vincolo 1:1)
  const { data: existing } = await supabase
    .from('machine_manuals')
    .select('id, storage_path')
    .eq('machine_id', machineId)
    .eq('linea', lineaValue)
    .maybeSingle();
  if (existing) {
    await supabase.storage.from(MANUALS_BUCKET).remove([existing.storage_path]);
    await supabase.from('machine_manuals').delete().eq('id', existing.id);
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const storagePath = `${machineId}/${lineaValue || 'generale'}/${Date.now()}_${safeName}`;
  let uploadErr = null;
  try {
    await uploadWithProgress(MANUALS_BUCKET, storagePath, file, { contentType: 'application/pdf', onProgress });
  } catch (err) {
    uploadErr = err;
  }
  if (uploadErr) {
    if (/row-level security|not allowed|permission/i.test(uploadErr.message || '')) {
      throw new Error('Solo un amministratore può caricare i manuali.');
    }
    throw uploadErr;
  }

  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('machine_manuals')
    .insert({
      machine_id: machineId,
      linea: lineaValue,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      uploaded_by: userData?.user?.id || null,
    })
    .select()
    .single();
  if (error) {
    // Se la riga non si registra, il file resta orfano: lo si toglie subito dallo Storage.
    await supabase.storage.from(MANUALS_BUCKET).remove([storagePath]);
    if (isMissingManualsTable(error)) {
      throw new Error('La tabella dei manuali non è ancora stata creata sul database.');
    }
    throw error;
  }
  return data;
}

/** Elimina il manuale di una macchina (file + riga). Solo admin. */
export async function deleteMachineManual(manual) {
  const { error: storageErr } = await supabase.storage.from(MANUALS_BUCKET).remove([manual.storage_path]);
  if (storageErr) throw storageErr;
  const { error } = await supabase.from('machine_manuals').delete().eq('id', manual.id);
  if (error) throw error;
}

/**
 * URL firmato temporaneo (1 ora) per aprire/scaricare il PDF dal bucket
 * privato — mai un URL pubblico permanente. `bucket` distingue tra manuali
 * ricambi (manuali-macchine, default) e manuali operatore (manuali-operatore).
 */
export async function getManualSignedUrl(storagePath, bucket = MANUALS_BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// --- MANUALI OPERATORE (PDF allegati alle macchine, PIÙ di uno per macchina) ---
// A differenza di machine_manuals (1 manuale ricambi per coppia macchina+linea),
// qui non c'è alcun vincolo di unicità: un Admin può caricarne quanti vuole per
// macchina (es. uso e manutenzione, sicurezza, avviamento…). Bucket separato,
// stesso livello di privacy (URL firmati, mai pubblico).
const OPERATOR_MANUALS_BUCKET = 'manuali-operatore';

function isMissingOperatorManualsTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || (/machine_operator_manuals/.test(msg) && /schema cache|does not exist/i.test(msg));
}

/**
 * Elenco di tutti i manuali operatore caricati, per popolare la cache condivisa
 * (manuals.js) usata da Impostazioni → Gestione macchine e dalla vista Manuali.
 * @returns {Promise<{ manuals: Array<{id:string, machine_id:string, file_name:string, storage_path:string, created_at:string, bucket:string, machines:{nome:string}}>, tableMissing: boolean }>}
 */
export async function listOperatorManuals() {
  const { data, error } = await supabase
    .from('machine_operator_manuals')
    .select('id, machine_id, file_name, storage_path, file_size, created_at, machines(nome)')
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingOperatorManualsTable(error)) return { manuals: [], tableMissing: true };
    throw error;
  }
  return { manuals: (data || []).map((r) => ({ ...r, bucket: OPERATOR_MANUALS_BUCKET })), tableMissing: false };
}

/** Carica un nuovo manuale operatore per una macchina (si aggiunge agli altri, non li sostituisce). Solo admin. */
export async function uploadOperatorManual(machineId, file, onProgress) {
  if (!file) throw new Error('Nessun file selezionato.');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Il manuale deve essere un file PDF.');
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const storagePath = `${machineId}/${Date.now()}_${safeName}`;
  let uploadErr = null;
  try {
    await uploadWithProgress(OPERATOR_MANUALS_BUCKET, storagePath, file, { contentType: 'application/pdf', onProgress });
  } catch (err) {
    uploadErr = err;
  }
  if (uploadErr) {
    if (/row-level security|not allowed|permission/i.test(uploadErr.message || '')) {
      throw new Error('Solo un amministratore può caricare i manuali.');
    }
    throw uploadErr;
  }

  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('machine_operator_manuals')
    .insert({
      machine_id: machineId,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      uploaded_by: userData?.user?.id || null,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(OPERATOR_MANUALS_BUCKET).remove([storagePath]);
    if (isMissingOperatorManualsTable(error)) {
      throw new Error('La tabella dei manuali operatore non è ancora stata creata sul database.');
    }
    throw error;
  }
  return { ...data, bucket: OPERATOR_MANUALS_BUCKET };
}

/** Elimina un manuale operatore (file + riga). Solo admin. */
export async function deleteOperatorManual(manual) {
  const { error: storageErr } = await supabase.storage.from(OPERATOR_MANUALS_BUCKET).remove([manual.storage_path]);
  if (storageErr) throw storageErr;
  const { error } = await supabase.from('machine_operator_manuals').delete().eq('id', manual.id);
  if (error) throw error;
}

// --- SEZIONI/PULSANTI DEL MANUALE OPERATORE (indice per intervallo di pagine) ---
// Ogni riga è un pulsante che l'Admin definisce ("Mettifoglio", "Squadratura"…),
// legato a UN manuale operatore preciso e a un intervallo di pagine al suo interno.
// Le icone vivono in un bucket pubblico separato (sono solo grafiche, non documenti).
export const SECTION_ICONS_BUCKET = 'manuali-sezioni-icone';

function isMissingSectionsTable(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST205' || error?.code === '42P01' || (/machine_manual_sections/.test(msg) && /schema cache|does not exist/i.test(msg));
}

/**
 * Elenco di tutte le sezioni/pulsanti definiti, per popolare la cache condivisa (manuals.js).
 * @returns {Promise<{ sections: Array<{id:string, machine_id:string, operator_manual_id:string, label:string, icon_storage_path:string|null, page_start:number, page_end:number, sort_order:number}>, tableMissing: boolean }>}
 */
export async function listManualSections() {
  const { data, error } = await supabase
    .from('machine_manual_sections')
    .select('id, machine_id, operator_manual_id, label, icon_storage_path, page_start, page_end, sort_order, group_id')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingSectionsTable(error)) return { sections: [], tableMissing: true };
    throw error;
  }
  return { sections: data || [], tableMissing: false };
}

/** Carica l'icona di un pulsante nel bucket pubblico e restituisce il suo storage_path. Solo admin. */
export async function uploadSectionIcon(file, onProgress) {
  if (!file) return null;
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const storagePath = `${Date.now()}_${safeName}`;
  let error = null;
  try {
    await uploadWithProgress(SECTION_ICONS_BUCKET, storagePath, file, { onProgress });
  } catch (err) {
    error = err;
  }
  if (error) {
    if (/row-level security|not allowed|permission/i.test(error.message || '')) {
      throw new Error('Solo un amministratore può caricare le icone.');
    }
    throw error;
  }
  return storagePath;
}

/** URL pubblico (permanente, il bucket delle icone non è privato) di un'icona. */
export function getSectionIconUrl(storagePath) {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(SECTION_ICONS_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

/** Crea un nuovo pulsante/sezione per un manuale operatore. Solo admin. */
export async function createManualSection({ machineId, operatorManualId, label, iconStoragePath, pageStart, pageEnd, sortOrder, groupId }) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('machine_manual_sections')
    .insert({
      machine_id: machineId,
      operator_manual_id: operatorManualId,
      label,
      icon_storage_path: iconStoragePath || null,
      page_start: pageStart,
      page_end: pageEnd,
      sort_order: sortOrder ?? 0,
      group_id: groupId || null,
      created_by: userData?.user?.id || null,
    })
    .select()
    .single();
  if (error) {
    if (isMissingSectionsTable(error)) {
      throw new Error('La tabella delle sezioni non è ancora stata creata sul database.');
    }
    throw error;
  }
  return data;
}

/** Elimina un pulsante/sezione (e la sua icona, se presente). Solo admin. */
export async function deleteManualSection(section) {
  if (section.icon_storage_path) {
    await supabase.storage.from(SECTION_ICONS_BUCKET).remove([section.icon_storage_path]);
  }
  const { error } = await supabase.from('machine_manual_sections').delete().eq('id', section.id);
  if (error) throw error;
}

/**
 * Salva in blocco il nuovo ordine dei pulsanti di una macchina dopo un riordino via
 * trascinamento: `orderedIds` è l'elenco degli id nel nuovo ordine, a cui viene
 * assegnato sort_order 0,1,2... in sequenza. Le policy RLS in scrittura sono solo
 * admin, quindi un operatore che provasse comunque la chiamata la vedrebbe rifiutata.
 */
export async function updateManualSectionsOrder(orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from('machine_manual_sections').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

/**
 * Aggiorna un pulsante/sezione esistente (stessa schermata usata per crearlo). Solo admin.
 * Se `newIconStoragePath` è presente (l'admin ha scelto una nuova icona), sostituisce anche
 * il file precedente (`previousIconStoragePath`), eliminandolo dallo storage.
 */
export async function updateManualSection(sectionId, { operatorManualId, label, pageStart, pageEnd, newIconStoragePath, previousIconStoragePath, groupId }) {
  const patch = {
    operator_manual_id: operatorManualId,
    label,
    page_start: pageStart,
    page_end: pageEnd,
  };
  if (newIconStoragePath !== undefined) patch.icon_storage_path = newIconStoragePath;
  if (groupId !== undefined) patch.group_id = groupId || null; // undefined = invariato, null/'' = nessun gruppo

  const { data, error } = await supabase.from('machine_manual_sections').update(patch).eq('id', sectionId).select().single();
  if (error) {
    if (isMissingSectionsTable(error)) throw new Error('La tabella delle sezioni non è ancora stata creata sul database.');
    throw error;
  }
  if (newIconStoragePath !== undefined && previousIconStoragePath && previousIconStoragePath !== newIconStoragePath) {
    await supabase.storage.from(SECTION_ICONS_BUCKET).remove([previousIconStoragePath]);
  }
  return data;
}


// --- GRUPPI DI PIASTRELLE (macrogruppi mostrati come tab nella vista Manuali) ---

/** Elenco di tutti i gruppi di tutte le macchine, per la cache condivisa (manuals-data.js). Se la tabella manca, restituisce un elenco vuoto. */
export async function listManualGroups() {
  const { data, error } = await supabase
    .from('machine_manual_groups')
    .select('id, machine_id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return { groups: [], tableMissing: true };
    throw error;
  }
  return { groups: data || [], tableMissing: false };
}

/** Crea un gruppo per una macchina. Solo admin. */
export async function createManualGroup({ machineId, name, sortOrder }) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('machine_manual_groups')
    .insert({ machine_id: machineId, name, sort_order: sortOrder ?? 0, created_by: userData?.user?.id || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Rinomina un gruppo. Solo admin. */
export async function updateManualGroup(groupId, { name }) {
  const { data, error } = await supabase.from('machine_manual_groups').update({ name }).eq('id', groupId).select().single();
  if (error) throw error;
  return data;
}

/** Elimina un gruppo: le sue piastrelle non vengono toccate, restano senza gruppo (campo group_id azzerato dal database). Solo admin. */
export async function deleteManualGroup(groupId) {
  const { error } = await supabase.from('machine_manual_groups').delete().eq('id', groupId);
  if (error) throw error;
}

/** Salva l'ordine dei gruppi di una macchina: sort_order 0,1,2... nell'ordine degli id ricevuti. Solo admin. */
export async function updateManualGroupsOrder(orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from('machine_manual_groups').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}
