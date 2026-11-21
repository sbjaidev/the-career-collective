import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { makeToken, requireAuth, requireReadAuth } from "../_shared/auth.ts";
import { fetchAll } from "../_shared/data.ts";
import {
  backupFilename,
  buildWorkbook,
  normalizeRowForTable,
  primaryKeyFor,
  readWorkbookFromBase64,
  TABLES_IN_IMPORT_ORDER,
  workbookToBase64,
} from "../_shared/xlsx.ts";
import * as XLSX from "npm:xlsx@0.18.5";

const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})+$/u;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Params = Record<string, any>;
// deno-lint-ignore no-explicit-any
type QueryResult = { data: any; error: { message: string } | null };

// Unwraps a supabase-js result, turning a query error into a thrown one
// (index.ts turns that into a normal { ok: false } response). Lets the
// handlers run several queries with Promise.all without checking each one.
function ok(res: QueryResult) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function computeWeekNumber(activityDateStr: string, seasonStartDateStr: string): number {
  const start = new Date(seasonStartDateStr);
  const activity = new Date(activityDateStr);
  const days = Math.floor((activity.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return days < 0 ? 1 : Math.floor(days / 7) + 1;
}

// Same ordering everywhere ranks are shown, so a profile's "Rank #4" always
// matches where that person actually sits on the leaderboard — including
// ties, which are broken by name rather than left to whatever order the
// database happened to return rows in.
function rankUsers(users: Row[], pointsByUser: Record<string, number>): Row[] {
  return users
    .map((u): Row => ({ ...u, points: pointsByUser[u.user_id] || 0 }))
    .sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)));
}

// ---- Auth ----

