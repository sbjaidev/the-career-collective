function handleActivitiesList() {
  var rows = sheetToObjects(SHEETS.ACTIVITIES_CONFIG.name)
    .filter(function (a) { return a.active; })
    .map(function (a) {
      return {
        activity_id: a.activity_id,
        activity_name: a.activity_name,
        category: a.category,
        base_points: a.base_points,
        evidence_hint: a.evidence_hint
      };
    });
  return successOutput({ activities: rows });
}
