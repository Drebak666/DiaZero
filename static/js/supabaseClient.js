// static/js/supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://ugpqqmcstqtywyrzfnjq.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVncHFxbWNzdHF0eXd5cnpmbmpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3Mzk2ODgsImV4cCI6MjA2NTMxNTY4OH0.nh56rQQliOnX5AZzePaZv_RB05uRIlUbfQPkWJPvKcE"; // Asegúrate de que esta clave sea la correcta y anónima pública

// Exporta la instancia de supabase para que otros módulos puedan usarla
export const supabase = createClient(supabaseUrl, supabaseKey);