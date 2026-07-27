// Stateless session token: base64url(payload).base64url(hmac(payload)).
// Same design as the Apps Script version — no sessions table to grow or
// expire, verified fresh on every request. Requires a SESSION_SECRET set
// via `supabase secrets set` (see the setup README).

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("SESSION_SECRET") ?? "";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function makeToken(userId: string): Promise<string> {
  const key = await getKey();
  const payload = JSON.stringify({ uid: userId, iat: Date.now() });
  const payloadB64 = b64url(new TextEncoder().encode(payload));
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const key = await getKey();
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sigB64) as BufferSource,
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    return payload.uid ?? null;
  } catch {
    return null;
  }
}

export async function requireAuth(params: Record<string, unknown>): Promise<string> {
  const uid = await verifyToken(params.token as string | undefined);
  if (!uid) throw new Error("AUTH");
  return uid;
}
