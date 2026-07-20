var EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})+$/u;

function handleWall(params) {
  var limit = params.limit ? Number(params.limit) : 50;

  var config = sheetToObjects(SHEETS.ACTIVITIES_CONFIG.name);
  var configById = {};
  config.forEach(function (a) { configById[a.activity_id] = a; });

  var users = sheetToObjects(SHEETS.USERS.name);
  var usersById = {};
  users.forEach(function (u) { usersById[u.user_id] = u; });

  var teams = sheetToObjects(SHEETS.TEAMS.name);
  var teamsById = {};
  teams.forEach(function (t) { teamsById[t.team_id] = t; });

  var reactions = sheetToObjects(SHEETS.WALL_REACTIONS.name);
  var comments = sheetToObjects(SHEETS.WALL_COMMENTS.name);

  var log = sheetToObjects(SHEETS.ACTIVITY_LOG.name)
    .filter(function (l) {
      var cfg = configById[l.activity_id];
      return cfg && cfg.surface_on_wall && Number(l.points_awarded) > 0;
    })
    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })
    .slice(0, limit);

  var entries = log.map(function (l) {
    var cfg = configById[l.activity_id];
    var user = usersById[l.user_id];
    var team = user ? teamsById[user.team_id] : null;

    var myReactions = reactions.filter(function (r) { return r.log_id === l.log_id; });
    var reactionCounts = {};
    myReactions.forEach(function (r) { reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1; });

    var myComments = comments.filter(function (c) { return c.log_id === l.log_id; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); })
      .map(function (c) {
        var author = usersById[c.user_id];
        return { comment_id: c.comment_id, user_id: c.user_id, name: author ? author.name : c.user_id, text: c.text, timestamp: c.timestamp };
      });

    return {
      log_id: l.log_id,
      timestamp: l.timestamp,
      user_id: l.user_id,
      name: user ? user.name : 'Unknown',
      team_name: team ? team.team_name : '',
      activity_name: cfg.activity_name,
      points_awarded: l.points_awarded,
      note_or_link: l.note_or_link,
      reactions: reactionCounts,
      comments: myComments
    };
  });

  return successOutput({ entries: entries });
}

function handleReact(params) {
  var userId = requireAuth(params);
  var logId = params.log_id;
  var emoji = String(params.emoji || '').trim();
  if (!emoji || !EMOJI_REGEX.test(emoji)) return errorOutput('Reaction must be an emoji.');

  var sheet = getSheet(SHEETS.WALL_REACTIONS.name);
  var reactions = sheetToObjects(SHEETS.WALL_REACTIONS.name);
  var existingIndex = reactions.findIndex(function (r) {
    return r.log_id === logId && r.user_id === userId && r.emoji === emoji;
  });

  if (existingIndex >= 0) {
    // Toggle off: +2 because row 1 is headers and index is 0-based.
    sheet.deleteRow(existingIndex + 2);
    return successOutput({ toggled: 'off' });
  }

  appendObjectRow(SHEETS.WALL_REACTIONS.name, {
    reaction_id: newId('RXN'),
    log_id: logId,
    user_id: userId,
    emoji: emoji,
    timestamp: new Date()
  });
  return successOutput({ toggled: 'on' });
}

function handleComment(params) {
  var userId = requireAuth(params);
  var logId = params.log_id;
  var text = String(params.text || '').trim();
  if (!text) return errorOutput('Comment cannot be empty.');
  if (text.length > 500) return errorOutput('Comment is too long.');

  appendObjectRow(SHEETS.WALL_COMMENTS.name, {
    comment_id: newId('CMT'),
    log_id: logId,
    user_id: userId,
    text: text,
    timestamp: new Date()
  });
  return successOutput({});
}

function handleDeleteComment(params) {
  var userId = requireAuth(params);
  var commentId = params.comment_id;

  var sheet = getSheet(SHEETS.WALL_COMMENTS.name);
  var comments = sheetToObjects(SHEETS.WALL_COMMENTS.name);
  var index = comments.findIndex(function (c) { return c.comment_id === commentId; });
  if (index < 0) return errorOutput('Comment not found.');
  if (comments[index].user_id !== userId) return errorOutput('You can only delete your own comments.');

  sheet.deleteRow(index + 2); // +2: row 1 is headers, index is 0-based
  return successOutput({});
}
