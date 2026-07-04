import { NextResponse } from "next/server";

// Simple liveness probe. Intentionally does not touch the DB or GHL so it stays
// green even while those integrations are being provisioned.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", service: "spark-tasks" });
}
