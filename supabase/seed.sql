-- Run once, right after schema.sql. Safe to re-run — every insert is
-- ON CONFLICT DO NOTHING, matching setupSheets()'s "won't clobber existing
-- data" behavior.

insert into activities_config (activity_id, activity_name, category, base_points, weekly_cap_units, cap_window, evidence_hint, surface_on_wall) values
  ('APP',   'Applied to a job',                             'Job Search Actions',  2,   10, 'week',  '',                    false),
  ('REF',   'Referral message sent',                        'Job Search Actions',  5,   5,  'week',  'optional note',       true),
  ('REFC',  'Referral replied / warm intro secured',        'Job Search Actions',  10,  3,  'week',  'optional note',       true),
  ('PS',    'Phone screen scheduled',                       'Job Search Actions',  15,  null, null,  'optional note',       true),
  ('ON',    'Onsite / final round reached',                 'Job Search Actions',  40,  null, null,  'optional note',       true),
  ('OFFER', 'Offer received',                                'Job Search Actions',  200, null, null,  'optional note',       true),
  ('LC',    'LeetCode / coding problem solved',              'Skill Building',      3,   5,  'week',  '',                    false),
  ('RES',   'Resume or LinkedIn profile updated',            'Skill Building',      15,  1,  'month', '',                    true),
  ('MII',   'Completed a mock interview — as interviewee',   'Skill Building',      15,  2,  'week',  '',                    true),
  ('MIR',   'Completed a mock interview — as interviewer',   'Skill Building',      10,  2,  'week',  '',                    true),
  ('CRT',   'Course / certification module completed',       'Skill Building',      10,  2,  'week',  '',                    true),
  ('LIP',   'Wrote a LinkedIn post about the search',         'Community & Content', 10,  2,  'week',  'paste a link',        true),
  ('HLP',   'Helped a teammate (feedback, intro, advice)',    'Community & Content', 5,   3,  'week',  '',                    true),
  ('EVT',   'Attended a BKB CPL event / webinar',             'Community & Content', 10,  null, null,  '',                    true)
on conflict (activity_id) do nothing;

insert into season_config (key, value) values
  ('season_start_date', to_char(current_date, 'YYYY-MM-DD')),
  ('season_end_date',   to_char(current_date + interval '56 days', 'YYYY-MM-DD')),
  ('current_week', '1'),
  ('timezone', 'Asia/Kolkata')
on conflict (key) do nothing;
