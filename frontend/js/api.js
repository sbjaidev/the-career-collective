const Api = {
  async get(action, params) {
    const query = new URLSearchParams({ action, ...(params || {}) });
    const res = await fetch(`${API_BASE_URL}?${query.toString()}`);
    return res.json();
  },

  // Sent as text/plain so the browser treats it as a "simple request"
  // and skips the CORS preflight — Apps Script web apps can't answer
  // an OPTIONS preflight, so a real JSON content-type would just fail.
  async post(action, body) {
    const res = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...(body || {}) })
    });
    return res.json();
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
