-- BKB Career Premier League — Postgres schema
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
  user_id      text primary key,
  name         text not null,
  username     text not null unique,
  pin          text not null,
  job_function text,
  team_id      text references teams(team_id),
  role         text not null default 'participant',
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
  active            boolean not null default true
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

alter table teams             enable row level security;
alter table users             enable row level security;
alter table activities_config enable row level security;
alter table activity_log      enable row level security;
alter table wall_reactions    enable row level security;
alter table wall_comments     enable row level security;
alter table season_config     enable row level security;
-- No policies are created — default-deny for anon/authenticated. The Edge
-- Function connects with the service_role key, which bypasses RLS entirely.
