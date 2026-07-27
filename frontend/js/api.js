// Every caller expects { ok, ... } back and never a thrown error — a
// network hiccup, a wrong SUPABASE_FUNCTION_URL, or a misconfigured
// function would otherwise throw inside an async click handler with
// nothing shown on screen.
async function safeFetchJson(action, body) {
  let res;
  try {
    res = await fetch(SUPABASE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ action, ...(body || {}) })
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
  try {
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'Unexpected response from the server — check SUPABASE_FUNCTION_URL / SUPABASE_ANON_KEY in config.js.' };
  }
}

// get/post are both POSTs under the hood now — the Edge Function handles
// real CORS properly, so there's no more need for the GET-with-query-string
// / text-plain-to-dodge-preflight workarounds Apps Script required. Kept
// as two names since call sites already read naturally as reads vs writes.
const Api = {
  get(action, params) {
    return safeFetchJson(action, params);
  },

  post(action, body) {
    return safeFetchJson(action, body);
  },

  authedPost(action, body) {
    const token = Session.get()?.token;
    return this.post(action, { ...(body || {}), token });
  }
};

const Session = {
  KEY: 'bkbcpl_session',

  get() {
    const raw = localStorage.getItem(this.KEY);
    return raw ? JSON.parse(raw) : null;
  },

  set(session) {
    localStorage.setItem(this.KEY, JSON.stringify(session));
  },

  clear() {
    localStorage.removeItem(this.KEY);
  }
};
