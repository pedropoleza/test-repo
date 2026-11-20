/**
 * One-shot, gated setup for Sabrina's account:
 *  - per-user pipeline routing: Julia → "Tarefas da Júlia", Sabrina →
 *    "Tarefas Sabrina", Soraya → "Tarefas Soraya" (so auto-created tasks land
 *    in each person's pipeline);
 *  - ensure the "Cotação" stage (first column) on the default board and on
 *    Julia's board (where cotação tasks land).
 *
 * Gated by MIGRATE_SECRET. Idempotent. GET ?loc=<id> (defaults to Sabrina).
 */
import { NextResponse, type NextRequest } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { boards, userBoardRouting } from "~/server/db/schema";
import { ensureCotacaoStage } from "~/server/cotacao-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret) return false;
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.nextUrl.searchParams.get("key") === secret
  );
}

const DEFAULT_LOC = process.env.SABRINA_WA_LOCATION_ID ?? "K9b92VcD0KdCMIn60y0W";

// userId -> substrings that identify that person's board by name.
const ROUTING: { userId: string; label: string; match: string[] }[] = [
  { userId: "QGDwZwVw7n9B0x3X2JeH", label: "Julia", match: ["julia", "julia"] },
  { userId: "4DgtfIZsPvbZjfd07gCR", label: "Sabrina", match: ["sabrina"] },
  { userId: "TNffPXzv8fZvtg31UyiH", label: "Soraya", match: ["soraya", "soraia"] },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loc = req.nextUrl.searchParams.get("loc") || DEFAULT_LOC;

  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.location_id', ${loc}, true)`);

    const allBoards = await tx
      .select({ id: boards.id, name: boards.name, stages: boards.stages })
      .from(boards)
      .where(eq(boards.locationId, loc))
      .orderBy(asc(boards.createdAt));

    // 1) Routing: map each user to the board whose name matches.
    const routingReport: Record<string, string> = {};
    for (const r of ROUTING) {
      const board = allBoards.find((b) =>
        r.match.some((m) => norm(b.name).includes(m)),
      );
      if (!board) {
        routingReport[r.label] = "board_not_found";
        continue;
      }
      await tx
        .insert(userBoardRouting)
        .values({ locationId: loc, userId: r.userId, boardId: board.id })
        .onConflictDoUpdate({
          target: [userBoardRouting.locationId, userBoardRouting.userId],
          set: { boardId: board.id, updatedAt: sql`now()` },
        });
      routingReport[r.label] = board.name;
    }

    // 2) Ensure the "Cotação" stage on the default board + Julia's board.
    const juliaBoard = allBoards.find((b) => norm(b.name).includes("julia"));
    const targets = allBoards.filter(
      (b, i) => i === 0 || b.id === juliaBoard?.id,
    );

    const stageReport: Record<string, string> = {};
    for (const b of targets) {
      const ensured = await ensureCotacaoStage(tx, { id: b.id, stages: b.stages });
      stageReport[b.name] = ensured.stages.map((s) => s.name).join(" | ");
    }

    return {
      loc,
      boards: allBoards.map((b) => ({ id: b.id, name: b.name })),
      routing: routingReport,
      cotacaoStage: stageReport,
    };
  });

  return NextResponse.json({ ok: true, ...out });
}
