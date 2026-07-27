export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // authorization + apikey are required on every call — Supabase's own
  // gateway checks them before the request even reaches this function —
  // so both must be explicitly allowed or the browser's preflight blocks
  // the real request before it's ever sent.
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
