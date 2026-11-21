#!/usr/bin/env python3
"""Generate demo data for BKB CPL: a believable mid-season snapshot.

    python3 scripts/generate_demo_seed.py            # "today" = real today
    python3 scripts/generate_demo_seed.py --today 2026-11-21 --seed 7

Writes (all git-ignored, because they contain login PINs):
    supabase/demo_seed.sql      load it:    paste into the Supabase SQL Editor and Run
    supabase/demo_unseed.sql    remove it:  paste into the SQL Editor and Run
    supabase/demo_logins.txt    who can log in, and their PINs

What you get: 4 teams, 28 fictional people (IDs D001-D028, teams DT1-DT4),
season day 26 of 56 (week 4 of 8), ~1,300 activity entries obeying the real
weekly/monthly caps, a lively Wall (reactions, comments, a couple of offers),
profiles with optional contact details, and per-person goals.

Safe to re-run: loading first deletes any earlier demo rows. It leaves other
rows alone, with two exceptions: season_config (so the dates line up with the
demo; unseed does not restore it) and the sample users from seed.sql, which are
set inactive so they don't crowd the leaderboard (unseed reactivates them;
pass --keep-test-users to skip that).
Everything is fictional. PINs are random on every generation.
"""
import argparse, datetime as dt, math, os, random, secrets
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "supabase")

TEAMS = [
    ("DT1", "Stack Strikers",  "software_engineer"),
    ("DT2", "Roadmap Rovers",  "product_manager"),
    ("DT3", "Test Titans",     "qa"),
    ("DT4", "Sprint Spurs",    "program_manager"),
]
# (name, interested_role) — first person of each team is captain, second is mentor.
PEOPLE = {
    "DT1": [("Maya Iyer", "Senior Backend Engineer"), ("Omar Haddad", "Staff Engineer"), ("Hannah Cho", "Full-stack Engineer"),
            ("Diego Ramirez", "Platform / Infrastructure"), ("Priyanka Nair", "Mobile Engineer (iOS)"), ("Ethan Brooks", ""),
            ("Lena Fischer", "ML Engineer")],
    "DT2": [("Sofia Alvarez", "Group Product Manager"), ("Marcus Johnson", "Director of Product"), ("Kevin Tran", "Product Manager, Growth"),
            ("Nadia Rahman", "Technical Product Manager"), ("Ananya Rao", ""), ("Tyler Nguyen", "Product Manager, Fintech"),
            ("Chloe Martin", "Product Manager, Health")],
    "DT3": [("Jamal Wright", "SDET Lead"), ("Grace Kim", "QA Manager"), ("Elena Petrova", "Test Automation Engineer"),
            ("Sanjay Patel", ""), ("Luis Ortega", "Performance Test Engineer"), ("Fatima Khan", "QA Engineer, Mobile"),
            ("Noah Williams", "")],
    "DT4": [("Isabel Costa", "Senior Program Manager"), ("Victor Santos", "Head of Delivery"), ("Daniel Okafor", "Technical Program Manager"),
            ("Mei Lin", "Program Manager, Infrastructure"), ("Aisha Bello", ""), ("Greg Hoffman", "TPM, Cloud"),
            ("Tanvi Shah", "Program Manager, Hardware")],
}
CAP = {  # activity_id: (base_points, cap_units, window)
    "APP": (2, 10, "week"), "REF": (5, 5, "week"), "REFC": (10, 3, "week"), "PS": (15, None, None),
    "ON": (40, None, None), "OFFER": (200, None, None), "LC": (3, 5, "week"), "RES": (15, 1, "month"),
    "MII": (15, 2, "week"), "MIR": (10, 2, "week"), "CRT": (10, 2, "week"), "LIP": (10, 2, "week"),
    "HLP": (5, 3, "week"), "EVT": (10, None, None),
}
SURFACED = {"REF", "REFC", "PS", "ON", "OFFER", "RES", "MII", "MIR", "CRT", "LIP", "HLP", "EVT"}  # = surface_on_wall in seed.sql
# Expected entries per week for a fully engaged person.
RATE = {"APP": 7.0, "LC": 3.0, "REF": 2.5, "REFC": 0.6, "PS": 0.3, "ON": 0.07, "RES": 0.12,
        "MII": 0.55, "MIR": 0.5, "CRT": 0.7, "LIP": 0.3, "HLP": 1.2}
