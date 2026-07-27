let wallPollTimer = null;
let activitiesCache = null;
let hiddenAt = null;
let viewingUserId = null; // null = viewing your own profile

const SESSION_TIMEOUT_MS = 30 * 24 * 3600 * 1000; // 30 days, same as the World Cup app

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Shared by the Wall and by Profile — deletable by the entry's own author,
// or by an admin (of anyone's entry); the server enforces this too, this
// is just what decides whether the control renders at all.
function canDeleteEntry(entryUserId) {
  const me = Session.get()?.user;
  return me && (entryUserId === me.user_id || me.role === 'admin');
}

async function deleteActivityEntry(logId, btn, onSuccess) {
  const confirmed = confirm('Delete this entry? This also removes its points and cannot be undone.');
  if (!confirmed) return;
  btn.disabled = true;
  const result = await Api.authedPost('deleteActivity', { log_id: logId });
  if (!result.ok) {
    btn.disabled = false;
    alert(result.error || 'Could not delete entry.');
    return;
  }
  onSuccess();
}

function getActivePanel() {
  return document.querySelector('.tab-btn.active')?.dataset.panel;
}

function applyBranding() {
  document.title = APP_NAME;
  document.getElementById('login-title').textContent = APP_NAME;
  document.getElementById('topbar-brand').textContent = APP_SHORT_NAME;
}

function init() {
  applyBranding();
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.panel === 'profile') viewingUserId = null;
      switchPanel(btn.dataset.panel);
    });
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

// Called by clicking a name on the Wall or Leaderboard — jumps to that
// person's profile regardless of which tab is currently open.
function openProfile(userId) {
  viewingUserId = userId;
  switchPanel('profile');
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
          <button type="button" class="wall-name" data-user="${entry.user_id}">${escapeHtml(entry.name)}</button>
          <span class="pill">${escapeHtml(entry.team_name)}</span>
          <span class="wall-points">+${entry.points_awarded}</span>
        </div>
        <div class="wall-activity">${escapeHtml(entry.activity_name)}</div>
        ${entry.note_or_link ? `<div class="wall-note">${escapeHtml(entry.note_or_link)}</div>` : ''}
        <div class="wall-card-foot">
          <span class="wall-timestamp muted">${formatTimestamp(entry.timestamp)}</span>
          ${canDeleteEntry(entry.user_id) ? `<button type="button" class="wall-delete" data-log="${entry.log_id}">Delete</button>` : ''}
        </div>
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

  panel.querySelectorAll('.wall-name').forEach((btn) => {
    btn.addEventListener('click', () => openProfile(btn.dataset.user));
  });
  panel.querySelectorAll('.quick-react').forEach((btn) => {
    btn.addEventListener('click', () => reactToEntry(btn.dataset.log, btn.dataset.emoji, btn));
  });
  panel.querySelectorAll('.comment-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteComment(btn.dataset.comment, btn));
  });
  panel.querySelectorAll('.wall-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteActivityEntry(btn.dataset.log, btn, loadWall));
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
            <td>${scope === 'team'
              ? escapeHtml(r.team_name)
              : `<button type="button" class="lb-name-link" data-user="${r.user_id}">${escapeHtml(r.name)}</button>`}</td>
            <td class="muted">${escapeHtml(scope === 'team' ? r.job_function : r.team_name)}</td>
            <td class="num">${r.points}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  rowsEl.querySelectorAll('.lb-name-link').forEach((btn) => {
    btn.addEventListener('click', () => openProfile(btn.dataset.user));
  });
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
  const me = Session.get().user;
  const targetUserId = viewingUserId || me.user_id;
  const isOwnProfile = targetUserId === me.user_id;
  const canDeleteTheirEntries = isOwnProfile || me.role === 'admin';

  const result = await Api.get('profile', { user_id: targetUserId });
  if (!result.ok) {
    panel.innerHTML = '<p class="empty">Could not load profile.</p>';
    return;
  }
  const u = result.user;

  const details = [
    u.interested_role ? ['Interested in', escapeHtml(u.interested_role)] : null,
    u.email ? ['Email', `<a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a>`] : null,
    u.phone ? ['Phone', escapeHtml(u.phone)] : null,
    u.linkedin_url ? ['LinkedIn', `<a href="${escapeHtml(u.linkedin_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.linkedin_url)}</a>`] : null,
  ].filter(Boolean);

  const showAdmin = isOwnProfile && me.role === 'admin';
  const toc = [
    details.length ? ['profile-section-details', 'Details'] : null,
    ['profile-section-activities', 'Activities'],
    isOwnProfile ? ['profile-section-edit', 'Edit Details'] : null,
    showAdmin ? ['profile-section-admin', 'Admin'] : null,
  ].filter(Boolean);

  panel.innerHTML = `
    <div class="profile-head" id="profile-top">
      <div class="profile-points">${result.total_points}</div>
      <div class="profile-meta">
        <div>${escapeHtml(u.name)}</div>
        <div class="muted">${escapeHtml(u.team_name || u.job_function || '')} · Rank #${result.rank}</div>
      </div>
    </div>

    <nav class="profile-toc">
      ${toc.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}
    </nav>

    ${details.length ? `
      <section id="profile-section-details" class="profile-details">
        ${details.map(([label, value]) => `<div><span class="muted">${label}</span><span>${value}</span></div>`).join('')}
      </section>
    ` : ''}

    <section id="profile-section-activities">
      <h3>${isOwnProfile ? 'Your recent activity' : 'Recent activity'}</h3>
      <div class="activity-log">
        ${result.activity_log.map((l) => `
          <div class="log-row">
            <span>${escapeHtml(l.activity_name)}</span>
            <span class="muted">${formatTimestamp(l.timestamp)}</span>
            <span class="num ${l.capped ? 'muted' : ''}">${l.capped ? 'capped' : '+' + l.points_awarded}</span>
            ${canDeleteTheirEntries ? `<button type="button" class="log-delete" data-log="${l.log_id}">Delete</button>` : ''}
          </div>
        `).join('') || '<p class="empty">No activity logged yet.</p>'}
      </div>
    </section>

    ${isOwnProfile ? renderProfileEditForm(u) : ''}
    ${showAdmin ? renderAdminBackupSection() : ''}

    <a href="#profile-top" class="back-to-top">↑ Back to top</a>
  `;

  panel.querySelectorAll('.log-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteActivityEntry(btn.dataset.log, btn, loadProfile));
  });

  if (isOwnProfile) {
    wireProfileEditForm();
    if (showAdmin) wireAdminBackupSection();
  }
}

