import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Reads an entire table, a page at a time.
//
// The API silently truncates any single query at 1,000 rows (the project's
// "max rows" setting) with no error and no warning — a plain select("*")
// on a bigger table just returns the first 1,000 and looks fine. Anything
// that needs *every* row (the backup export above all) has to page.
//
// Paging only gives stable results with a total order, so callers pass the
// primary key columns; ties between pages would otherwise skip or repeat rows.
export async function fetchAll(
  db: SupabaseClient,
  table: string,
  orderBy: string[],
  pageSize = 1000,
): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  while (true) {
    let q = db.from(table).select("*");
    for (const col of orderBy) q = q.order(col);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    // Advance by what we actually got rather than by pageSize: if the
    // server-side cap is ever lower than pageSize we still make progress
    // instead of stopping early and silently dropping the rest.
    from += data.length;
  }
  return out;
}
