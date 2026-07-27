import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { makeToken, requireAuth } from "../_shared/auth.ts";
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

function computeWeekNumber(activityDateStr: string, seasonStartDateStr: string): number {
  const start = new Date(seasonStartDateStr);
  const activity = new Date(activityDateStr);
  const days = Math.floor((activity.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return days < 0 ? 1 : Math.floor(days / 7) + 1;
}

function capPeriodKey(activityDateStr: string, weekNumber: number, capWindow: string | null): string {
  if (capWindow === "month") return String(activityDateStr).slice(0, 7); // 'YYYY-MM'
  return String(weekNumber);
}

// ---- Auth ----

export async function handleLogin(db: SupabaseClient, params: Params) {
  const username = String(params.username || "").trim().toLowerCase();
  const pin = String(params.pin || "").trim();
  if (!username || !pin) return { ok: false, error: "Username and PIN are required." };

  const { data: candidates, error } = await db
    .from("users")
    .select("*")
    .ilike("username", username)
    .eq("active", true);
  if (error) return { ok: false, error: "Something went wrong: " + error.message };

  const user = (candidates || []).find((u: Row) => String(u.pin).trim() === pin);
  if (!user) return { ok: false, error: "Username or PIN not recognized." };

  let teamName = "";
  if (user.team_id) {
    const { data: team } = await db.from("teams").select("team_name").eq("team_id", user.team_id).maybeSingle();
    teamName = team?.team_name || "";
  }

  return {
    ok: true,
    token: await makeToken(user.user_id),
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      role: user.role,
      team_id: user.team_id,
      team_name: teamName,
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

export async function handleSubmitActivity(db: SupabaseClient, params: Params) {
  const userId = await requireAuth(params);
  const activityId = params.activity_id;
  const activityDate = params.activity_date || new Date().toISOString().slice(0, 10);
  const note = String(params.note_or_link || "").trim();

  const { data: config } = await db
    .from("activities_config")
    .select("*")
    .eq("activity_id", activityId)
    .eq("active", true)
    .maybeSingle();
  if (!config) return { ok: false, error: "Unknown or inactive activity." };

  const { data: seasonRows } = await db.from("season_config").select("*");
  const season: Record<string, string> = {};
  (seasonRows || []).forEach((r: Row) => { season[r.key] = r.value; });

  const weekNumber = computeWeekNumber(activityDate, season.season_start_date);
  const periodKey = capPeriodKey(activityDate, weekNumber, config.cap_window);

  let capped = false;
  let pointsAwarded = Number(config.base_points);

  if (config.weekly_cap_units !== null && config.weekly_cap_units !== undefined) {
    const { data: priorRows } = await db
      .from("activity_log")
      .select("activity_date, week_number")
      .eq("user_id", userId)
      .eq("activity_id", activityId);
    const priorCount = (priorRows || []).filter(
      (l: Row) => capPeriodKey(l.activity_date, l.week_number, config.cap_window) === periodKey,
    ).length;
    if (priorCount >= Number(config.weekly_cap_units)) {
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
    .select()
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
  const scope = params.scope === "team" ? "team" : "individual";
  const { data: log } = await db.from("activity_log").select("user_id, points_awarded");
  const { data: users } = await db.from("users").select("*").eq("active", true);
  const { data: teams } = await db.from("teams").select("*");

  const pointsByUser: Record<string, number> = {};
  (log || []).forEach((l: Row) => {
    pointsByUser[l.user_id] = (pointsByUser[l.user_id] || 0) + Number(l.points_awarded || 0);
  });

  if (scope === "individual") {
    const rows = (users || [])
      .map((u: Row) => {
        const team = (teams || []).find((t: Row) => t.team_id === u.team_id);
        return {
          user_id: u.user_id,
          name: u.name,
          team_name: team?.team_name || "",
          job_function: u.job_function,
          points: pointsByUser[u.user_id] || 0,
        };
      })
      .sort((a: Row, b: Row) => b.points - a.points);
    return { ok: true, scope, rows };
  }

  const pointsByTeam: Record<string, number> = {};
  (users || []).forEach((u: Row) => {
    pointsByTeam[u.team_id] = (pointsByTeam[u.team_id] || 0) + (pointsByUser[u.user_id] || 0);
  });
  const teamRows = (teams || [])
    .map((t: Row) => ({ team_id: t.team_id, team_name: t.team_name, job_function: t.job_function, points: pointsByTeam[t.team_id] || 0 }))
    .sort((a: Row, b: Row) => b.points - a.points);
  return { ok: true, scope, rows: teamRows };
}

export async function handleProfile(db: SupabaseClient, params: Params) {
  const userId = params.user_id;
  const { data: user } = await db.from("users").select("*").eq("user_id", userId).maybeSingle();
  if (!user) return { ok: false, error: "User not found." };

  let teamName = "";
  if (user.team_id) {
    const { data: team } = await db.from("teams").select("team_name").eq("team_id", user.team_id).maybeSingle();
    teamName = team?.team_name || "";
  }

  const { data: myLogRaw } = await db
    .from("activity_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const { data: configRows } = await db.from("activities_config").select("*");
  const configById: Record<string, Row> = {};
  (configRows || []).forEach((c: Row) => { configById[c.activity_id] = c; });

  const myLog = (myLogRaw || []).map((l: Row) => ({
    log_id: l.log_id,
    activity_name: configById[l.activity_id]?.activity_name || l.activity_id,
    activity_date: l.activity_date,
    points_awarded: l.points_awarded,
    capped: l.capped,
    note_or_link: l.note_or_link,
  }));
  const totalPoints = myLog.reduce((sum: number, l: Row) => sum + Number(l.points_awarded || 0), 0);

  const { data: allLog } = await db.from("activity_log").select("user_id, points_awarded");
  const { data: activeUsers } = await db.from("users").select("user_id").eq("active", true);
  const pointsByUser: Record<string, number> = {};
  (allLog || []).forEach((l: Row) => { pointsByUser[l.user_id] = (pointsByUser[l.user_id] || 0) + Number(l.points_awarded || 0); });
  const ranked = (activeUsers || [])
    .map((u: Row) => ({ user_id: u.user_id, points: pointsByUser[u.user_id] || 0 }))
    .sort((a: Row, b: Row) => b.points - a.points);
  const rank = ranked.findIndex((r: Row) => r.user_id === userId) + 1;

  return {
    ok: true,
    user: {
      user_id: user.user_id,
      name: user.name,
      job_function: user.job_function,
      team_name: teamName,
      role: user.role,
      email: user.email,
      phone: user.phone,
      linkedin_url: user.linkedin_url,
      interested_role: user.interested_role,
    },
    total_points: totalPoints,
    rank,
    activity_log: myLog,
  };
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

// Computed live rather than from a stored snapshot table — at this scale
// (dozens of people, two months) re-aggregating on request is cheap and
// keeps trends from ever going stale.
export async function handleTrends(db: SupabaseClient, params: Params) {
  const scope = params.scope === "team" ? "team" : "individual";
  const { data: log } = await db.from("activity_log").select("user_id, points_awarded, week_number");
  const { data: users } = await db.from("users").select("user_id, team_id, name");
  const { data: teams } = await db.from("teams").select("team_id, team_name");

  const userTeam: Record<string, string> = {};
  (users || []).forEach((u: Row) => { userTeam[u.user_id] = u.team_id; });

  const byWeek: Record<number, Record<string, number>> = {};
  (log || []).forEach((l: Row) => {
    const week = l.week_number;
    const entityId = scope === "team" ? userTeam[l.user_id] : l.user_id;
    if (!entityId) return;
    byWeek[week] = byWeek[week] || {};
    byWeek[week][entityId] = (byWeek[week][entityId] || 0) + Number(l.points_awarded || 0);
  });

  const nameById: Record<string, string> = {};
  if (scope === "team") (teams || []).forEach((t: Row) => { nameById[t.team_id] = t.team_name; });
  else (users || []).forEach((u: Row) => { nameById[u.user_id] = u.name; });

  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  const series = weeks.map((week) => ({
    week,
    entities: Object.keys(byWeek[week]).map((id) => ({ entity_id: id, name: nameById[id] || id, points_this_week: byWeek[week][id] })),
  }));

  return { ok: true, scope, series };
}

// ---- Wall ----

export async function handleWall(db: SupabaseClient, params: Params) {
  const limit = params.limit ? Number(params.limit) : 50;

  const { data: config } = await db.from("activities_config").select("*");
  const configById: Record<string, Row> = {};
  (config || []).forEach((a: Row) => { configById[a.activity_id] = a; });

  const { data: users } = await db.from("users").select("*");
  const usersById: Record<string, Row> = {};
  (users || []).forEach((u: Row) => { usersById[u.user_id] = u; });

  const { data: teams } = await db.from("teams").select("*");
  const teamsById: Record<string, Row> = {};
  (teams || []).forEach((t: Row) => { teamsById[t.team_id] = t; });

  const { data: logRaw } = await db.from("activity_log").select("*").order("created_at", { ascending: false }).limit(500);
  const log = (logRaw || [])
    .filter((l: Row) => {
      const cfg = configById[l.activity_id];
      return cfg && cfg.surface_on_wall && Number(l.points_awarded) > 0;
    })
    .slice(0, limit);

  const logIds = log.map((l: Row) => l.log_id);
  const { data: reactions } = logIds.length
    ? await db.from("wall_reactions").select("*").in("log_id", logIds)
    : { data: [] as Row[] };
  const { data: comments } = logIds.length
    ? await db.from("wall_comments").select("*").in("log_id", logIds).order("created_at", { ascending: true })
    : { data: [] as Row[] };

  const entries = log.map((l: Row) => {
    const cfg = configById[l.activity_id];
    const user = usersById[l.user_id];
    const team = user ? teamsById[user.team_id] : null;

    const reactionCounts: Record<string, number> = {};
    (reactions || []).filter((r: Row) => r.log_id === l.log_id).forEach((r: Row) => {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
    });

    const myComments = (comments || []).filter((c: Row) => c.log_id === l.log_id).map((c: Row) => ({
      comment_id: c.comment_id,
      user_id: c.user_id,
      name: usersById[c.user_id]?.name || c.user_id,
      text: c.text,
    }));

    return {
      log_id: l.log_id,
      timestamp: l.created_at,
      user_id: l.user_id,
      name: user?.name || "Unknown",
      team_name: team?.team_name || "",
      activity_name: cfg.activity_name,
      points_awarded: l.points_awarded,
      note_or_link: l.note_or_link,
      reactions: reactionCounts,
      comments: myComments,
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
    const { error } = await db.from(table).upsert(cleaned, { onConflict: primaryKeyFor(table) });
    if (error) return { ok: false, error: `Failed importing ${table}: ${error.message}`, imported: summary };
    summary[table] = cleaned.length;
  }

  return { ok: true, imported: summary };
}