EVENTS = [("Kickoff call", 3), ("Resume teardown workshop", 3), ("Hiring-manager Q&A panel", 3), ("Mock interview night", 3)]  # Thursdays of weeks 1-4

NOTES = {
    "REF": ["Messaged a former teammate now at a Series B startup", "Reached out to a hiring manager I met at a meetup", "Asked my old manager for an intro",
            "DM'd an alum from my university working at the target team", "Cold-emailed a recruiter with a tailored note", "Followed up on a warm intro from last week"],
    "REFC": ["Got a reply and a 20-minute chat is booked!", "Intro to the hiring manager secured", "Former colleague is submitting an internal referral",
             "Alum replied with great advice and a referral offer"],
    "PS": ["Recruiter call booked for Tuesday", "Phone screen with a mid-size fintech", "Scheduled a screen with a health-tech company", "Screen lined up for Thursday morning"],
    "ON": ["Final round next week - 5 interviews back to back", "Onsite loop scheduled!", "Made it to the final panel round"],
    "OFFER": ["I got the offer!! Thank you all for the mock interviews", "Offer in hand after 11 weeks of searching"],
    "RES": ["Rewrote the summary and quantified every bullet", "Refreshed LinkedIn headline + About section", "Resume teardown feedback applied"],
    "MII": ["Mock system design with a teammate - lots to improve", "Behavioral mock, got feedback on my STAR stories", "Practiced the product-sense round",
            "Mock interview, finally felt calm"],
    "MIR": ["Interviewed a teammate, gave detailed feedback", "Ran a behavioral mock for a friend", "Mock case interview, took notes for them"],
    "CRT": ["Finished the SQL for analytics module", "Completed a system design course unit", "AWS cloud practitioner module done", "Agile program management module complete",
            "Test automation with Playwright - unit 3"],
    "LIP": ["Posted: what 40 applications taught me", "Posted about my mock interview lessons", "Posted a thank-you to my study group", "Posted my project write-up"],
    "HLP": ["Reviewed a teammate's resume", "Introduced two people from the group", "Shared a referral contact", "Gave feedback on a take-home", "Practiced intro pitch with a teammate"],
}
COMMENTS = {
    "OFFER": ["INCREDIBLE!! You earned every bit of this", "So so happy for you!!", "Legend. Drinks are on us", "Proof that the process works. Congrats!!"],
    "ON": ["Go get it!", "You've got this, rooting for you", "Happy to run one more mock before the final round", "Huge. Keep going!"],
    "PS": ["Nice, let us know how it goes!", "Great news", "Let me know if you want to practice"],
    "ANY": ["Love this", "Nice one!", "Keep it up!", "This is the way", "Great momentum", "Thanks for sharing - inspiring",
            "Same here, let's compare notes", "Well done", "Helpful, thank you!", "Proud of you"],
}
EMOJI = ["🔥", "💪", "🎉", "👏", "🚀"]
REACT_RANGE = {"OFFER": (11, 17), "ON": (7, 11), "PS": (4, 8), "REFC": (3, 6), "RES": (2, 5), "LIP": (2, 6)}

