/**
 * The dedicated "Cotação" stage (column) that all quote-proposal tasks land in.
 *
 * Proposal tasks (created from the New-task menu or the opportunity webhook)
 * are routed to a stage named "Cotação" placed FIRST on the board (before
 * "To Do"). The stage is created lazily the first time a proposal task is made,
 * so the column simply appears once it's needed. Idempotent: if the board
 * already has a "Cotação" stage (by id or name) we reuse it.
 */
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { boards, type Stage } from "~/server/db/schema";

/** Minimal db/tx surface this helper needs (satisfied by ctx.db and txns). */
type DbLike = { update: (typeof db)["update"] };

export const COTACAO_STAGE_ID = "cotacao";
const COTACAO_STAGE: Stage = {
  id: COTACAO_STAGE_ID,
  name: "Cotação",
  color: "purple",
};

function findCotacaoStage(stages: Stage[]): Stage | undefined {
  return stages.find(
    (s) =>
      s.id === COTACAO_STAGE_ID ||
      s.name.trim().toLowerCase() === "cotação" ||
      s.name.trim().toLowerCase() === "cotacao",
  );
}

/**
 * Ensure the board has a "Cotação" stage as its first column and return the
 * (possibly updated) stage list plus that stage's id. Persists the board only
 * when it has to add the stage.
 */
export async function ensureCotacaoStage(
  tx: DbLike,
  board: { id: string; stages: Stage[] },
): Promise<{ stages: Stage[]; stageId: string }> {
  const existing = findCotacaoStage(board.stages);
  if (existing) return { stages: board.stages, stageId: existing.id };

  const stages = [COTACAO_STAGE, ...board.stages];
  await tx.update(boards).set({ stages }).where(eq(boards.id, board.id));
  return { stages, stageId: COTACAO_STAGE_ID };
}
