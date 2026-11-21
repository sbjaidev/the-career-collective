-- Career Premier League — Postgres schema
--
-- Every table has Row Level Security enabled with NO policies for the
-- anon/authenticated roles — the only way in is the Edge Function, which
-- connects with the service_role key server-side. The frontend never
-- talks to Postgres directly, so a PIN or a raw table can never leak
-- through a misconfigured RLS policy. This mirrors the "single API
-- surface" shape the Apps Script backend already used.
--
-- captain_user_id / mentor_user_ids are kept as plain informational text
-- (same convention as the Sheets version, which never enforced them
-- either) rather than a foreign key back to users — teams and users would
-- otherwise need a circular reference for no real benefit.

create table teams (
  team_id          text primary key,
  team_name        text not null,
  job_function     text,
  captain_user_id  text,
  mentor_user_ids  text,
  created_date     date not null default current_date
);

create table users (
  user_id          text primary key,
  name             text not null,
  username         text not null unique,
  pin              text not null,
  job_function     text,
  team_id          text references teams(team_id),
  role             text not null default 'participant',
  -- Profile fields — all optional, editable only by the user themselves,
  -- visible to any logged-in viewer (peer-support app, not a public site).
  email            text,
  phone            text,
  linkedin_url     text,
  interested_role  text,
  joined_date  date not null default current_date,
  active       boolean not null default true
);

create table activities_config (
  activity_id       text primary key,
  activity_name     text not null,
  category          text,
  base_points       integer not null,
  weekly_cap_units  integer,        -- null = uncapped
  cap_window        text,           -- 'week' | 'month' | null
  evidence_hint     text,
  surface_on_wall   boolean not null default true,
  active            boolean not null default true,
  -- Comma-separated job_function codes this activity applies to (e.g.
  -- 'software_engineer,qa'). Blank/null = applies to everyone. Only
  -- affects which activities show up as goal-setting candidates — it
  -- doesn't restrict who can log the activity itself.
  job_functions     text
);

create table activity_log (
  log_id          text primary key default ('LOG_' || substr(gen_random_uuid()::text, 1, 8)),
  created_at      timestamptz not null default now(),
  user_id         text not null references users(user_id),
  activity_id     text not null references activities_config(activity_id),
  activity_date   date not null,
  points_awarded  integer not null,
  note_or_link    text,
  week_number     integer,
  capped          boolean not null default false
);
create index activity_log_user_idx on activity_log(user_id);
create index activity_log_activity_idx on activity_log(activity_id);

create table wall_reactions (
  reaction_id  text primary key default ('RXN_' || substr(gen_random_uuid()::text, 1, 8)),
  log_id       text not null references activity_log(log_id) on delete cascade,
  user_id      text not null references users(user_id),
  emoji        text not null,
  created_at   timestamptz not null default now(),
  unique (log_id, user_id, emoji)
);

create table wall_comments (
  comment_id  text primary key default ('CMT_' || substr(gen_random_uuid()::text, 1, 8)),
  log_id      text not null references activity_log(log_id) on delete cascade,
  user_id     text not null references users(user_id),
  text        text not null,
  created_at  timestamptz not null default now()
);

create table season_config (
  key    text primary key,
  value  text
);

-- One row per (user, activity) they're tracking as a goal. target_count
-- of 1 displays as a checkbox in the UI; anything higher displays as a
-- progress bar. Progress itself isn't stored here — it's counted live
-- from activity_log, same as everything else in this schema.
create table user_goals (
  user_id       text not null references users(user_id) on delete cascade,
  activity_id   text not null references activities_config(activity_id) on delete cascade,
  target_count  integer not null default 1,
  primary key (user_id, activity_id)
);

alter table teams             enable row level security;
alter table users             enable row level security;
alter table activities_config enable row level security;
alter table activity_log      enable row level security;
alter table wall_reactions    enable row level security;
alter table wall_comments     enable row level security;
alter table season_config     enable row level security;
alter table user_goals        enable row level security;
-- No policies are created — default-deny for anon/authenticated. The Edge
-- Function connects with the service_role key, which bypasses RLS entirely.

-- ---------------------------------------------------------------------
-- Scale + login lockout (mirrors supabase/upgrades/2026-11-scale-and-login-lockout.sql,
-- which is what to run against a database that already existed before this).
-- ---------------------------------------------------------------------

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