# Hand-written headline moments so the Wall looks great at the top (days_ago, minutes into the day PT, person-name, activity, note)
HEADLINES = [
    (0, 9 * 60 + 12, "Hannah Cho", "OFFER", "I got the offer!! Thank you all for the mock interviews and the push when it got hard"),
    (0, 8 * 60 + 5, "Kevin Tran", "ON", "Final round next week - 5 interviews back to back. Taking all mock interview offers!"),
    (1, 17 * 60 + 40, "Elena Petrova", "PS", "Recruiter call booked for Tuesday - SDET role at a health-tech company"),
    (1, 15 * 60 + 5, "Omar Haddad", "MIR", "Ran 3 system-design mocks this week. Proud of this group's progress"),
    (1, 12 * 60 + 30, "Isabel Costa", "LIP", "Posted: what 40 applications taught me about my own resume"),
    (2, 19 * 60 + 15, "Sofia Alvarez", "REFC", "Warm intro to the hiring manager secured, thanks to a teammate here"),
]


def poisson(rng, lam):
    if lam <= 0:
        return 0
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def ts(day, minutes):
    return dt.datetime.combine(day, dt.time(minutes // 60, minutes % 60), tzinfo=PT).isoformat(sep=" ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--keep-test-users", action="store_true",
                    help="leave the sample users from supabase/seed.sql (asha, ravi, ...) active; by default they're hidden "
                         "from leaderboards for the demo and re-activated by demo_unseed.sql")
    args = ap.parse_args()
    today = dt.date.fromisoformat(args.today)
    rng = random.Random(args.seed)

    # Season: the Monday on or before (today - 25 days), so today lands in week 4.
    start = today - dt.timedelta(days=25)
    start -= dt.timedelta(days=start.weekday())
    end = start + dt.timedelta(days=56)
    cur_week = (today - start).days // 7 + 1

    users, user_by_name = [], {}
    for ti, (tid, tname, jf) in enumerate(TEAMS):
        for i, (name, role_int) in enumerate(PEOPLE[tid]):
            uid = f"D{len(users) + 1:03d}"
            first, last = name.split()
            handle = first.lower()
            u = dict(uid=uid, name=name, username=handle, pin=f"{secrets.randbelow(10000):04d}", jf=jf, tid=tid,
                     role="captain" if i == 0 else "mentor" if i == 1 else "participant", interested=role_int,
                     # engagement: spread so the leaderboard has real drama
                     eng=round(rng.choice([1.35, 1.2, 1.1, 1.0, 0.9, 0.8, 0.65, 0.5, 0.35]), 2),
                     joined=start)
            # Optional contact details: some share everything, some a bit, some nothing.
            roll = rng.random()
            u["email"] = f"{handle}.{last.lower()}@example.com" if roll < 0.55 else None
            u["phone"] = f"(415) 555-{rng.randint(100, 199):04d}" if roll < 0.3 else None
            u["linkedin"] = f"https://www.linkedin.com/in/demo-{handle}-{last.lower()}" if roll < 0.45 else None
            users.append(u)
            user_by_name[name] = u
    assert len({u["username"] for u in users}) == len(users), "username clash"
    # The headline people should be highly engaged so their stories are plausible.
    for n in ("Hannah Cho", "Kevin Tran", "Elena Petrova", "Omar Haddad", "Isabel Costa", "Sofia Alvarez"):
        user_by_name[n]["eng"] = max(user_by_name[n]["eng"], 1.1)

    # ---- activity entries -------------------------------------------------
    raw = []  # dicts: uid, act, date, minute, note
    thursdays = [start + dt.timedelta(days=3 + 7 * w) for w in range(8)]
    for u in users:
        # a quiet week or two for some people
        slump = {rng.randint(1, cur_week)} if rng.random() < 0.4 else set()
        for d in range((today - start).days + 1):
            day = start + dt.timedelta(days=d)
            week = d // 7 + 1
            wk_factor = (0.6 if week in slump else 1.0) * (0.8 + 0.1 * week)  # momentum builds over the season
            day_factor = 0.45 if day.weekday() >= 5 else 1.0
            for act, per_week in RATE.items():
                if act == "LC" and u["jf"] != "software_engineer":
                    continue
                lam = per_week / 7 * u["eng"] * wk_factor * day_factor * (7 / 5.45)
                for _ in range(poisson(rng, lam)):
                    raw.append(dict(uid=u["uid"], act=act, date=day, minute=rng.randint(7 * 60 + 30, 22 * 60)))
        for (label, _), th in zip(EVENTS, thursdays):
            if th <= today and rng.random() < 0.45 + 0.4 * min(u["eng"], 1.2) / 1.2:
                raw.append(dict(uid=u["uid"], act="EVT", date=th, minute=18 * 60 + 30 + rng.randint(0, 20), note=label))
    # Storylines: a couple of Phone screen -> Onsite chains beyond the headline entries, and the big win.
    for name, acts in {"Hannah Cho": ["PS", "ON", "ON"], "Kevin Tran": ["PS", "PS"], "Jamal Wright": ["ON"], "Daniel Okafor": ["PS", "ON"],
                       "Lena Fischer": ["PS"], "Marcus Johnson": ["PS"]}.items():
        for act in acts:
            raw.append(dict(uid=user_by_name[name]["uid"], act=act, date=today - dt.timedelta(days=rng.randint(3, 18)),
                            minute=rng.randint(9 * 60, 20 * 60)))
    for day_ago, minute, name, act, note in HEADLINES:
        raw.append(dict(uid=user_by_name[name]["uid"], act=act, date=today - dt.timedelta(days=day_ago), minute=minute, note=note, headline=True))
    # Nothing in the future, and today's headline moments are the newest things on the Wall.
    now_pt = dt.datetime.now(PT)
    limit = max(now_pt.hour * 60 + now_pt.minute - 20, 8 * 60) if today == now_pt.date() else 23 * 60
    todays_headlines = sorted([r for r in raw if r.get("headline") and r["date"] == today], key=lambda r: -r["minute"])
    for i, r in enumerate(todays_headlines):
        r["minute"] = limit - 5 - 35 * i
    for r in raw:
        if r["date"] == today and not r.get("headline"):
            r["minute"] = max(min(r["minute"], limit - 60), 6 * 60)
    raw.sort(key=lambda r: (r["date"], r["minute"]))

    def week_of(day):
        return max((day - start).days // 7 + 1, 1)

    # Apply the real cap rules in date order (the cap counts every entry in the window, capped or not).
    seen = {}
    log = []
    for i, r in enumerate(raw):
        base, cap, window = CAP[r["act"]]
        key = (r["uid"], r["act"], week_of(r["date"]) if window == "week" else (r["date"].year, r["date"].month) if window == "month" else None)
        n = seen.get(key, 0)
        capped = cap is not None and n >= cap
        seen[key] = n + 1
        note = r.get("note") or (rng.choice(NOTES[r["act"]]) if r["act"] in NOTES and rng.random() < (0.85 if r["act"] in SURFACED else 0.0) else "")
        log.append(dict(r, log_id=f"LOG_d{i + 1:05d}", points=0 if capped else base, capped=capped, note=note, week=week_of(r["date"])))

    # ---- reactions & comments on wall-visible entries -----------------------------
    uids = [u["uid"] for u in users]
    reactions, comments = [], []
    for e in log:
        if e["act"] not in SURFACED or e["points"] <= 0:
            continue
        lo, hi = REACT_RANGE.get(e["act"], (0, 4))
        n = rng.randint(lo, hi)
        if e.get("headline"):
            n = max(n, 8)
        reactors = rng.sample([x for x in uids if x != e["uid"]], min(n, len(uids) - 1))
        base_minute = e["minute"]
        for ru in reactors:
            when = dt.datetime.combine(e["date"], dt.time(base_minute // 60, base_minute % 60), tzinfo=PT) + dt.timedelta(minutes=rng.randint(3, 600))
            reactions.append(dict(log_id=e["log_id"], uid=ru, emoji=rng.choice(EMOJI if e["act"] not in ("OFFER", "ON") else ["🎉", "🔥", "🚀", "👏"]), at=min(when, now_pt)))
        k = 0
        if e["act"] == "OFFER":
            k = 5
        elif e["act"] in ("ON", "PS") or e.get("headline"):
            k = rng.randint(2, 3)
        elif rng.random() < 0.25:
            k = 1
        for ru in rng.sample([x for x in uids if x != e["uid"]], k):
            pool = COMMENTS[e["act"]] if e["act"] in ("OFFER", "ON") else COMMENTS.get(e["act"], []) + COMMENTS["ANY"]
            when = dt.datetime.combine(e["date"], dt.time(base_minute // 60, base_minute % 60), tzinfo=PT) + dt.timedelta(minutes=rng.randint(10, 800))
            comments.append(dict(log_id=e["log_id"], uid=ru, text=rng.choice(pool), at=min(when, now_pt)))

    # ---- goals --------------------------------------------------------------------
    goal_pool = {"APP": [20, 30, 40], "REF": [8, 10, 15], "REFC": [3, 4], "MII": [3, 4, 6], "MIR": [3, 4], "CRT": [4, 6], "LIP": [2, 3],
                 "HLP": [6, 8], "EVT": [3, 4], "RES": [1], "OFFER": [1], "ON": [1, 2], "PS": [2, 3]}
    goals = []
    for u in users:
        cands = [a for a in goal_pool] + (["LC"] if u["jf"] == "software_engineer" else [])
        pool = dict(goal_pool, LC=[15, 20, 30])
        picked = ["APP", "OFFER"] + rng.sample([a for a in cands if a not in ("APP", "OFFER")], rng.randint(2, 4))
        for a in picked:
            goals.append((u["uid"], a, rng.choice(pool[a])))

    # ---- write SQL ----------------------------------------------------------------
    def batch(table, cols, rows, chunk=250):
        out = []
        for i in range(0, len(rows), chunk):
            part = rows[i:i + chunk]
            out.append(f"insert into {table} ({', '.join(cols)}) values\n  " + ",\n  ".join(part) + ";")
        return "\n".join(out)

    sql = [
        "-- DEMO DATA (generated by scripts/generate_demo_seed.py) — fictional people, random PINs.",
        "-- Safe to re-run: it deletes earlier demo rows first and never touches non-demo rows.",
        "-- Remove it later with supabase/demo_unseed.sql.",
        "begin;",
        UNSEED,
        HIDE_TEST if not args.keep_test_users else "-- (kept existing test users visible: --keep-test-users)",
        f"insert into season_config (key, value) values ('season_start_date', '{start}'), ('season_end_date', '{end}'), ('current_week', '{cur_week}')\n"
        "  on conflict (key) do update set value = excluded.value;",
        batch("teams", ["team_id", "team_name", "job_function", "captain_user_id", "created_date"],
              [f"({q(t)}, {q(n)}, {q(j)}, {q([u['uid'] for u in users if u['tid'] == t][0])}, {q(start)})" for t, n, j in TEAMS]),
        batch("users", ["user_id", "name", "username", "pin", "job_function", "team_id", "role", "email", "phone", "linkedin_url", "interested_role", "joined_date", "active"],
              [f"({q(u['uid'])}, {q(u['name'])}, {q(u['username'])}, {q(u['pin'])}, {q(u['jf'])}, {q(u['tid'])}, {q(u['role'])}, {q(u['email'])}, {q(u['phone'])}, "
               f"{q(u['linkedin'])}, {q(u['interested'] or None)}, {q(start)}, true)" for u in users]),
        batch("user_goals", ["user_id", "activity_id", "target_count"], [f"({q(a)}, {q(b)}, {c})" for a, b, c in goals]),
        batch("activity_log", ["log_id", "created_at", "user_id", "activity_id", "activity_date", "points_awarded", "note_or_link", "week_number", "capped"],
              [f"({q(e['log_id'])}, {q(ts(e['date'], e['minute']))}, {q(e['uid'])}, {q(e['act'])}, {q(e['date'])}, {e['points']}, {q(e['note'])}, {e['week']}, {str(e['capped']).lower()})" for e in log]),
        batch("wall_reactions", ["reaction_id", "log_id", "user_id", "emoji", "created_at"],
              [f"({q('RXN_d%05d' % i)}, {q(r['log_id'])}, {q(r['uid'])}, {q(r['emoji'])}, {q(r['at'].isoformat(sep=' '))})" for i, r in enumerate(reactions, 1)]),
        batch("wall_comments", ["comment_id", "log_id", "user_id", "text", "created_at"],
              [f"({q('CMT_d%05d' % i)}, {q(c['log_id'])}, {q(c['uid'])}, {q(c['text'])}, {q(c['at'].isoformat(sep=' '))})" for i, c in enumerate(comments, 1)]),
        "commit;",
    ]
    # A user can't react twice with the same emoji on the same entry (unique constraint) — de-dupe above by sampling distinct users,
    # so every (log, user) pair is unique already.

    os.makedirs(ROOT, exist_ok=True)
    with open(os.path.join(ROOT, "demo_seed.sql"), "w") as f:
        f.write("\n".join(sql) + "\n")
    with open(os.path.join(ROOT, "demo_unseed.sql"), "w") as f:
        f.write("-- Removes everything demo_seed.sql added (people D001-D028, teams DT1-DT4, their entries, reactions, comments, goals).\n"
                "-- Does not restore season_config — set your real season dates after.\nbegin;\n" + UNSEED + "\n" + SHOW_TEST + "\ncommit;\n")
    with open(os.path.join(ROOT, "demo_logins.txt"), "w") as f:
        f.write("username  PIN   name (team, role)\n")
        for u in users:
            f.write(f"{u['username']:<9} {u['pin']}  {u['name']} ({dict((t, n) for t, n, _ in TEAMS)[u['tid']]}, {u['role']})\n")

    # ---- summary ------------------------------------------------------------------
    pts = {}
    for e in log:
        pts[e["uid"]] = pts.get(e["uid"], 0) + e["points"]
    name_of = {u["uid"]: u["name"] for u in users}
    print(f"season {start} .. {end}; today is week {cur_week}")
    print(f"{len(users)} people, {len(log)} entries ({sum(e['capped'] for e in log)} capped), {len(reactions)} reactions, {len(comments)} comments, {len(goals)} goals")
    wall = [e for e in log if e["act"] in SURFACED and e["points"] > 0]
    print(f"wall-visible entries: {len(wall)}")
    print("top 6:", ", ".join(f"{name_of[k]} {v}" for k, v in sorted(pts.items(), key=lambda kv: -kv[1])[:6]))
    team_pts = {}
    for u in users:
        team_pts[u["tid"]] = team_pts.get(u["tid"], 0) + pts.get(u["uid"], 0)
    print("teams:", ", ".join(f"{n} {team_pts[t]}" for t, n, _ in TEAMS))
    print("wrote supabase/demo_seed.sql, demo_unseed.sql, demo_logins.txt")


# The sample accounts from seed.sql (U002...) would crowd the demo leaderboard; deactivating them hides them
# (login is blocked too) and demo_unseed.sql turns them back on. The admin account is left alone.
HIDE_TEST = "update users set active = false where user_id !~ '^D[0-9]{3}$' and role <> 'admin';"
SHOW_TEST = "update users set active = true where user_id !~ '^D[0-9]{3}$' and role <> 'admin';"

UNSEED = """delete from wall_reactions where user_id ~ '^D[0-9]{3}$' or log_id in (select log_id from activity_log where user_id ~ '^D[0-9]{3}$');
delete from wall_comments  where user_id ~ '^D[0-9]{3}$' or log_id in (select log_id from activity_log where user_id ~ '^D[0-9]{3}$');
delete from activity_log   where user_id ~ '^D[0-9]{3}$';
delete from user_goals     where user_id ~ '^D[0-9]{3}$';
delete from users          where user_id ~ '^D[0-9]{3}$';
delete from teams          where team_id ~ '^DT[0-9]$';"""

if __name__ == "__main__":
    main()
