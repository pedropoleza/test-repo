/**
 * POST /api/webhooks/lead-reply
 *
 * Called by a GHL workflow when a contact replies to a nurture flow. Creates a
 * "Responder lead {name}" task. Auth via a shared secret in the
 * `X-Webhook-Secret` header or a `?key=` query param (whichever is easier to
 * set in the GHL webhook action).
 *
 * Body is tolerant of GHL merge-field shapes, e.g.:
 *   { "locationId": "{{location.id}}", "contactId": "{{contact.id}}",
 *     "name": "{{contact.name}}", "assignedTo": "{{contact.assigned_to}}",
 *     "flow": "Nutrição" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createLeadReplyTask } from "~/server/ghl/lead-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.LEAD_REPLY_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-webhook-secret");
  const key = req.nextUrl.searchParams.get("key");
  return header === secret || key === secret;
}

/** First non-empty string among the given keys (case-insensitive). */
function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  const lower = new Map(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const nested = (k: string): Record<string, unknown> =>
    (body[k] && typeof body[k] === "object"
      ? (body[k] as Record<string, unknown>)
      : {});
  const location = nested("location");
  const contact = nested("contact");

  const locationId =
    pick(body, ["locationId", "location_id"]) || pick(location, ["id"]);
  const contactId =
    pick(body, ["contactId", "contact_id"]) || pick(contact, ["id"]);
  const name =
    pick(body, ["name", "full_name", "fullName", "contactName", "contact_name"]) ||
    pick(contact, ["name", "fullName", "full_name"]) ||
    [
      pick(body, ["first_name", "firstName"]) ?? "",
      pick(body, ["last_name", "lastName"]) ?? "",
    ]
      .join(" ")
      .trim() ||
    null;
  const assignedTo =
    pick(body, ["assignedTo", "assigned_to", "userId", "user_id", "ownerId"]) ||
    pick(contact, ["assignedTo", "assigned_to"]);
  const flow =
    pick(body, ["flow", "flowName", "workflow", "workflow_name", "workflowName"]);

  if (!locationId) {
    return NextResponse.json({ error: "missing_location" }, { status: 400 });
  }

  try {
    const res = await createLeadReplyTask({
      locationId,
      contactId,
      name,
      assignedTo,
      flow,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    console.error(
      `[lead-reply] failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
