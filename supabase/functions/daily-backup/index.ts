// Triggered daily by a Supabase Cron Job (see the setup README). Deployed
// with --no-verify-jwt since it takes no input and returns no user data —
// it's a fixed system job, not something that needs to know who called it.
import { getServiceClient } from "../_shared/db.ts";
import { buildWorkbook, workbookToBytes } from "../_shared/xlsx.ts";

const BUCKET = "backups";
const RETENTION_DAYS = 14;

Deno.serve(async () => {
  const db = getServiceClient();

  try {
    const wb = await buildWorkbook(db);
    const bytes = workbookToBytes(wb);
    const filename = `bkb-cpl-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;

    const { error: uploadError } = await db.storage.from(BUCKET).upload(filename, bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const pruned = await pruneOldBackups(db);

    return new Response(JSON.stringify({ ok: true, filename, pruned }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// deno-lint-ignore no-explicit-any
async function pruneOldBackups(db: any): Promise<string[]> {
  const { data: files, error } = await db.storage.from(BUCKET).list();
  if (error || !files) return [];

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  // deno-lint-ignore no-explicit-any
  const stale = files.filter((f: any) => {
    const match = f.name.match(/bkb-cpl-backup-(\d{4}-\d{2}-\d{2})\.xlsx$/);
    if (!match) return false;
    return new Date(match[1]).getTime() < cutoff;
  // deno-lint-ignore no-explicit-any
  }).map((f: any) => f.name);

  if (stale.length) await db.storage.from(BUCKET).remove(stale);
  return stale;
}
