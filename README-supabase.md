# BKB Career Premier League — Supabase backend

This replaces the Google Sheets + Apps Script backend with Supabase
(Postgres + Edge Functions), while keeping the same frontend shape. The
Apps Script version still exists in `apps-script/` and `README.md` if you
ever want to reference it — this is a clean cutover, not a hybrid.

```
supabase/
  schema.sql              run once in the SQL Editor
  seed.sql                run once, right after schema.sql
  config.toml             merge into what `supabase init` generates
  functions/
    api/                  the one function the frontend talks to
    daily-backup/         scheduled — exports everything to Storage
    _shared/               cors, db client, auth tokens, xlsx helpers
```

## 1. Create the project

[supabase.com](https://supabase.com) → New project. Free tier, no card
required. Note the **Project Reference ID** (Project Settings → General) —
you'll need it in step 3.

## 2. Run the schema

Dashboard → **SQL Editor** → paste in `supabase/schema.sql` → Run. Then do
the same with `supabase/seed.sql`. Both are safe to re-run later.

## 3. Install the CLI and link the project

```bash
brew install supabase/tap/supabase
supabase login
```

Then from this project's root:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

## 4. Set the session secret

```bash
supabase secrets set SESSION_SECRET=$(openssl rand -hex 32)
```

This is what signs login tokens — equivalent to the auto-generated secret
`setupSheets()` created for the Apps Script version.

## 5. Deploy the Edge Functions

```bash
supabase functions deploy api
supabase functions deploy daily-backup
```

`supabase/config.toml` marks `daily-backup` as not requiring a JWT (it's
called by a scheduled job with no auth header, not by the frontend). If
your CLI version doesn't pick that up from the config file, deploy it
explicitly instead: `supabase functions deploy daily-backup --no-verify-jwt`.

After deploying `api`, note the URL it prints —
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/api`.

## 6. Create the backups storage bucket

Dashboard → **Storage** → New bucket → name it `backups` → keep it
**private** (not public). This is where the daily automated backup lands.

## 7. Schedule the daily backup

Dashboard → **Integrations → Cron Jobs** (some dashboard versions list
this under Database → Cron Jobs) → New cron job:
- Type: Edge Function
- Function: `daily-backup`
- Schedule: e.g. `0 3 * * *` (3am UTC daily)

This writes `bkb-cpl-backup-YYYY-MM-DD.xlsx` into the `backups` bucket
every day and prunes anything older than 14 days.

## 8. Configure the frontend

Open `frontend/js/config.js` and fill in:
- `SUPABASE_FUNCTION_URL` — from step 5
- `SUPABASE_ANON_KEY` — Project Settings → API → "anon public" key

## 9. Add people

Same manual process as before, just in Supabase's **Table Editor** instead
of a Google Sheet — it's a similar grid interface. Add rows to `teams`
first, then `users` (so `team_id` foreign keys resolve). Format-wise:
`pin` is a text column already, so leading zeros are preserved without
needing to fix column formatting the way Sheets required.

Since only test/dummy data exists in the current Sheets version — no real
participants have been onboarded yet — there's nothing to migrate. Add
your own row directly, or reuse the same fake test rows from before by
pasting them into the Table Editor the same way you pasted them into
Sheets.

## 10. Deploy the frontend

Unchanged — Netlify still just publishes the `frontend/` folder per
`netlify.toml`.

## The export/import backup feature

- **Export** (My Profile tab, admin role only): downloads a `.xlsx` with
  one sheet per table — the same thing the daily cron job produces, just
  on demand.
- **Import**: restores from that file. It upserts by each table's primary
  key in dependency order (teams → users → activities → activity log →
  reactions/comments), so restoring a whole backup works in one pass. It's
  built to restore a file this app produced — not to accept an arbitrary
  hand-built spreadsheet — and it asks for confirmation before running,
  since it can overwrite live rows with matching IDs.

## Tuning after launch

Same as before: edit rows in `activities_config` directly (points, caps,
`surface_on_wall`) — the app reads it live, no redeploy needed. Redeploying
is only required when the Edge Function *code* changes:
`supabase functions deploy api`.
