// static/js/supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://ugpqqmcstqtywyrzfnjq.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVncHFxbWNzdHF0eXd5cnpmbmpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3Mzk2ODgsImV4cCI6MjA2NTMxNTY4OH0.nh56rQQliOnX5AZzePaZv_RB05uRIlUbfQPkWJPvKcE";

// Usa SIEMPRE el window.fetch (pasa por el logger/rewriter del index.html)
export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: (...args) => window.fetch(...args) },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});


try { window.supabase = supabase; } catch {}

// Helper: UID (uuid) y lo deja global para el rewriter
export async function getUID() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id || null;
  window.UID = uid;
  return uid;
}
