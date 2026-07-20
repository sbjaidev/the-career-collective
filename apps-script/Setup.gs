// Run setupSheets() once from the Apps Script editor after creating the
// bound Google Sheet. It is idempotent — safe to re-run any time.

var SHEETS = {
  USERS: {
    name: 'Users',
    headers: ['user_id', 'name', 'username', 'pin', 'job_function', 'team_id', 'role', 'joined_date', 'active']
  },
  TEAMS: {
    name: 'Teams',
    headers: ['team_id', 'team_name', 'job_function', 'captain_user_id', 'mentor_user_ids', 'created_date']
  },
  ACTIVITIES_CONFIG: {
    name: 'Activities_Config',
    headers: ['activity_id', 'activity_name', 'category', 'base_points', 'weekly_cap_units', 'cap_window', 'evidence_hint', 'surface_on_wall', 'active']
  },
  ACTIVITY_LOG: {
    name: 'Activity_Log',
    headers: ['log_id', 'timestamp', 'user_id', 'activity_id', 'activity_date', 'points_awarded', 'note_or_link', 'week_number', 'capped']
  },
  WEEKLY_SNAPSHOTS: {
    name: 'Weekly_Snapshots',
    headers: ['week_number', 'week_start_date', 'entity_type', 'entity_id', 'points_this_week', 'cumulative_points', 'rank']
  },
  SEASON_CONFIG: {
    name: 'Season_Config',
    headers: ['key', 'value']
  },
  WALL_REACTIONS: {
    name: 'Wall_Reactions',
    headers: ['reaction_id', 'log_id', 'user_id', 'emoji', 'timestamp']
  },
  WALL_COMMENTS: {
    name: 'Wall_Comments',
    headers: ['comment_id', 'log_id', 'user_id', 'text', 'timestamp']
  }
};

// [activity_id, name, category, points, weekly_cap_units, cap_window, evidence_hint, surface_on_wall]
var SEED_ACTIVITIES = [
  ['APP', 'Applied to a job', 'Job Search Actions', 2, 10, 'week', '', false],
  ['REF', 'Referral message sent', 'Job Search Actions', 5, 5, 'week', 'optional note', true],
  ['REFC', 'Referral replied / warm intro secured', 'Job Search Actions', 10, 3, 'week', 'optional note', true],
  ['PS', 'Phone screen scheduled', 'Job Search Actions', 15, '', '', 'optional note', true],
  ['ON', 'Onsite / final round reached', 'Job Search Actions', 40, '', '', 'optional note', true],
  ['OFFER', 'Offer received', 'Job Search Actions', 200, '', '', 'optional note', true],
  ['LC', 'LeetCode / coding problem solved', 'Skill Building', 3, 5, 'week', '', false],
  ['RES', 'Resume or LinkedIn profile updated', 'Skill Building', 15, 1, 'month', '', true],
  ['MII', 'Completed a mock interview — as interviewee', 'Skill Building', 15, 2, 'week', '', true],
  ['MIR', 'Completed a mock interview — as interviewer', 'Skill Building', 10, 2, 'week', '', true],
  ['CRT', 'Course / certification module completed', 'Skill Building', 10, 2, 'week', '', true],
  ['LIP', 'Wrote a LinkedIn post about the search', 'Community & Content', 10, 2, 'week', 'paste a link', true],
  ['HLP', 'Helped a teammate (feedback, intro, advice)', 'Community & Content', 5, 3, 'week', '', true],
  ['EVT', 'Attended a BKB CPL event / webinar', 'Community & Content', 10, '', '', '', true]
];

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEETS).forEach(function (key) {
    var spec = SHEETS[key];
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) {
      sheet = ss.insertSheet(spec.name);
    }
    var firstRow = sheet.getRange(1, 1, 1, spec.headers.length).getValues()[0];
    var hasHeaders = firstRow.join('') !== '';
    if (!hasHeaders) {
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
      sheet.setFrozenRows(1);
    }
  });

  // Drop the default "Sheet1" if it's still empty and unused.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  seedActivitiesConfig();
  seedSeasonConfig();
  ensureSessionSecret();

  Logger.log('Setup complete.');
}

function seedActivitiesConfig() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ACTIVITIES_CONFIG.name);
  if (sheet.getLastRow() > 1) return; // already seeded

  var rows = SEED_ACTIVITIES.map(function (a) {
    return [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], true];
  });
  sheet.getRange(2, 1, rows.length, SHEETS.ACTIVITIES_CONFIG.headers.length).setValues(rows);
}

function seedSeasonConfig() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEASON_CONFIG.name);
  if (sheet.getLastRow() > 1) return; // already seeded

  var today = new Date();
  var eightWeeksOut = new Date(today.getTime() + 56 * 24 * 60 * 60 * 1000);
  var rows = [
    ['season_start_date', Utilities.formatDate(today, 'Asia/Kolkata', 'yyyy-MM-dd')],
    ['season_end_date', Utilities.formatDate(eightWeeksOut, 'Asia/Kolkata', 'yyyy-MM-dd')],
    ['current_week', 1],
    ['timezone', 'Asia/Kolkata']
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  // Placeholder dates — edit season_start_date / season_end_date directly
  // in this tab once real dates are locked in.
}

function ensureSessionSecret() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
}
