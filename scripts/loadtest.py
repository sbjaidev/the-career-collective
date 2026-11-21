#!/usr/bin/env python3
"""Load/latency test for the api Edge Function.

Run it from anywhere; it reads the URL + anon key from frontend/js/config.js.
Uses the sample users from supabase/seed.sql — change LOGINS if you've replaced them.

Usage:
  loadtest.py latency [--region us-east-1]
  loadtest.py load --users 50 --rounds 6
Reads URL + anon key from frontend/js/config.js. Read-only actions only
(wall, leaderboard, profile, getGoals) plus login, so it never writes data.
"""
import argparse, json, re, statistics, sys, threading, time, urllib.request, urllib.error

import os
CONFIG = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "js", "config.js")).read()
URL = re.search(r"https://[a-z0-9]+\.supabase\.co/functions/v1/api", CONFIG).group(0)
ANON = re.search(r"eyJ[A-Za-z0-9._-]+", CONFIG).group(0)

LOGINS = [("asha", "1111"), ("ravi", "2222"), ("meera", "3333"), ("karan", "4444"),
          ("priya", "5555"), ("vikram", "6666"), ("sneha", "7777"), ("arjun", "8888")]


def call(body, region=None):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {ANON}", "apikey": ANON}
    if region:
        headers["x-region"] = region
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:  # timeouts, resets
        return None, (time.perf_counter() - t0) * 1000, f"EXC {type(e).__name__}", 0
    ms = (time.perf_counter() - t0) * 1000
    try:
        data = json.loads(raw)
    except Exception:
        data = None
    return data, ms, status, len(raw)


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]


def login_token(region):
    data, _, _, _ = call({"action": "login", "username": LOGINS[0][0], "pin": LOGINS[0][1]}, region)
    return (data or {}).get("token")


def latency(region):
    print(f"region header: {region or '(none)'}")
    token = login_token(region)
    for name, body in [
        ("activities", {"action": "activities"}),
        ("wall", {"action": "wall", "limit": 50}),
        ("leaderboard", {"action": "leaderboard", "scope": "individual"}),
        ("profile", {"action": "profile", "user_id": "U003"}),
        ("getGoals", {"action": "getGoals", "user_id": "U003"}),
    ]:
        body = {**body, "token": token}  # reads need a login now
        call(body, region)  # warm
        samples = []
        sizes = 0
        for _ in range(8):
            data, ms, status, size = call(body, region)
            samples.append(ms)
            sizes = size
        print(f"  {name:12s} p50={statistics.median(samples):6.0f}ms  max={max(samples):6.0f}ms  payload={sizes/1024:5.1f}KB")


def load(users, rounds, region):
    results = {}  # action -> list of ms
    errors = []
    lock = threading.Lock()

    def record(name, data, ms, status):
        with lock:
            results.setdefault(name, []).append(ms)
            if status != 200 or data is None or data.get("ok") is False:
                errors.append((name, status, (data or {}).get("error")))

    def worker(i):
        username, pin = LOGINS[i % len(LOGINS)]
        data, ms, status, _ = call({"action": "login", "username": username, "pin": pin}, region)
        record("login", data, ms, status)
        uid = (data or {}).get("user", {}).get("user_id", "U003")
        token = (data or {}).get("token")
        for _ in range(rounds):
            for name, body in [
                ("wall", {"action": "wall", "limit": 50}),
                ("leaderboard", {"action": "leaderboard", "scope": "individual"}),
                ("profile", {"action": "profile", "user_id": uid}),
                ("getGoals", {"action": "getGoals", "user_id": uid}),
            ]:
                d, m, s, _ = call({**body, "token": token}, region)
                record(name, d, m, s)
                time.sleep(0.2)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(users)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0
    total = sum(len(v) for v in results.values())
    print(f"{users} concurrent users, {rounds} rounds each: {total} requests in {wall:.1f}s ({total/wall:.1f} req/s), errors={len(errors)}")
    for name, vals in results.items():
        print(f"  {name:12s} n={len(vals):4d}  p50={statistics.median(vals):6.0f}ms  p95={pct(vals, .95):6.0f}ms  max={max(vals):6.0f}ms")
    if errors:
        from collections import Counter
        print("  error breakdown:", Counter(errors).most_common(5))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["latency", "load"])
    ap.add_argument("--region")
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--rounds", type=int, default=6)
    a = ap.parse_args()
    latency(a.region) if a.mode == "latency" else load(a.users, a.rounds, a.region)
