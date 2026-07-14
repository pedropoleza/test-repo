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
    return html(
      "⚠️",
      "Connection failed",
      "Please try connecting again from Spark Tasks. If it keeps failing, contact support.",
      502,
    );
  }
  return html(
    "✅",
    "Spark Tasks connected!",
    "This subaccount is now connected. Close this tab and reload Spark Tasks — users and contacts will load. This window closes itself.",
    200,
    true,
  );
}

function html(
  icon: string,
  title: string,
  sub: string,
  status: number,
  autoclose = false,
) {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;background:#f2f4f7;padding:24px">
  <div style="background:#fff;border:1px solid #e4e7ec;border-radius:16px;box-shadow:0 12px 16px -4px rgba(16,24,40,.14);padding:32px 28px;max-width:400px;text-align:center">
    <div style="font-size:44px">${icon}</div>
    <h1 style="font-size:18px;font-weight:700;margin:12px 0 6px;color:#101828">${title}</h1>
    <p style="font-size:14px;color:#475467;margin:0;line-height:1.5">${sub}</p>
  </div>
</div>${autoclose ? "<script>setTimeout(function(){window.close()},3500)</script>" : ""}`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
