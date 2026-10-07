/**
 * Per-user pipeline routing. When a task is auto-created for a user who has a
 * configured default board (Settings → pipeline por usuário), it lands there
 * instead of the location's default board. Falls back to null when there's no
 * mapping or the mapped board no longer exists.
 */
import { and, eq } from "drizzle-orm";
import type { db } from "~/server/db";
import { boards, userBoardRouting, type Stage } from "~/server/db/schema";

export async function routedBoard(
  tx: typeof db,
  locationId: string,
  userId: string | null | undefined,
): Promise<{ id: string; stages: Stage[] } | null> {
  if (!userId) return null;
  const [m] = await tx
    .select({ boardId: userBoardRouting.boardId })
    .from(userBoardRouting)
    .where(
      and(
        eq(userBoardRouting.locationId, locationId),
        eq(userBoardRouting.userId, userId),
      ),
    )
    .limit(1);
  if (!m) return null;
  const [b] = await tx
    .select({ id: boards.id, stages: boards.stages })
    .from(boards)
    .where(and(eq(boards.id, m.boardId), eq(boards.locationId, locationId)))
    .limit(1);
  return b ?? null;
}
