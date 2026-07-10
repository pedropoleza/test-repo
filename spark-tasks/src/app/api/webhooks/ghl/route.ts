/**
 * POST /api/webhooks/ghl — GHL marketplace webhook receiver.
 *
 * Handles native task events (TaskCreate / TaskComplete / TaskDelete) by
 * mirroring them into the location's board (see task-sync). Install/uninstall
 * events are acknowledged + logged. Authenticity is verified against GHL's
 * webhook public key when GHL_WEBHOOK_PUBLIC_KEY is set.
 *
 * External input: the body is untrusted. We verify the signature, act only on
 * known event types, and the location scope comes from the (verified) payload.
 */
import { NextResponse } from "next/server";
import { createVerify } from "node:crypto";
import { env } from "~/env";
import { ingestTaskEvent, type GhlTaskEvent } from "~/server/ghl/task-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_EVENTS = new Set(["TaskCreate", "TaskComplete", "TaskDelete"]);

function verifySignature(rawBody: string, signature: string | null): boolean {
  const pubKey = env.GHL_WEBHOOK_PUBLIC_KEY;
  if (!pubKey) {
    // Not configured yet (Stage 0). Process but warn — set the key before
    // go-live so we can fail closed.
    console.warn("[webhook] GHL_WEBHOOK_PUBLIC_KEY not set — skipping verify");
    return true;
  }
  if (!signature) return false;
  try {
    const v = createVerify("RSA-SHA256");
    v.update(rawBody);
    v.end();
    return v.verify(pubKey, signature, "base64");
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const signature =
    req.headers.get("x-wh-signature") ?? req.headers.get("x-ghl-signature");

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: GhlTaskEvent & { type?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // ack non-JSON so GHL stops retrying
  }

  const type = body?.type ?? "unknown";
  // Always log the event type (+ shape) so real deliveries are diagnosable.
  console.info(
    `[webhook] type=${type} loc=${body?.locationId ?? "-"} id=${body?.id ?? "-"} keys=${Object.keys(body ?? {}).join(",")}`,
  );
  if (TASK_EVENTS.has(type)) {
    try {
      await ingestTaskEvent(body);
      console.info(`[webhook] ingested ${type} id=${body.id}`);
    } catch (err) {
      console.error(
        `[webhook] task ingest failed (${type}): ${err instanceof Error ? err.message : "unknown"}`,
      );
      // 200 anyway — retries would re-run the same idempotent upsert; we log
      // and move on rather than trigger a retry storm.
    }
  }
  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({ ok: true, service: "spark-tasks" });
}
