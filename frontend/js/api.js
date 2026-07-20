// Every caller expects { ok, ... } back and never a thrown error — a
// network hiccup, a wrong API_BASE_URL, or Apps Script returning an HTML
// page instead of JSON (e.g. a misconfigured deployment) would otherwise
// throw inside an async click handler with nothing shown on screen.
async function safeFetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
  try {
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'Unexpected response from the server — check API_BASE_URL in config.js.' };
  }
}

const Api = {
  async get(action, params) {
    const query = new URLSearchParams({ action, ...(params || {}) });
    return safeFetchJson(`${API_BASE_URL}?${query.toString()}`);
  },

  // Sent as text/plain so the browser treats it as a "simple request"
  // and skips the CORS preflight — Apps Script web apps can't answer
  // an OPTIONS preflight, so a real JSON content-type would just fail.
  async post(action, body) {
    return safeFetchJson(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...(body || {}) })
    });
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
