// GET routes: read-only, no sensitive data in query params.
function doGet(e) {
  var params = e.parameter;
  try {
    switch (params.action) {
      case 'leaderboard': return handleLeaderboard(params);
      case 'profile': return handleProfile(params);
      case 'trends': return handleTrends(params);
      case 'wall': return handleWall(params);
      case 'activities': return handleActivitiesList();
      default: return errorOutput('Unknown action: ' + params.action);
    }
  } catch (err) {
    return handleError(err);
  }
}

// POST routes: mutations, or anything with sensitive fields (PIN).
// The frontend sends Content-Type: text/plain so the browser treats
// this as a "simple request" and skips the CORS preflight — Apps
// Script web apps don't implement doOptions, so a real preflight
// would just fail. See frontend/js/api.js.
function doPost(e) {
  var params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorOutput('Invalid request body.');
  }

  try {
    switch (params.action) {
      case 'login': return handleLogin(params);
      case 'submitActivity': return handleSubmitActivity(params);
      case 'react': return handleReact(params);
      case 'comment': return handleComment(params);
      case 'deleteComment': return handleDeleteComment(params);
      default: return errorOutput('Unknown action: ' + params.action);
    }
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err) {
  if (err.message === 'AUTH') return errorOutput('Please log in again.');
  Logger.log(err);
  return errorOutput('Something went wrong: ' + err.message);
}
