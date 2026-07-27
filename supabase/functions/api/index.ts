import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/db.ts";
import * as handlers from "./handlers.ts";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Only POST is supported." });
  }

  // deno-lint-ignore no-explicit-any
  let params: Record<string, any>;
  try {
    params = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." });
  }

  const db = getServiceClient();

  try {
    switch (params.action) {
      case "login": return jsonResponse(await handlers.handleLogin(db, params));
      case "submitActivity": return jsonResponse(await handlers.handleSubmitActivity(db, params));
      case "react": return jsonResponse(await handlers.handleReact(db, params));
      case "comment": return jsonResponse(await handlers.handleComment(db, params));
      case "deleteComment": return jsonResponse(await handlers.handleDeleteComment(db, params));
      case "leaderboard": return jsonResponse(await handlers.handleLeaderboard(db, params));
      case "profile": return jsonResponse(await handlers.handleProfile(db, params));
      case "updateProfile": return jsonResponse(await handlers.handleUpdateProfile(db, params));
      case "trends": return jsonResponse(await handlers.handleTrends(db, params));
      case "wall": return jsonResponse(await handlers.handleWall(db, params));
      case "activities": return jsonResponse(await handlers.handleActivitiesList(db));
      case "export": return jsonResponse(await handlers.handleExport(db, params));
      case "import": return jsonResponse(await handlers.handleImport(db, params));
      default: return jsonResponse({ ok: false, error: "Unknown action: " + params.action });
    }
  } catch (err) {
    if (err instanceof Error && err.message === "AUTH") return jsonResponse({ ok: false, error: "Please log in again." });
    if (err instanceof Error && err.message === "FORBIDDEN") return jsonResponse({ ok: false, error: "Admin access required." });
    console.error(err);
    return jsonResponse({ ok: false, error: "Something went wrong: " + (err instanceof Error ? err.message : String(err)) });
  }
});
