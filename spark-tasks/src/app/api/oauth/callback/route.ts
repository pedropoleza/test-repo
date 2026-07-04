/**
 * GET /api/oauth/callback  (plan §4.2)
 *
 * The redirect target for the agency OAuth install. GHL redirects here with a
 * `code`; we exchange it for the Company token and store it encrypted. This is
 * the URL to set as the app's "Redirect URL" in the GHL Developer Portal:
 *   https://<domain>/api/oauth/callback
 */
import { NextResponse } from "next/server";
import { handleOAuthCallback } from "~/server/ghl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }
  // redirect_uri must exactly match what was used to start the install.
  const redirectUri = `${url.origin}/api/oauth/callback`;
  try {
    await handleOAuthCallback(code, redirectUri);
  } catch (err) {
    console.error(
      `[oauth] callback failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.json({ error: "oauth_exchange_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: "Spark Tasks installed." });
}
