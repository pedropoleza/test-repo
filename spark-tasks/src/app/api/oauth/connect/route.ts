/**
 * GET /api/oauth/connect — start (or re-run) the GHL OAuth install for the
 * current subaccount, so a Location-distributed app registers a token per
 * subaccount. Standard SaaS pattern: the user clicks "Connect", authorizes in
 * GHL, and the callback stores this subaccount's token.
 *
 * Reuses the exact scope string already granted to the app (read from an
 * existing install) so the requested scopes always match the app config.
 */
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { ghlInstallations } from "~/server/db/schema";
import { env } from "~/env";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTHORIZE_URL =
  "https://marketplace.gohighlevel.com/oauth/chooselocation";

// Fallback scope set (core features) if no prior install is on record.
const DEFAULT_SCOPES = [
  "locations.readonly",
  "users.readonly",
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "locations/tasks.readonly",
  "locations/tasks.write",
].join(" ");

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/callback`;

  // Reuse the exact scopes the app already granted (guaranteed to match the
  // app's configured scope set), else fall back to the core set.
  const [prior] = await db
    .select({ scopes: ghlInstallations.scopes })
    .from(ghlInstallations)
    .orderBy(desc(ghlInstallations.updatedAt))
    .limit(1);
  const scope = prior?.scopes?.trim() || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: env.GHL_APP_CLIENT_ID,
    scope,
  });
  return NextResponse.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
}
