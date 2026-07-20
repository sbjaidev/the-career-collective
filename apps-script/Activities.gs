function handleSubmitActivity(params) {
  var userId = requireAuth(params);
  var activityId = params.activity_id;
  var activityDate = params.activity_date ? toDateOnly(params.activity_date) : toDateOnly(new Date());
  var note = String(params.note_or_link || '').trim();

  var config = sheetToObjects(SHEETS.ACTIVITIES_CONFIG.name)
    .filter(function (a) { return a.activity_id === activityId && a.active; })[0];
  if (!config) return errorOutput('Unknown or inactive activity.');

  var season = getSeasonConfig();
  var weekNumber = computeWeekNumber(activityDate, season.season_start_date);
  var periodKey = capPeriodKey(activityDate, weekNumber, config.cap_window);

  var capped = false;
  var pointsAwarded = Number(config.base_points);

  if (config.weekly_cap_units !== '' && config.weekly_cap_units !== null && config.weekly_cap_units !== undefined) {
    var log = sheetToObjects(SHEETS.ACTIVITY_LOG.name);
    var priorCount = log.filter(function (l) {
      if (l.user_id !== userId || l.activity_id !== activityId) return false;
      var lPeriod = capPeriodKey(l.activity_date, l.week_number, config.cap_window);
      return lPeriod === periodKey;
    }).length;

    if (priorCount >= Number(config.weekly_cap_units)) {
      capped = true;
      pointsAwarded = 0;
    }
  }

  var logId = newId('LOG');
  appendObjectRow(SHEETS.ACTIVITY_LOG.name, {
    log_id: logId,
    timestamp: new Date(),
    user_id: userId,
    activity_id: activityId,
    activity_date: activityDate,
    points_awarded: pointsAwarded,
    note_or_link: note,
    week_number: weekNumber,
    capped: capped
  });

  return successOutput({
    log_id: logId,
    points_awarded: pointsAwarded,
    capped: capped,
    activity_name: config.activity_name
  });
}
