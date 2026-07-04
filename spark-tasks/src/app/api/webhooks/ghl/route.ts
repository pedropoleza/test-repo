/**
 * POST /api/webhooks/ghl — optional GHL app webhook receiver.
 *
 * V1 needs no inbound webhook for task features (the D7 write-back is an
 * OUTBOUND call). This endpoint exists so the app's "Webhook URL" field can be
 * filled in and install/uninstall events are acknowledged + logged. Event
 * bodies are untrusted input: we log only the event type, never act on them.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { type?: string } | null;
    console.info(`[webhook] ghl event type=${body?.type ?? "unknown"}`);
  } catch {
    // Non-JSON body — still acknowledge; GHL retries otherwise.
  }
  return NextResponse.json({ ok: true });
}

export function GET() {
  // Some portals ping the URL to validate it.
  return NextResponse.json({ ok: true, service: "spark-tasks" });
}
