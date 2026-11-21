// Fill these in after deploying the Supabase project (see README.md).
// SUPABASE_FUNCTION_URL looks like: https://YOUR_PROJECT_REF.supabase.co/functions/v1/api
// SUPABASE_ANON_KEY is the "anon public" key from Project Settings → API.
const SUPABASE_FUNCTION_URL = 'https://akzvnrqiryrgkcpariur.supabase.co/functions/v1/api';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrenZucnFpcnlyZ2tjcGFyaXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMTAyMDEsImV4cCI6MjEwMDY4NjIwMX0.WOwc4njhffhnjxzQQUgolbz79PqQrCLekmMidL48aLg';

// Shown in the browser tab, the login screen, and the topbar — change these
// to your own group's name. Nothing else in the code needs to know it.
const APP_NAME = 'BKB Career Premier League';
const APP_SHORT_NAME = 'BKB CPL';

// Region the Edge Function should run in. The database lives in us-east-1,
// so running the function next to it removes a cross-country hop from each
// of the function's database queries. Leave '' to let Supabase pick the
// region nearest the user. Set it to your database's region.
const SUPABASE_FUNCTION_REGION = 'us-east-1';

// The Wall refreshes every 30s while the tab is visible, and stops entirely
// after IDLE_STOP_MS without a tap/scroll/keypress (a tab left open on a
// desktop all day shouldn't keep polling). It resumes on the next touch.
const WALL_POLL_INTERVAL_MS = 30000;
const IDLE_STOP_MS = 10 * 60 * 1000;
const QUICK_REACTIONS = ['🔥', '💪', '🎉', '👏', '🚀'];
