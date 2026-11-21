// Run with:  deno test --allow-env supabase/functions/_shared/
import { assertEquals } from "jsr:@std/assert@1";
import { makeToken, verifyToken } from "./auth.ts";
import { fetchAll } from "./data.ts";

Deno.env.set("SESSION_SECRET", "test-secret-not-the-real-one");

// ---- login tokens ----

Deno.test("a fresh token verifies back to its user", async () => {
  assertEquals(await verifyToken(await makeToken("U042")), "U042");
});

Deno.test("a token older than 30 days is rejected, even though its signature is valid", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 31 * 24 * 60 * 60 * 1000;
    const old = await makeToken("U042");
    Date.now = realNow;
    assertEquals(await verifyToken(old), null);
  } finally {
    Date.now = realNow;
  }
});

Deno.test("a token just inside the 30-day window still works", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 29 * 24 * 60 * 60 * 1000;
    const almostOld = await makeToken("U042");
    Date.now = realNow;
    assertEquals(await verifyToken(almostOld), "U042");
  } finally {
    Date.now = realNow;
  }
});

Deno.test("tampering with the payload or signature invalidates the token", async () => {
  const token = await makeToken("U042");
  const [payload, sig] = token.split(".");
  // Swap in a different user's payload but keep the original signature.
  const forgedPayload = btoa(JSON.stringify({ uid: "U001", iat: Date.now() })).replace(/=+$/, "");
  assertEquals(await verifyToken(`${forgedPayload}.${sig}`), null);
  assertEquals(await verifyToken(`${payload}.${sig.slice(0, -2)}AA`), null);
  assertEquals(await verifyToken("not-a-token"), null);
  assertEquals(await verifyToken(""), null);
  assertEquals(await verifyToken(undefined), null);
  // Garbage that isn't even valid base64 must be "not logged in", not a crash.
  assertEquals(await verifyToken("bad.token"), null);
  assertEquals(await verifyToken("a.b.c"), null);
  assertEquals(await verifyToken("%%%.@@@"), null);
  // deno-lint-ignore no-explicit-any
  assertEquals(await verifyToken(12345 as any), null);
});

// ---- paginated reads (the "silently stops at 1,000 rows" bug) ----

// A stand-in for supabase-js that serves `total` rows but never returns
// more than `serverCap` in one response — exactly how the real API behaves.
function fakeDb(total: number, serverCap: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  return {
    from() {
      let from = 0, to = 0;
      const q = {
        select: () => q,
        order: () => q,
        range: (f: number, t: number) => {
          from = f;
          to = t;
          return q;
        },
        // deno-lint-ignore no-explicit-any
        then: (resolve: (v: any) => void) =>
          resolve({ data: all.slice(from, Math.min(to + 1, from + serverCap)), error: null }),
      };
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("fetchAll returns every row of a table bigger than the server cap", async () => {
  const rows = await fetchAll(fakeDb(2500, 1000), "activity_log", ["log_id"]);
  assertEquals(rows.length, 2500);
  assertEquals(new Set(rows.map((r) => r.id)).size, 2500); // no duplicates, nothing skipped
});

Deno.test("fetchAll still gets everything when the server cap is lower than the page size", async () => {
  const rows = await fetchAll(fakeDb(1234, 500), "activity_log", ["log_id"], 1000);
  assertEquals(rows.length, 1234);
});

Deno.test("fetchAll handles an empty table and an exact multiple of the page size", async () => {
  assertEquals((await fetchAll(fakeDb(0, 1000), "t", ["id"])).length, 0);
  assertEquals((await fetchAll(fakeDb(2000, 1000), "t", ["id"])).length, 2000);
});
