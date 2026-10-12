// =============================================================
// supabase-client.js — Client Supabase e configurazione del progetto
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// --- Configurazione progetto ---------------------------------
// Valori del progetto Supabase collegato. La anon/publishable key
// è pubblica per design (protetta dalle policy RLS lato database).
export const SUPABASE_URL = 'https://ffbwazuikbqkikuybcyp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_kWZPPxUMxf78iuK5yCdlYg_f4J2oXwx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
