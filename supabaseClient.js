import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════
// Hier deine Supabase-Zugangsdaten eintragen
// (Findest du in Supabase unter: Project Settings → API)
// ════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://imljstabxenkwatbubsw.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltbGpzdGFieGVua3dhdGJ1YnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDk5NzYsImV4cCI6MjA5NzEyNTk3Nn0.7tZx2C9gWNEhxRDGUldTgXMJjpUiFceyrR6sNuZ44mU;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
