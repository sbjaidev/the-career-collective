import * as XLSX from "npm:xlsx@0.18.5";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const BACKUP_FILENAME_PREFIX = "career-league-backup";

export function backupFilename(date = new Date()): string {
  return `${BACKUP_FILENAME_PREFIX}-${date.toISOString().slice(0, 10)}.xlsx`;
}

// Import order matters: teams and activities_config have no dependencies,
// users depends on teams, activity_log depends on users + activities_config,
// wall_reactions/wall_comments depend on activity_log. Restoring in this
// order means every foreign key already exists by the time it's needed.
export const TABLES_IN_IMPORT_ORDER = [
  "teams",
  "users",
  "activities_config",
  "activity_log",
  "wall_reactions",
  "wall_comments",
  "season_config",
] as const;

const PRIMARY_KEYS: Record<string, string> = {
  teams: "team_id",
  users: "user_id",
  activities_config: "activity_id",
  activity_log: "log_id",
  wall_reactions: "reaction_id",
  wall_comments: "comment_id",
  season_config: "key",
};

// The full column list per table, in schema.sql order. Needed because a
// blank/null cell in Excel doesn't round-trip as an empty value — the key
// is dropped from the row entirely. Without filling every known column in
// explicitly, a restore would leave stale values in place for any column
// that was blank in the backup, instead of actually resetting it to null.
const ALL_COLUMNS: Record<string, string[]> = {
  teams: ["team_id", "team_name", "job_function", "captain_user_id", "mentor_user_ids", "created_date"],
  users: ["user_id", "name", "username", "pin", "job_function", "team_id", "role", "joined_date", "active"],
  activities_config: [
    "activity_id", "activity_name", "category", "base_points",
    "weekly_cap_units", "cap_window", "evidence_hint", "surface_on_wall", "active",
  ],
  activity_log: [
    "log_id", "created_at", "user_id", "activity_id", "activity_date",
    "points_awarded", "note_or_link", "week_number", "capped",
  ],
  wall_reactions: ["reaction_id", "log_id", "user_id", "emoji", "created_at"],
  wall_comments: ["comment_id", "log_id", "user_id", "text", "created_at"],
  season_config: ["key", "value"],
};

const BOOL_COLUMNS: Record<string, string[]> = {
  users: ["active"],
  activities_config: ["surface_on_wall", "active"],
  activity_log: ["capped"],
};

const DATE_COLUMNS: Record<string, string[]> = {
  teams: ["created_date"],
  users: ["joined_date"],
  activity_log: ["activity_date"],
};

const TIMESTAMP_COLUMNS: Record<string, string[]> = {
  activity_log: ["created_at"],
  wall_reactions: ["created_at"],
  wall_comments: ["created_at"],
};

export async function buildWorkbook(db: SupabaseClient) {
  const wb = XLSX.utils.book_new();
  for (const table of TABLES_IN_IMPORT_ORDER) {
    const { data, error } = await db.from(table).select("*");
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    const sheet = XLSX.utils.json_to_sheet(data ?? []);
    XLSX.utils.book_append_sheet(wb, sheet, table.slice(0, 31)); // Excel sheet names cap at 31 chars
  }
  return wb;
}

export function workbookToBytes(wb: XLSX.WorkBook): Uint8Array {
  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(buf);
}

export function workbookToBase64(wb: XLSX.WorkBook): string {
  const bytes = workbookToBytes(wb);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function readWorkbookFromBase64(base64: string): XLSX.WorkBook {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return XLSX.read(bytes, { type: "array", cellDates: true });
}

// Excel round-trips give us JS Date objects for date-formatted cells and
// blank cells as missing keys or '' — neither matches what Postgres
// expects, so every imported row gets normalized per its table's column
// types before being upserted.
export function normalizeRowForTable(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const columns = ALL_COLUMNS[table] ?? Object.keys(row);
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[col] = col in row ? row[col] : null;
  }

  for (const col of BOOL_COLUMNS[table] ?? []) {
    out[col] = coerceBool(out[col]);
  }
  for (const col of DATE_COLUMNS[table] ?? []) {
    if (out[col] instanceof Date) out[col] = (out[col] as Date).toISOString().slice(0, 10);
  }
  for (const col of TIMESTAMP_COLUMNS[table] ?? []) {
    if (out[col] instanceof Date) out[col] = (out[col] as Date).toISOString();
  }
  for (const key of Object.keys(out)) {
    if (out[key] === "") out[key] = null;
  }
  return out;
}

function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return String(v).trim().toUpperCase() === "TRUE";
}

export function primaryKeyFor(table: string): string {
  return PRIMARY_KEYS[table];
}
