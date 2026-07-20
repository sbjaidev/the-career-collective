function handleLogin(params) {
  var username = String(params.username || '').trim().toLowerCase();
  var pin = String(params.pin || '').trim();
  if (!username || !pin) return errorOutput('Username and PIN are required.');

  var users = sheetToObjects(SHEETS.USERS.name);
  var user = users.filter(function (u) {
    return String(u.username).trim().toLowerCase() === username && String(u.pin).trim() === pin && u.active;
  })[0];

  if (!user) return errorOutput('Username or PIN not recognized.');

  var teams = sheetToObjects(SHEETS.TEAMS.name);
  var team = teams.filter(function (t) { return t.team_id === user.team_id; })[0];

  return successOutput({
    token: makeToken(user.user_id),
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      role: user.role,
      team_id: user.team_id,
      team_name: team ? team.team_name : ''
    }
  });
}

// Stateless session token: base64url(payload).base64url(hmac(payload)).
// No Sessions tab to grow or expire — verified fresh on every request.
function makeToken(userId) {
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  var payload = JSON.stringify({ uid: userId, iat: Date.now() });
  var payloadB64 = Utilities.base64EncodeWebSafe(payload);
  var sig = Utilities.computeHmacSha256Signature(payloadB64, secret);
  return payloadB64 + '.' + Utilities.base64EncodeWebSafe(sig);
}

function verifyToken(token) {
  if (!token) return null;
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  var expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret));
  if (expectedSig !== parts[1]) return null;
  try {
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    return payload.uid;
  } catch (e) {
    return null;
  }
}

function requireAuth(params) {
  var uid = verifyToken(params.token);
  if (!uid) throw new Error('AUTH');
  return uid;
}
