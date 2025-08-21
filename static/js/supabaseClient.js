// static/js/supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://nizjvhmrzjvjfxaapihm.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemp2aG1yemp2amZ4YWFwaWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2OTUxNzUsImV4cCI6MjA2NzI3MTE3NX0.7H9Kk5u5jFvFFyKlSTHN3eYb4lfLFHmeo2SMhFOXUCA"; // Asegúrate de que esta clave sea la correcta y anónima pública

// Exporta la instancia de supabase para que otros módulos puedan usarla
export const supabase = createClient(supabaseUrl, supabaseKey);