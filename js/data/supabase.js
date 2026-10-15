// =============================================================
// supabase.js — Punto d'ingresso unico per l'accesso ai dati
// =============================================================
// Tutte le altre parti dell'app (auth.js, products.js, scanner.js,
// dashboard.js, app.js) importano da qui: nessuna query Supabase
// viene fatta al di fuori di questi moduli. Il codice è diviso per
// argomento; questo file si limita a riunirlo.

export * from './supabase-client.js';
export * from './supabase-auth.js';
export * from './supabase-products.js';
export * from './supabase-machines.js';
export * from './supabase-prestiti.js';
export * from './supabase-shelves.js';
export * from './supabase-manuals.js';
export * from './supabase-transactions.js';
