-- Upgrade for an EXISTING database (fresh installs get all of this from
-- schema.sql already). Idempotent — safe to run more than once.
--
-- Why this exists: the API caps every query at 1,000 rows by default, and
-- the leaderboard/profile/trends/goals handlers used to read the whole
-- activity_log into memory to add it up. Past 1,000 log rows (about a week
-- at 50 active users) totals silently went wrong. These views do the
-- adding-up inside Postgres instead, so the app only ever fetches one row
-- per user (or per user per week).

-- security_invoker: the view runs with the *caller's* permissions, so the
-- RLS on activity_log still applies — anon/authenticated can't read through it.
create or replace view user_points with (security_invoker = true) as
  select user_id,
         coalesce(sum(points_awarded), 0)::int as points,
         count(*)::int                         as entries
  from activity_log
  group by user_id;

create or replace view user_week_points with (security_invoker = true) as
  select user_id, week_number, coalesce(sum(points_awarded), 0)::int as points
  from activity_log
  group by user_id, week_number;

create or replace view user_activity_counts with (security_invoker = true) as
  select user_id, activity_id, count(*)::int as n
  from activity_log
  group by user_id, activity_id;

revoke all on user_points, user_week_points, user_activity_counts from anon, authenticated;
grant select on user_points, user_week_points, user_activity_counts to service_role;

-- Indexes. Postgres doesn't index foreign keys automatically, and deleting
-- an activity_log row cascades to its reactions/comments — without these
-- indexes every delete scans both tables.
create index if not exists activity_log_created_idx       on activity_log (created_at desc);
create index if not exists activity_log_user_activity_idx on activity_log (user_id, activity_id);
create index if not exists wall_reactions_log_idx         on wall_reactions (log_id);
create index if not exists wall_comments_log_idx          on wall_comments (log_id);

-- Failed-login log, used to lock a username out after too many wrong PINs
-- (a 4-digit PIN is only 10,000 guesses). Failures only; cleared on success.
create table if not exists login_attempts (
  id            bigint generated always as identity primary key,
  username      text not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists login_attempts_lookup_idx on login_attempts (username, attempted_at);
alter table login_attempts enable row level security;
