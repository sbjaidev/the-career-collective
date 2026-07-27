let wallPollTimer = null;
let activitiesCache = null;
let hiddenAt = null;

const SESSION_TIMEOUT_MS = 30 * 24 * 3600 * 1000; // 30 days, same as the World Cup app

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function getActivePanel() {
  return document.querySelector('.tab-btn.active')?.dataset.panel;
}

function init() {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const session = Session.get();
  if (session && Date.now() - (session.loginTime || 0) < SESSION_TIMEOUT_MS) {
    showApp();
  } else {
    if (session) Session.clear();
    showLogin();
  }
}

// Wall polling is paused while the tab is backgrounded (phone locked, tab
// switched) so it isn't burning requests for no one to see. On return, the
// Wall always catches up immediately; other panels only refresh if we were
// away long enough that their data might actually be stale.
function handleVisibilityChange() {
  if (!Session.get()) return;
  if (document.hidden) {
    hiddenAt = Date.now();
    stopWallPolling();
    return;
  }
  const wasAwayAWhile = hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000;
  hiddenAt = null;
  const panel = getActivePanel();
  if (panel === 'wall') {
    loadWall();
    startWallPolling();
  } else if (wasAwayAWhile && panel) {
    switchPanel(panel);
  }
}

function showLogin() {
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
}

function showApp() {
  const { user } = Session.get();
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
  document.getElementById('me-name').textContent = user.name;
  document.getElementById('me-team').textContent = user.team_name || user.job_function;
  switchPanel('wall');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const pin = document.getElementById('login-pin').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;

  const result = await Api.post('login', { username, pin });
  if (!result.ok) {
    errorEl.textContent = result.error || 'Login failed.';
    errorEl.hidden = false;
    return;
  }
  Session.set({ token: result.token, user: result.user, loginTime: Date.now() });
  showApp();
}

function handleLogout() {
  stopWallPolling();
  Session.clear();
  showLogin();
}

