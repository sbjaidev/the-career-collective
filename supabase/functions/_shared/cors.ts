export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // authorization + apikey are required on every call — Supabase's own
  // gateway checks them before the request even reaches this function —
  // so both must be explicitly allowed or the browser's preflight blocks
  // the real request before it's ever sent.
  // x-region lets the frontend ask Supabase to run the function in the same
  // region as the database (see SUPABASE_FUNCTION_REGION in config.js) —
  // the function makes several database round trips per request, so
  // running it next to the database instead of next to the user is faster.
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
