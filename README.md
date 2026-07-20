# BKB Career Premier League

Google Sheet backend (via Apps Script) + static frontend (for Netlify). No build step, no npm dependencies.

```
apps-script/   Apps Script source — paste into the Sheet's script editor
frontend/      Static site — deploy this folder to Netlify
netlify.toml   Tells Netlify to publish frontend/
```

## 1. Create the Google Sheet

Create a new, blank Google Sheet. This becomes your database — nothing else to provision.

## 2. Add the Apps Script backend

In the Sheet: **Extensions → Apps Script**. Delete the default `Code.gs` content, then create one script file per file in `apps-script/` (same names) and paste in the matching content: `Code.gs`, `Setup.gs`, `Utils.gs`, `Auth.gs`, `Activities.gs`, `Leaderboard.gs`, `Wall.gs`, `Config.gs`, `Triggers.gs`.

Optional: in **Project Settings**, check "Show `appsscript.json` manifest file" and replace its contents with `apps-script/appsscript.json`. Not required — the same settings can be set by hand in the Deploy dialog in step 4.

## 3. Run setup once

In the script editor, select the `setupSheets` function from the dropdown next to Run, then click **Run**. Google will ask you to authorize the script — approve it (it's your own script, acting on your own Sheet).

This creates all 8 tabs with headers, seeds `Activities_Config` with the 14 activities and their points/caps, seeds `Season_Config` with placeholder dates, and generates a session secret. Re-running it later is safe — it won't overwrite existing data.

**Before the real season starts**, open `Season_Config` and set the real `season_start_date` and `season_end_date`.

## 4. Deploy the web app

**Deploy → New deployment → Select type: Web app.**
- Execute as: **Me**
- Who has access: **Anyone**

Deploy, then copy the Web app URL (looks like `https://script.google.com/macros/s/AKfycb.../exec`).

Every time you *edit* the Apps Script code later, you need a **new deployment version** (Deploy → Manage deployments → Edit → New version) for changes to go live — saving the file alone isn't enough.

## 5. Point the frontend at it

Open `frontend/js/config.js` and paste the Web app URL into `API_BASE_URL`.

## 6. Try it locally

```
python3 -m http.server 8811 --directory frontend
```

Open `http://localhost:8811`. You won't be able to log in until there's at least one row in `Users` (see below).

## 7. Add people

Onboarding is manual and one-time — add rows directly in `Users` and `Teams` while you form squads, then text each person their `username`, `pin`, and team name. `pin` should be typed as 4 digits; format the column as plain text first so Sheets doesn't drop leading zeros.

**For a stakeholder demo before real onboarding**, add a few dummy rows to `Users`/`Teams` and some rows to `Activity_Log` to populate the Wall and leaderboard, then delete them once you're ready to onboard for real.

## 8. Deploy to Netlify

Connect the repo (Netlify will read `netlify.toml` and publish `frontend/` automatically), or drag-and-drop the `frontend/` folder in the Netlify dashboard for a one-off deploy.

## Tuning after launch

- **Points and caps**: edit rows in `Activities_Config` directly — no redeploy needed, the app reads it live.
- **What shows on the Wall**: toggle `surface_on_wall` per activity in `Activities_Config`.
- **Historical rank snapshots** (optional): run `installWeeklyTrigger()` once from the script editor if you want `Weekly_Snapshots` populated week over week. The live leaderboard and trends work fine without it.
