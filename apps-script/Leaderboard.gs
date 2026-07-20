function handleLeaderboard(params) {
  var scope = params.scope === 'team' ? 'team' : 'individual';
  var log = sheetToObjects(SHEETS.ACTIVITY_LOG.name);
  var users = sheetToObjects(SHEETS.USERS.name);
  var teams = sheetToObjects(SHEETS.TEAMS.name);

  var pointsByUser = {};
  log.forEach(function (l) {
    pointsByUser[l.user_id] = (pointsByUser[l.user_id] || 0) + Number(l.points_awarded || 0);
  });

  if (scope === 'individual') {
    var rows = users.filter(function (u) { return u.active; }).map(function (u) {
      var team = teams.filter(function (t) { return t.team_id === u.team_id; })[0];
      return {
        user_id: u.user_id,
        name: u.name,
        team_name: team ? team.team_name : '',
        job_function: u.job_function,
        points: pointsByUser[u.user_id] || 0
      };
    });
    rows.sort(function (a, b) { return b.points - a.points; });
    return successOutput({ scope: scope, rows: rows });
  }

  var pointsByTeam = {};
  users.forEach(function (u) {
    if (!u.active) return;
    pointsByTeam[u.team_id] = (pointsByTeam[u.team_id] || 0) + (pointsByUser[u.user_id] || 0);
  });
  var teamRows = teams.map(function (t) {
    return {
      team_id: t.team_id,
      team_name: t.team_name,
      job_function: t.job_function,
      points: pointsByTeam[t.team_id] || 0
    };
  });
  teamRows.sort(function (a, b) { return b.points - a.points; });
  return successOutput({ scope: scope, rows: teamRows });
}

function handleProfile(params) {
  var userId = params.user_id;
  var users = sheetToObjects(SHEETS.USERS.name);
  var user = users.filter(function (u) { return u.user_id === userId; })[0];
  if (!user) return errorOutput('User not found.');

  var teams = sheetToObjects(SHEETS.TEAMS.name);
  var team = teams.filter(function (t) { return t.team_id === user.team_id; })[0];

  var activitiesConfig = sheetToObjects(SHEETS.ACTIVITIES_CONFIG.name);
  var configById = {};
  activitiesConfig.forEach(function (a) { configById[a.activity_id] = a; });

  var log = sheetToObjects(SHEETS.ACTIVITY_LOG.name);
  var myLog = log.filter(function (l) { return l.user_id === userId; })
    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })
    .map(function (l) {
      var cfg = configById[l.activity_id];
      return {
        log_id: l.log_id,
        activity_name: cfg ? cfg.activity_name : l.activity_id,
        activity_date: l.activity_date,
        points_awarded: l.points_awarded,
        capped: l.capped,
        note_or_link: l.note_or_link
      };
    });

  var totalPoints = myLog.reduce(function (sum, l) { return sum + Number(l.points_awarded || 0); }, 0);

  var pointsByUser = {};
  log.forEach(function (l) {
    pointsByUser[l.user_id] = (pointsByUser[l.user_id] || 0) + Number(l.points_awarded || 0);
  });
  var ranked = users.filter(function (u) { return u.active; })
    .map(function (u) { return { user_id: u.user_id, points: pointsByUser[u.user_id] || 0 }; })
    .sort(function (a, b) { return b.points - a.points; });
  var rank = ranked.findIndex(function (r) { return r.user_id === userId; }) + 1;

  return successOutput({
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      team_name: team ? team.team_name : '',
      role: user.role
    },
    total_points: totalPoints,
    rank: rank,
    activity_log: myLog
  });
}

// Computed live from Activity_Log rather than Weekly_Snapshots — at this
// scale (dozens of people, two months) re-aggregating on request is
// cheap, and it keeps trends from ever going stale. Weekly_Snapshots is
// still written by snapshotWeek() for historical rank archival, but the
// trend chart itself doesn't depend on it.
function handleTrends(params) {
  var scope = params.scope === 'team' ? 'team' : 'individual';
  var log = sheetToObjects(SHEETS.ACTIVITY_LOG.name);
  var users = sheetToObjects(SHEETS.USERS.name);
  var teams = sheetToObjects(SHEETS.TEAMS.name);

  var userTeam = {};
  users.forEach(function (u) { userTeam[u.user_id] = u.team_id; });

  var byWeek = {}; // week -> entityId -> points

  log.forEach(function (l) {
    var week = l.week_number;
    var entityId = scope === 'team' ? userTeam[l.user_id] : l.user_id;
    if (!entityId) return;
    byWeek[week] = byWeek[week] || {};
    byWeek[week][entityId] = (byWeek[week][entityId] || 0) + Number(l.points_awarded || 0);
  });

  var nameById = {};
  if (scope === 'team') {
    teams.forEach(function (t) { nameById[t.team_id] = t.team_name; });
  } else {
    users.forEach(function (u) { nameById[u.user_id] = u.name; });
  }

  var weeks = Object.keys(byWeek).map(Number).sort(function (a, b) { return a - b; });
  var series = weeks.map(function (week) {
    var entities = Object.keys(byWeek[week]).map(function (id) {
      return { entity_id: id, name: nameById[id] || id, points_this_week: byWeek[week][id] };
    });
    return { week: week, entities: entities };
  });

  return successOutput({ scope: scope, series: series });
}