const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function handleLogin(db: SupabaseClient, params: Params) {
  const username = String(params.username || "").trim().toLowerCase().slice(0, 64);
  const pin = String(params.pin || "").trim();
  if (!username || !pin) return { ok: false, error: "Username and PIN are required." };

  // A 4-digit PIN is only 10,000 guesses, and the endpoint is reachable by
  // anyone holding the (public) anon key — so after too many wrong PINs for
  // a username, stop checking it for a while.
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  // ilike is a pattern match, so % _ and * in what the caller typed would
  // act as wildcards ("%" would match every user) — escape them, and check
  // for an exact match again below as a second guard.
  const pattern = username.replace(/[\\%_*]/g, "\\$&");

  const [attempts, candidates] = await Promise.all([
    db.from("login_attempts").select("id", { count: "exact", head: true }).eq("username", username).gte("attempted_at", since),
    db.from("users")
      .select("user_id, name, username, pin, job_function, role, team_id, teams(team_name)")
      .ilike("username", pattern)
      .eq("active", true),
  ]);
  if ((attempts.count ?? 0) >= LOGIN_MAX_FAILS) {
    return { ok: false, error: "Too many failed attempts. Please wait a few minutes and try again." };
  }
  const users: Row[] = ok(candidates) || [];

  const user = users.find((u) => String(u.username).trim().toLowerCase() === username && String(u.pin).trim() === pin);
  if (!user) {
    await db.from("login_attempts").insert({ username });
    // Housekeeping: nothing older than a day is ever consulted, so prune it
    // now and then rather than on every failure.
    if (Math.random() < 0.05) {
      await db.from("login_attempts").delete().lt("attempted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    }
    return { ok: false, error: "Username or PIN not recognized." };
  }

  // Only worth a write if there's something to clear — nearly every login.
  if ((attempts.count ?? 0) > 0) await db.from("login_attempts").delete().eq("username", username);

  return {
    ok: true,
    token: await makeToken(user.user_id),
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      role: user.role,
      team_id: user.team_id,
      team_name: user.teams?.team_name || "",
    },
  };
}

async function requireAdmin(db: SupabaseClient, params: Params): Promise<string> {
  const userId = await requireAuth(params);
  const { data: user } = await db.from("users").select("role").eq("user_id", userId).maybeSingle();
  if (!user || user.role !== "admin") throw new Error("FORBIDDEN");
  return userId;
}

// ---- Activities ----

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// First day of the month containing dateStr, and of the month after it.
function monthBounds(dateStr: string): [string, string] {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [`${y}-${pad(m)}-01`, m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`];
}

export async function handleSubmitActivity(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const activityId = params.activity_id;
  const note = String(params.note_or_link || "").trim();

  const [configRes, seasonRes] = await Promise.all([
    db.from("activities_config").select("*").eq("activity_id", activityId).eq("active", true).maybeSingle(),
    db.from("season_config").select("key, value"),
  ]);
  const config = ok(configRes);
  if (!config) return { ok: false, error: "Unknown or inactive activity." };
  const season: Record<string, string> = {};
  (ok(seasonRes) || []).forEach((r: Row) => { season[r.key] = r.value; });

  // "Today" has to be the group's today, not UTC's — after 5pm Pacific it's
  // already tomorrow in UTC, which would push an evening log into the
  // next day (and, on a Sunday night, into the next week's cap).
  const activityDate = params.activity_date ||
    new Date().toLocaleDateString("en-CA", { timeZone: season.timezone || "America/Los_Angeles" });
  if (!DATE_REGEX.test(activityDate) || Number.isNaN(Date.parse(activityDate))) {
    return { ok: false, error: "That doesn't look like a valid date." };
  }
  const weekNumber = computeWeekNumber(activityDate, season.season_start_date);

  // Count entries in this cap period in the database rather than pulling
  // every prior row back to count them here.
  let capCount: Promise<QueryResult> | null = null;
  if (config.weekly_cap_units !== null && config.weekly_cap_units !== undefined) {
    let q = db.from("activity_log").select("log_id", { count: "exact", head: true })
      .eq("user_id", userId).eq("activity_id", activityId);
    if (config.cap_window === "month") {
      const [start, next] = monthBounds(activityDate);
      q = q.gte("activity_date", start).lt("activity_date", next);
    } else {
      q = q.eq("week_number", weekNumber);
    }
    capCount = q as unknown as Promise<QueryResult>;
  }

  // The same entry arriving twice within seconds is a double-tap or a
  // retry, not two real activities — hand back the first instead of
  // logging it again.
  const dupe = db.from("activity_log").select("log_id, points_awarded, capped")
    .eq("user_id", userId).eq("activity_id", activityId).eq("activity_date", activityDate)
    .eq("note_or_link", note).gte("created_at", new Date(Date.now() - 5000).toISOString()).limit(1);

  const [capRes, dupeRes] = await Promise.all([capCount ?? Promise.resolve(null), dupe]);
  const existing = ok(dupeRes)?.[0];
  if (existing) {
    return {
      ok: true, log_id: existing.log_id, points_awarded: existing.points_awarded,
      capped: existing.capped, activity_name: config.activity_name, duplicate: true,
    };
  }

  let capped = false;
  let pointsAwarded = Number(config.base_points);
  if (capRes) {
    if (capRes.error) throw new Error(capRes.error.message);
    // deno-lint-ignore no-explicit-any
    if (((capRes as any).count ?? 0) >= Number(config.weekly_cap_units)) {
      capped = true;
      pointsAwarded = 0;
    }
  }

  const { data: inserted, error } = await db
    .from("activity_log")
    .insert({
      user_id: userId,
      activity_id: activityId,
      activity_date: activityDate,
      points_awarded: pointsAwarded,
      note_or_link: note,
      week_number: weekNumber,
      capped,
    })
    .select("log_id")
    .single();
  if (error) return { ok: false, error: "Something went wrong: " + error.message };

  return { ok: true, log_id: inserted.log_id, points_awarded: pointsAwarded, capped, activity_name: config.activity_name };
}

export async function handleActivitiesList(db: SupabaseClient) {
  const { data } = await db
    .from("activities_config")
    .select("activity_id, activity_name, category, base_points, evidence_hint")
    .eq("active", true);
  return { ok: true, activities: data || [] };
}

// ---- Leaderboard / profile / trends ----

export async function handleLeaderboard(db: SupabaseClient, params: Params) {
  await requireReadAuth(params);
  const scope = params.scope === "team" ? "team" : "individual";

  // Points come pre-summed from a view (one row per user) — summing the raw
  // activity_log here would silently stop working past 1,000 rows.
  const [pointsRes, usersRes, teamsRes] = await Promise.all([
    db.from("user_points").select("user_id, points"),
    db.from("users").select("user_id, name, job_function, team_id").eq("active", true),
    db.from("teams").select("team_id, team_name, job_function"),
  ]);
  const pointsByUser: Record<string, number> = {};
  (ok(pointsRes) || []).forEach((p: Row) => { pointsByUser[p.user_id] = p.points; });
  const users: Row[] = ok(usersRes) || [];
  const teams: Row[] = ok(teamsRes) || [];

  if (scope === "individual") {
    const teamNameById: Record<string, string> = {};
    teams.forEach((t) => { teamNameById[t.team_id] = t.team_name; });
    const rows = rankUsers(users, pointsByUser).map((u) => ({
      user_id: u.user_id,
      name: u.name,
      team_name: teamNameById[u.team_id] || "",
      job_function: u.job_function,
      points: u.points,
    }));
    return { ok: true, scope, rows };
  }

  const pointsByTeam: Record<string, number> = {};
  users.forEach((u) => {
    pointsByTeam[u.team_id] = (pointsByTeam[u.team_id] || 0) + (pointsByUser[u.user_id] || 0);
  });
  // A team with nobody active on it isn't ranked — keeps retired or demo-only
  // teams off the board.
  const activeTeamIds = new Set(users.map((u) => u.team_id));
  const teamRows = teams
    .filter((t) => activeTeamIds.has(t.team_id))
    .map((t) => ({ team_id: t.team_id, team_name: t.team_name, job_function: t.job_function, points: pointsByTeam[t.team_id] || 0 }))
    .sort((a, b) => b.points - a.points || String(a.team_name).localeCompare(String(b.team_name)));
  return { ok: true, scope, rows: teamRows };
}

// One call for everything the profile page shows. It used to take three
// (profile, goals, goal candidates), each its own function invocation.
//   limit             how many recent activity rows to return (default 50, max 500)
//   include_goals     also return this person's goals
//   include_candidates also return goal-setting candidates — only honored
//                      for your own profile
export async function handleProfile(db: SupabaseClient, params: Params) {
  const callerId = await requireReadAuth(params);
  const userId = params.user_id;
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 500);

  const [userRes, logRes, pointsRes, activeRes, goals, candidates] = await Promise.all([
    db.from("users")
      .select("user_id, name, job_function, role, email, phone, linkedin_url, interested_role, teams(team_name)")
      .eq("user_id", userId).maybeSingle(),
    db.from("activity_log")
      .select("log_id, activity_date, created_at, points_awarded, capped, note_or_link, activities_config(activity_name)")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
    db.from("user_points").select("user_id, points, entries"),
    db.from("users").select("user_id, name").eq("active", true),
    params.include_goals ? loadGoals(db, userId) : Promise.resolve(null),
    params.include_candidates && callerId === userId ? loadGoalCandidates(db, userId) : Promise.resolve(null),
  ]);

  const user = ok(userRes);
  if (!user) return { ok: false, error: "User not found." };

  const pointsByUser: Record<string, number> = {};
  let totalEntries = 0;
  (ok(pointsRes) || []).forEach((p: Row) => {
    pointsByUser[p.user_id] = p.points;
    if (p.user_id === userId) totalEntries = p.entries;
  });
  const ranked = rankUsers(ok(activeRes) || [], pointsByUser);
  const rank = ranked.findIndex((r) => r.user_id === userId) + 1;

  const result: Row = {
    ok: true,
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      team_name: user.teams?.team_name || "",
      role: user.role,
      email: user.email,
      phone: user.phone,
      linkedin_url: user.linkedin_url,
      interested_role: user.interested_role,
    },
    total_points: pointsByUser[userId] || 0,
    total_entries: totalEntries,
    rank,
    activity_log: (ok(logRes) || []).map((l: Row) => ({
      log_id: l.log_id,
      activity_name: l.activities_config?.activity_name || "",
      activity_date: l.activity_date,
      timestamp: l.created_at,
      points_awarded: l.points_awarded,
      capped: l.capped,
      note_or_link: l.note_or_link,
    })),
  };
  if (goals) result.goals = goals;
  if (candidates) result.goal_candidates = candidates;
  return result;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL_REGEX = /^https?:\/\//i;

// Self-service only — userId comes from the verified token, never from a
// client-supplied field, so there's no way to edit anyone else's row.
export async function handleUpdateProfile(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);

  const editable = ["name", "email", "phone", "linkedin_url", "interested_role"] as const;
  const updates: Row = {};
  for (const field of editable) {
    if (field in params) updates[field] = String(params[field] ?? "").trim() || null;
  }
  if (Object.keys(updates).length === 0) return { ok: false, error: "Nothing to update." };

  if ("name" in updates && !updates.name) return { ok: false, error: "Name cannot be empty." };
  if (updates.email && !EMAIL_REGEX.test(updates.email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }
  if (updates.linkedin_url && !HTTP_URL_REGEX.test(updates.linkedin_url)) {
    return { ok: false, error: "LinkedIn URL must start with http:// or https://." };
  }

  const { error } = await db.from("users").update(updates).eq("user_id", userId);
  if (error) return { ok: false, error: "Something went wrong: " + error.message };
  return { ok: true };
}

// ---- Goals ----

// Visible to anyone viewing the profile, not just the goal-setter — same
// visibility as the rest of the profile fields. target_count of 1 is
// meant to render as a checkbox client-side; anything higher as a
// progress bar. current_count counts every log entry for that activity
// regardless of capped/points, since a goal like "10 mock interviews" is
// about how many you actually did, not how many earned points.
async function loadGoals(db: SupabaseClient, userId: string) {
  const [goalsRes, countsRes] = await Promise.all([
    db.from("user_goals").select("activity_id, target_count, activities_config(activity_name)").eq("user_id", userId),
    db.from("user_activity_counts").select("activity_id, n").eq("user_id", userId),
  ]);
  const countByActivity: Record<string, number> = {};
  (ok(countsRes) || []).forEach((c: Row) => { countByActivity[c.activity_id] = c.n; });

  return (ok(goalsRes) || []).map((g: Row) => ({
    activity_id: g.activity_id,
    activity_name: g.activities_config?.activity_name || g.activity_id,
    target_count: g.target_count,
    current_count: countByActivity[g.activity_id] || 0,
  }));
}

// Candidate activities for the "add a goal" form — scoped to the caller's
// own job_function. An activity with no job_functions set applies to
// everyone. This only affects what shows up as a suggestion; it doesn't
// restrict which activities someone can actually log.
async function loadGoalCandidates(db: SupabaseClient, userId: string) {
  const [userRes, configRes] = await Promise.all([
    db.from("users").select("job_function").eq("user_id", userId).maybeSingle(),
    db.from("activities_config").select("activity_id, activity_name, category, job_functions").eq("active", true),
  ]);
  const jobFunction = ok(userRes)?.job_function || "";

  return (ok(configRes) || [])
    .filter((c: Row) => {
      const scopes = String(c.job_functions || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      return scopes.length === 0 || scopes.includes(jobFunction);
    })
    .map((c: Row) => ({ activity_id: c.activity_id, activity_name: c.activity_name, category: c.category }));
}

export async function handleGetGoals(db: SupabaseClient, params: Params) {
  await requireReadAuth(params);
  if (!params.user_id) return { ok: false, error: "user_id is required." };
  return { ok: true, goals: await loadGoals(db, params.user_id) };
}

export async function handleGoalCandidates(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  return { ok: true, activities: await loadGoalCandidates(db, userId) };
}

// Full replace, not incremental — matches a single "Save goals" form
// submission listing every candidate activity's target at once. A target
// of 0 (or an activity left out entirely) means "not tracking this."
export async function handleUpdateGoals(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const goals = Array.isArray(params.goals) ? params.goals : [];

  const cleaned = goals
    .map((g: Row) => ({
      activity_id: String(g?.activity_id || ""),
      target_count: Math.min(999, Math.floor(Number(g?.target_count)) || 0),
    }))
    .filter((g: Row) => g.activity_id && g.target_count > 0);

  const { error: deleteError } = await db.from("user_goals").delete().eq("user_id", userId);
  if (deleteError) return { ok: false, error: "Something went wrong: " + deleteError.message };

  if (cleaned.length > 0) {
    const rows = cleaned.map((g: Row) => ({ user_id: userId, activity_id: g.activity_id, target_count: g.target_count }));
    const { error: insertError } = await db.from("user_goals").insert(rows);
    if (insertError) return { ok: false, error: "Something went wrong: " + insertError.message };
  }

  return { ok: true };
}

// Computed live from a per-user-per-week view rather than a stored
// snapshot table, so trends can never go stale.
export async function handleTrends(db: SupabaseClient, params: Params) {
  await requireReadAuth(params);
  const scope = params.scope === "team" ? "team" : "individual";

  const [weekRows, usersRes, teamsRes] = await Promise.all([
    fetchAll(db, "user_week_points", ["week_number", "user_id"]),
    db.from("users").select("user_id, team_id, name"),
    db.from("teams").select("team_id, team_name"),
  ]);
  const users: Row[] = ok(usersRes) || [];
  const teams: Row[] = ok(teamsRes) || [];

  const userTeam: Record<string, string> = {};
  users.forEach((u) => { userTeam[u.user_id] = u.team_id; });

  const byWeek: Record<number, Record<string, number>> = {};
  weekRows.forEach((r) => {
    const entityId = scope === "team" ? userTeam[r.user_id] : r.user_id;
    if (!entityId) return;
    byWeek[r.week_number] = byWeek[r.week_number] || {};
    byWeek[r.week_number][entityId] = (byWeek[r.week_number][entityId] || 0) + r.points;
  });

  const nameById: Record<string, string> = {};
  if (scope === "team") teams.forEach((t) => { nameById[t.team_id] = t.team_name; });
  else users.forEach((u) => { nameById[u.user_id] = u.name; });

  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  const series = weeks.map((week) => ({
    week,
    entities: Object.keys(byWeek[week]).map((id) => ({ entity_id: id, name: nameById[id] || id, points_this_week: byWeek[week][id] })),
  }));

  return { ok: true, scope, series };
}

// ---- Wall ----

export async function handleWall(db: SupabaseClient, params: Params) {
  await requireReadAuth(params);
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);

  // The whole wall in ONE query: the filtering, plus the joins (activity
  // name, author, author's team) and each entry's reactions and comments,
  // all done in Postgres. This used to be several sequential round trips
  // pulling whole tables back to stitch together here — and since every
  // open Wall tab polls this, it's the request that matters most. (Embedded
  // lists like reactions aren't subject to the 1,000-row cap, and they're
  // bounded by the entries returned anyway.)
  const log: Row[] = ok(
    await db
      .from("activity_log")
      .select(
        "log_id, created_at, user_id, points_awarded, note_or_link, " +
          "activities_config!inner(activity_name, surface_on_wall), users(name, teams(team_name)), " +
          "wall_reactions(emoji), wall_comments(comment_id, user_id, text, created_at, users(name))",
      )
      .eq("activities_config.surface_on_wall", true)
      .gt("points_awarded", 0)
      .order("created_at", { ascending: false })
      .order("log_id")
      .order("created_at", { referencedTable: "wall_comments", ascending: true })
      .limit(limit),
  ) || [];

  const entries = log.map((l) => {
    const reactions: Record<string, number> = {};
    (l.wall_reactions || []).forEach((r: Row) => { reactions[r.emoji] = (reactions[r.emoji] || 0) + 1; });

    return {
      log_id: l.log_id,
      timestamp: l.created_at,
      user_id: l.user_id,
      name: l.users?.name || "Unknown",
      team_name: l.users?.teams?.team_name || "",
      activity_name: l.activities_config.activity_name,
      points_awarded: l.points_awarded,
      note_or_link: l.note_or_link,
      reactions,
      comments: (l.wall_comments || []).map((c: Row) => ({
        comment_id: c.comment_id,
        user_id: c.user_id,
        name: c.users?.name || c.user_id,
        text: c.text,
      })),
    };
  });

  return { ok: true, entries };
}

export async function handleReact(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const logId = params.log_id;
  const emoji = String(params.emoji || "").trim();
  if (!emoji || !EMOJI_REGEX.test(emoji)) return { ok: false, error: "Reaction must be an emoji." };

  const { data: existing } = await db
    .from("wall_reactions")
    .select("reaction_id")
    .eq("log_id", logId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await db.from("wall_reactions").delete().eq("reaction_id", existing.reaction_id);
    return { ok: true, toggled: "off" };
  }

  const { error } = await db.from("wall_reactions").insert({ log_id: logId, user_id: userId, emoji });
  if (error) return { ok: false, error: "Something went wrong: " + error.message };
  return { ok: true, toggled: "on" };
}

export async function handleComment(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const logId = params.log_id;
  const text = String(params.text || "").trim();
  if (!text) return { ok: false, error: "Comment cannot be empty." };
  if (text.length > 500) return { ok: false, error: "Comment is too long." };

  const { error } = await db.from("wall_comments").insert({ log_id: logId, user_id: userId, text });
  if (error) return { ok: false, error: "Something went wrong: " + error.message };
  return { ok: true };
}

export async function handleDeleteComment(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const commentId = params.comment_id;

  const { data: comment } = await db.from("wall_comments").select("*").eq("comment_id", commentId).maybeSingle();
  if (!comment) return { ok: false, error: "Comment not found." };
  if (comment.user_id !== userId) return { ok: false, error: "You can only delete your own comments." };

  await db.from("wall_comments").delete().eq("comment_id", commentId);
  return { ok: true };
}

// Deletable by the entry's own author, or by an admin (of anyone's entry).
// Reactions and comments on it are cleaned up automatically — both tables
// reference activity_log with ON DELETE CASCADE.
export async function handleDeleteActivity(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const logId = params.log_id;

  const { data: entry } = await db.from("activity_log").select("user_id").eq("log_id", logId).maybeSingle();
  if (!entry) return { ok: false, error: "Entry not found." };

  if (entry.user_id !== userId) {
    const { data: me } = await db.from("users").select("role").eq("user_id", userId).maybeSingle();
    if (!me || me.role !== "admin") return { ok: false, error: "You can only delete your own entries." };
  }

  const { error } = await db.from("activity_log").delete().eq("log_id", logId);
  if (error) return { ok: false, error: "Something went wrong: " + error.message };
  return { ok: true };
}

// ---- Backup: export / import ----

export async function handleExport(db: SupabaseClient, params: Params) {
  await requireAdmin(db, params);
  const wb = await buildWorkbook(db);
  const base64 = workbookToBase64(wb);
  const filename = backupFilename();
  return { ok: true, filename, file_base64: base64 };
}

// Restores from a file produced by handleExport (or the daily cron backup)
// — not meant for arbitrary hand-built spreadsheets. Upserts by each
// table's primary key, in dependency order, so a row referencing a team or
// user always finds it already restored.
export async function handleImport(db: SupabaseClient, params: Params) {
  await requireAdmin(db, params);
  const base64 = params.file_base64;
  if (!base64) return { ok: false, error: "No file provided." };

  let wb;
  try {
    wb = readWorkbookFromBase64(base64);
  } catch {
    return { ok: false, error: "Could not read that file — is it a .xlsx export from this app?" };
  }

  const summary: Record<string, number> = {};
  for (const table of TABLES_IN_IMPORT_ORDER) {
    const sheetName = wb.SheetNames.find((n: string) => n.toLowerCase() === table.slice(0, 31).toLowerCase());
    if (!sheetName) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]) as Row[];
    if (!rows.length) continue;

    const cleaned = rows.map((r) => normalizeRowForTable(table, r));
    // In batches: a full season's activity log is thousands of rows, and
    // one giant request body is the first thing to fall over.
    for (let i = 0; i < cleaned.length; i += 500) {
      const { error } = await db.from(table).upsert(cleaned.slice(i, i + 500), { onConflict: primaryKeyFor(table) });
      if (error) return { ok: false, error: `Failed importing ${table}: ${error.message}`, imported: summary };
    }
    summary[table] = cleaned.length;
  }

  return { ok: true, imported: summary };
}
