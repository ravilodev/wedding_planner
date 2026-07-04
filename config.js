/**
 * config.js
 * Public, client-side config — safe to expose in the browser.
 *
 * The Supabase "anon" key is NOT a secret; it's designed to be public
 * and relies on Row Level Security (see supabase/schema.sql) to keep
 * data private. Never put the Gemini API key here — that one stays
 * server-side only, as a Vercel Environment Variable (see README.md).
 *
 * Fill these in from: Supabase Dashboard → Settings → API
 */
const SUPABASE_URL = 'https://ulqydcavmykbgxcaoojs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVscXlkY2F2bXlrYmd4Y2Fvb2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTE5MjMsImV4cCI6MjA5ODc2NzkyM30.4MaRTCpKwQ8ieEwsUBmB1WgRWU294m-VIOAJY3MWliw';
