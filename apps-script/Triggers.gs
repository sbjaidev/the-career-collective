// Optional: run installWeeklyTrigger() once if you want historical
// rank snapshots archived in Weekly_Snapshots. Nothing else in the app
// depends on this — the live leaderboard and trends work without it.
function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'snapshotWeek') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotWeek').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
}

function snapshotWeek() {
  var season = getSeasonConfig();
  var currentWeek = Number(season.current_week || 1);

  ['individual', 'team'].forEach(function (scope) {
    var result = JSON.parse(handleLeaderboard({ scope: scope }).getContent());
    var sheet = getSheet(SHEETS.WEEKLY_SNAPSHOTS.name);
    result.rows.forEach(function (row, i) {
      sheet.appendRow([
        currentWeek,
        toDateOnly(new Date()),
        scope,
        scope === 'team' ? row.team_id : row.user_id,
        '', // points_this_week — left blank; cumulative_points is the reliable figure
        row.points,
        i + 1
      ]);
    });
  });

  var configSheet = getSheet(SHEETS.SEASON_CONFIG.name);
  var rows = configSheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'current_week') {
      configSheet.getRange(i + 1, 2).setValue(currentWeek + 1);
      break;
    }
  }
}