function switchPanel(name) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${name}`;
  });

  if (name === 'wall') {
    loadWall();
    startWallPolling();
  } else {
    stopWallPolling();
  }
  if (name === 'leaderboard') loadLeaderboard('individual');
  if (name === 'submit') loadSubmitForm();
  if (name === 'profile') loadProfile();
}

// ---- Wall ----

function startWallPolling() {
  stopWallPolling();
  wallPollTimer = setInterval(pollWallTick, WALL_POLL_INTERVAL_MS);
}

function stopWallPolling() {
  if (wallPollTimer) clearInterval(wallPollTimer);
  wallPollTimer = null;
}

// Re-rendering mid-keystroke would yank the comment box out from under
// whoever's typing, so a poll tick that lands while someone has a comment
// field focused just skips itself — the next tick tries again.
function pollWallTick() {
  if (document.activeElement?.matches('.comment-form input')) return;
  loadWall();
}

async function loadWall() {
  const result = await Api.get('wall', { limit: 50 });
  if (!result.ok) return;
  renderWall(result.entries);
}

function renderWall(entries) {
  const panel = document.getElementById('panel-wall');
  if (entries.length === 0) {
    panel.innerHTML = '<p class="empty">No activity yet — first one on the board wins bragging rights.</p>';
    return;
  }

  const myUserId = Session.get()?.user?.user_id;

  panel.innerHTML = entries.map((entry) => {
    const reactionChips = Object.entries(entry.reactions || {})
      .map(([emoji, count]) => `<span class="reaction-chip">${escapeHtml(emoji)} ${count}</span>`)
      .join('');

    const quickButtons = QUICK_REACTIONS
      .map((emoji) => `<button type="button" class="quick-react" data-log="${entry.log_id}" data-emoji="${emoji}">${emoji}</button>`)
      .join('');

    const comments = (entry.comments || [])
      .map((c) => `
        <div class="comment">
          <span><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.text)}</span>
          ${c.user_id === myUserId ? `<button type="button" class="comment-delete" data-comment="${c.comment_id}" title="Delete comment">×</button>` : ''}
        </div>
      `).join('');

    return `
      <article class="wall-card">
        <div class="wall-card-head">
          <span class="wall-name">${escapeHtml(entry.name)}</span>
          <span class="pill">${escapeHtml(entry.team_name)}</span>
          <span class="wall-points">+${entry.points_awarded}</span>
        </div>
        <div class="wall-activity">${escapeHtml(entry.activity_name)}</div>
        ${entry.note_or_link ? `<div class="wall-note">${escapeHtml(entry.note_or_link)}</div>` : ''}
        <div class="wall-reactions">
          ${reactionChips}
          <span class="quick-react-row">${quickButtons}</span>
        </div>
        <div class="wall-comments">${comments}</div>
        <form class="comment-form" data-log="${entry.log_id}">
          <input type="text" placeholder="Add a comment…" maxlength="500" />
          <button type="submit">Post</button>
        </form>
      </article>
    `;
  }).join('');

  panel.querySelectorAll('.quick-react').forEach((btn) => {
    btn.addEventListener('click', () => reactToEntry(btn.dataset.log, btn.dataset.emoji, btn));
  });
  panel.querySelectorAll('.comment-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteComment(btn.dataset.comment, btn));
  });
  panel.querySelectorAll('.comment-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const button = form.querySelector('button');
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      button.disabled = true;
      button.textContent = 'Posting…';
      addComment(form.dataset.log, text, form);
    });
  });
}

// Buttons disable immediately on click so the click always feels
// instant — Apps Script's round trip alone can take a second or two.
async function reactToEntry(logId, emoji, btn) {
  btn.disabled = true;
  const result = await Api.authedPost('react', { log_id: logId, emoji });
  if (!result.ok) {
    btn.disabled = false;
    return;
  }
  loadWall();
}

async function addComment(logId, text, form) {
  const result = await Api.authedPost('comment', { log_id: logId, text });
  if (!result.ok) {
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    input.disabled = false;
    button.disabled = false;
    button.textContent = 'Post';
    showFormError(form, result.error || 'Could not post comment.');
    return;
  }
  loadWall();
}

async function deleteComment(commentId, btn) {
  btn.disabled = true;
  const result = await Api.authedPost('deleteComment', { comment_id: commentId });
  if (!result.ok) {
    btn.disabled = false;
    return;
  }
  loadWall();
}

function showFormError(form, message) {
  let err = form.nextElementSibling;
  if (!err || !err.classList.contains('comment-error')) {
    err = document.createElement('p');
    err.className = 'result error comment-error';
    form.after(err);
  }
  err.textContent = message;
}

// ---- Leaderboard ----

async function loadLeaderboard(scope) {
  const panel = document.getElementById('panel-leaderboard');
  panel.innerHTML = `
    <div class="scope-toggle">
      <button class="scope-btn ${scope === 'individual' ? 'active' : ''}" data-scope="individual">Individual</button>
      <button class="scope-btn ${scope === 'team' ? 'active' : ''}" data-scope="team">Team</button>
    </div>
    <div id="leaderboard-rows">Loading…</div>
  `;
  panel.querySelectorAll('.scope-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadLeaderboard(btn.dataset.scope));
  });

  const result = await Api.get('leaderboard', { scope });
  if (!result.ok) return;

  const rowsEl = document.getElementById('leaderboard-rows');
  rowsEl.innerHTML = `
    <table class="lb-table">
      <thead><tr><th>#</th><th>${scope === 'team' ? 'Team' : 'Name'}</th><th></th><th class="num">Points</th></tr></thead>
      <tbody>
        ${result.rows.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(scope === 'team' ? r.team_name : r.name)}</td>
            <td class="muted">${escapeHtml(scope === 'team' ? r.job_function : r.team_name)}</td>
            <td class="num">${r.points}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ---- Submit activity ----

async function loadSubmitForm() {
  const panel = document.getElementById('panel-submit');
  if (!activitiesCache) {
    const result = await Api.get('activities');
    if (!result.ok) {
      panel.innerHTML = '<p class="empty">Could not load activities.</p>';
      return;
    }
    activitiesCache = result.activities;
  }

  const byCategory = {};
  activitiesCache.forEach((a) => {
    byCategory[a.category] = byCategory[a.category] || [];
    byCategory[a.category].push(a);
  });

  panel.innerHTML = `
    <form id="submit-form">
      <label>Activity
        <select id="submit-activity" required>
          <option value="">Choose an activity…</option>
          ${Object.entries(byCategory).map(([category, items]) => `
            <optgroup label="${escapeHtml(category)}">
              ${items.map((a) => `<option value="${a.activity_id}">${escapeHtml(a.activity_name)} (+${a.base_points})</option>`).join('')}
            </optgroup>
          `).join('')}
        </select>
      </label>
      <label>Date
        <input type="date" id="submit-date" value="${new Date().toISOString().slice(0, 10)}" required />
      </label>
      <label>Note <span id="submit-note-hint" class="muted">(optional)</span>
        <input type="text" id="submit-note" maxlength="300" />
      </label>
      <button type="submit">Log it</button>
      <p id="submit-result" class="result" hidden></p>
    </form>
  `;

  const select = document.getElementById('submit-activity');
  select.addEventListener('change', () => {
    const activity = activitiesCache.find((a) => a.activity_id === select.value);
    const hintEl = document.getElementById('submit-note-hint');
    hintEl.textContent = activity?.evidence_hint ? `— ${activity.evidence_hint}` : '(optional)';
  });

  document.getElementById('submit-form').addEventListener('submit', handleSubmitActivity);
}

