function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name + ' — run setupSheets() first.');
  return sheet;
}

// Reads a sheet into an array of plain objects keyed by its header row.
function sheetToObjects(name) {
  var sheet = getSheet(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function appendObjectRow(name, obj) {
  var sheet = getSheet(name);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorOutput(message) {
  return jsonOutput({ ok: false, error: message });
}

function successOutput(data) {
  return jsonOutput(Object.assign({ ok: true }, data));
}

function newId(prefix) {
  return prefix + '_' + Utilities.getUuid().slice(0, 8);
}

function toDateOnly(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Kolkata', 'yyyy-MM-dd');
}

// Week 1 starts on season_start_date; each week is 7 days.
function computeWeekNumber(activityDateStr, seasonStartDateStr) {
  var start = new Date(seasonStartDateStr);
  var activity = new Date(activityDateStr);
  var days = Math.floor((activity - start) / (24 * 60 * 60 * 1000));
  if (days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

// Returns the cap "bucket" a log row falls into, given the activity's
// cap_window ('week' or 'month'). Weekly caps bucket by week_number;
// monthly caps bucket by calendar month so e.g. a resume update on the
// 1st and one on the 29th of the same month share a bucket.
function capPeriodKey(activityDateStr, weekNumber, capWindow) {
  if (capWindow === 'month') {
    return Utilities.formatDate(new Date(activityDateStr), 'Asia/Kolkata', 'yyyy-MM');
  }
  return String(weekNumber);
}

function getSeasonConfig() {
  var rows = sheetToObjects(SHEETS.SEASON_CONFIG.name);
  var config = {};
  rows.forEach(function (r) { config[r.key] = r.value; });
  return config;
}
