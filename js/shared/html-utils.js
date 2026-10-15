// =============================================================
// html-utils.js — Utilità HTML condivise, senza dipendenze.
// Unica copia di escapeHtml: ogni testo inserito dall'utente (nomi,
// descrizioni, note) va passato da qui prima di finire in innerHTML.
// =============================================================

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Rende innocuo un testo da inserire in HTML (null/undefined diventano stringa vuota). */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