async function handleSubmitActivity(e) {
  e.preventDefault();
  const activityId = document.getElementById('submit-activity').value;
  const date = document.getElementById('submit-date').value;
  const note = document.getElementById('submit-note').value;
  const resultEl = document.getElementById('submit-result');

  const result = await Api.authedPost('submitActivity', {
    activity_id: activityId,
    activity_date: date,
    note_or_link: note
  });

  resultEl.hidden = false;
  if (!result.ok) {
    resultEl.textContent = result.error;
    resultEl.className = 'result error';
    return;
  }

  resultEl.textContent = result.capped
    ? `Logged — but you've hit the weekly cap for this one, so it earned 0 points this time.`
    : `+${result.points_awarded} points for "${result.activity_name}"`;
  resultEl.className = result.capped ? 'result warn' : 'result success';
  e.target.reset();
}

// ---- Profile ----

async function loadProfile() {
  const panel = document.getElementById('panel-profile');
  const { user } = Session.get();
  const result = await Api.get('profile', { user_id: user.user_id });
  if (!result.ok) {
    panel.innerHTML = '<p class="empty">Could not load profile.</p>';
    return;
  }

  panel.innerHTML = `
    <div class="profile-head">
      <div class="profile-points">${result.total_points}</div>
      <div class="profile-meta">
        <div>${escapeHtml(result.user.name)}</div>
        <div class="muted">${escapeHtml(result.user.team_name)} · Rank #${result.rank}</div>
      </div>
    </div>
    <h3>Activity</h3>
    <div class="activity-log">
      ${result.activity_log.map((l) => `
        <div class="log-row">
          <span>${escapeHtml(l.activity_name)}</span>
          <span class="muted">${escapeHtml(l.activity_date)}</span>
          <span class="num ${l.capped ? 'muted' : ''}">${l.capped ? 'capped' : '+' + l.points_awarded}</span>
        </div>
      `).join('') || '<p class="empty">No activity logged yet.</p>'}
    </div>
  `;

  if (result.user.role === 'admin') {
    panel.insertAdjacentHTML('beforeend', renderAdminBackupSection());
    wireAdminBackupSection();
  }
}

// ---- Admin: export / import backup ----

function renderAdminBackupSection() {
  return `
    <h3>Admin — Backup</h3>
    <div class="admin-backup">
      <button id="admin-export-btn" type="button">Export to Excel</button>
      <div class="admin-import">
        <input type="file" id="admin-import-file" accept=".xlsx" />
        <button id="admin-import-btn" type="button">Restore from file</button>
      </div>
      <p id="admin-backup-result" class="result" hidden></p>
    </div>
  `;
}

function wireAdminBackupSection() {
  document.getElementById('admin-export-btn').addEventListener('click', handleAdminExport);
  document.getElementById('admin-import-btn').addEventListener('click', handleAdminImport);
}

function showAdminBackupResult(message, kind) {
  const resultEl = document.getElementById('admin-backup-result');
  resultEl.hidden = false;
  resultEl.textContent = message;
  resultEl.className = `result ${kind}`;
}

async function handleAdminExport() {
  const btn = document.getElementById('admin-export-btn');
  btn.disabled = true;
  btn.textContent = 'Exporting…';

  const result = await Api.authedPost('export', {});

  btn.disabled = false;
  btn.textContent = 'Export to Excel';

  if (!result.ok) {
    showAdminBackupResult(result.error, 'error');
    return;
  }
  downloadBase64File(result.file_base64, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  showAdminBackupResult(`Downloaded ${result.filename}`, 'success');
}

async function handleAdminImport() {
  const fileInput = document.getElementById('admin-import-file');
  const file = fileInput.files[0];
  if (!file) {
    showAdminBackupResult('Choose a .xlsx file first.', 'error');
    return;
  }
  const confirmed = confirm(
    'Restoring will overwrite any existing rows with matching IDs from this backup file. This cannot be undone. Continue?'
  );
  if (!confirmed) return;

  const btn = document.getElementById('admin-import-btn');
  btn.disabled = true;
  btn.textContent = 'Restoring…';

  const base64 = await fileToBase64(file);
  const result = await Api.authedPost('import', { file_base64: base64 });

  btn.disabled = false;
  btn.textContent = 'Restore from file';

  if (!result.ok) {
    showAdminBackupResult(result.error, 'error');
    return;
  }
  const summary = Object.entries(result.imported || {}).map(([table, count]) => `${table}: ${count}`).join(', ');
  showAdminBackupResult(`Restored — ${summary}`, 'success');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function downloadBase64File(base64, filename, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

init();