function renderProfileEditForm(u) {
  return `
    <section id="profile-section-edit">
      <h3>Edit your details</h3>
      <form id="profile-edit-form" class="profile-edit-form">
        <label>Name
          <input type="text" id="edit-name" value="${escapeHtml(u.name)}" required />
        </label>
        <label>Role you're interested in <span class="muted">(optional)</span>
          <input type="text" id="edit-interested-role" value="${escapeHtml(u.interested_role || '')}" placeholder="e.g. Senior Product Manager" />
        </label>
        <label>Email <span class="muted">(optional)</span>
          <input type="email" id="edit-email" value="${escapeHtml(u.email || '')}" />
        </label>
        <label>Phone <span class="muted">(optional)</span>
          <input type="tel" id="edit-phone" value="${escapeHtml(u.phone || '')}" />
        </label>
        <label>LinkedIn <span class="muted">(optional)</span>
          <input type="url" id="edit-linkedin" value="${escapeHtml(u.linkedin_url || '')}" placeholder="https://linkedin.com/in/…" />
        </label>
        <button type="submit">Save</button>
        <p id="profile-edit-result" class="result" hidden></p>
      </form>
    </section>
  `;
}

function wireProfileEditForm() {
  document.getElementById('profile-edit-form').addEventListener('submit', handleProfileEditSubmit);
}

async function handleProfileEditSubmit(e) {
  e.preventDefault();
  const button = e.target.querySelector('button');
  const resultEl = document.getElementById('profile-edit-result');
  button.disabled = true;
  button.textContent = 'Saving…';

  const result = await Api.authedPost('updateProfile', {
    name: document.getElementById('edit-name').value,
    interested_role: document.getElementById('edit-interested-role').value,
    email: document.getElementById('edit-email').value,
    phone: document.getElementById('edit-phone').value,
    linkedin_url: document.getElementById('edit-linkedin').value,
  });

  button.disabled = false;
  button.textContent = 'Save';
  resultEl.hidden = false;

  if (!result.ok) {
    resultEl.textContent = result.error;
    resultEl.className = 'result error';
    return;
  }
  resultEl.textContent = 'Saved.';
  resultEl.className = 'result success';
  setTimeout(loadProfile, 700);
}

// ---- Admin: export / import backup ----

function renderAdminBackupSection() {
  return `
    <section id="profile-section-admin">
      <h3>Admin — Backup</h3>
      <div class="admin-backup">
        <button id="admin-export-btn" type="button">Export to Excel</button>
        <div class="admin-import">
          <input type="file" id="admin-import-file" accept=".xlsx" />
          <button id="admin-import-btn" type="button">Restore from file</button>
        </div>
        <p id="admin-backup-result" class="result" hidden></p>
      </div>
    </section>
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
