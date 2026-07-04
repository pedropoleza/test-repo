import { NextResponse } from "next/server";

// Liveness probe. Plain GET stays dependency-free (green even mid-provisioning);
// `?db=1` additionally proves DB connectivity + that the RLS roles are wired
// (connects, downgrades to the tenant role, runs a trivial scoped query).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("db") !== "1") {
    return NextResponse.json({ status: "ok", service: "spark-tasks" });
  }

  try {
    const { db } = await import("~/server/db");
    const { sql } = await import("drizzle-orm");
    const info = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role spark_tasks_app`);
      await tx.execute(
        sql`select set_config('app.location_id', 'healthcheck', true)`,
      );
      const rows = (await tx.execute(
        sql`select current_user as role, count(*)::int as visible_boards from spark_tasks.boards`,
      )) as unknown as Array<{ role: string; visible_boards: number }>;
      return rows[0];
    });
    return NextResponse.json({
      status: "ok",
      service: "spark-tasks",
      db: { connected: true, role: info?.role, visibleBoards: info?.visible_boards },
    });
  } catch (err) {
    // Message only — never connection strings or credentials.
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { status: "degraded", service: "spark-tasks", db: { connected: false, error: msg.slice(0, 200) } },
      { status: 503 },
    );
  }
}
