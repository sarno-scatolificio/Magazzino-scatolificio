// =============================================================
// supabase-auth.js — Login, sessione e profili utente
// =============================================================
// Parte di quello che prima era un unico supabase.js: il resto dell'app
// continua a importare tutto da './supabase.js', che riunisce questi moduli.

import { supabase } from './supabase-client.js';

// --- AUTH ------------------------------------------------------
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Recupera il profilo applicativo (con ruolo) dell'utente corrente */
export async function getMyProfile() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!userData?.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, email')
    .eq('id', userData.user.id)
    .single();
  if (error) throw error;
  return data;
}

// --- PROFILI UTENTE (gestione nomi, vista Impostazioni Admin) -------
export async function listProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, email, full_name, role').order('email');
  if (error) throw error;
  return data;
}

export async function updateProfileName(id, fullName) {
  const { data, error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
