import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, asc, sql } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import {
  boards,
  tasks,
  TASK_COLORS,
  DEFAULT_STAGES,
  type Stage,
} from "~/server/db/schema";

const nameSchema = z.string().trim().min(1).max(60);
const stageSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(30),
  color: z.enum(TASK_COLORS),
  isDone: z.boolean().optional(),
});
const stagesSchema = z.array(stageSchema).min(1).max(12);

/**
 * Boards = task pipelines (per sector/folder, ClickUp-style). Each board owns
 * an ordered list of stages (columns) that clients can add/rename/recolor/
 * reorder. A default board is created lazily. `ctx.db` is the RLS-scoped
 * transaction, so everything is pinned to the session's location.
 */
export const boardRouter = createTRPCRouter({
  /** All boards for the location (creates the default on first load). */
  list: locationProcedure.query(async ({ ctx }) => {
    const existing = await ctx.db
      .select()
      .from(boards)
      .where(eq(boards.locationId, ctx.locationId))
      .orderBy(asc(boards.createdAt));
    if (existing.length) return existing;

    const [created] = await ctx.db
      .insert(boards)
      .values({ locationId: ctx.locationId, stages: DEFAULT_STAGES })
      .returning();
    if (!created) throw new Error("board_create_failed");
    return [created];
  }),

  create: locationProcedure
    .input(
      z.object({
        name: nameSchema,
        stages: stagesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stages = input.stages ?? DEFAULT_STAGES;
      const [created] = await ctx.db
        .insert(boards)
        .values({ locationId: ctx.locationId, name: input.name, stages })
        .returning();
      if (!created) throw new Error("board_create_failed");
      return created;
    }),

  rename: locationProcedure
    .input(z.object({ id: z.string().uuid(), name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(boards)
        .set({ name: input.name })
        .where(eq(boards.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /**
   * Replace a board's full stage list (add/rename/recolor/reorder/remove).
   * When a stage is removed, its tasks are moved to the first remaining stage
   * so nothing is orphaned.
   */
  setStages: locationProcedure
    .input(z.object({ id: z.string().uuid(), stages: stagesSchema }))
    .mutation(async ({ ctx, input }) => {
      const [board] = await ctx.db
        .select()
        .from(boards)
        .where(eq(boards.id, input.id))
        .limit(1);
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      // Dedupe ids defensively.
      const seen = new Set<string>();
      for (const s of input.stages) {
        if (seen.has(s.id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "duplicate_stage_id" });
        }
        seen.add(s.id);
      }

      const removed = board.stages.filter((s) => !seen.has(s.id));
      const fallback = input.stages[0]!.id;
      for (const r of removed) {
        await ctx.db
          .update(tasks)
          .set({ status: fallback, updatedAt: sql`now()` })
          .where(and(eq(tasks.boardId, input.id), eq(tasks.status, r.id)));
      }

      const [updated] = await ctx.db
        .update(boards)
        .set({ stages: input.stages as Stage[] })
        .where(eq(boards.id, input.id))
        .returning();
      return updated!;
    }),

  /** Deleting a pipeline cascades its tasks. The last board can't be removed. */
  delete: locationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [{ count }] = (await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(boards)
        .where(eq(boards.locationId, ctx.locationId))) as [{ count: number }];
      if (count <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "last_board" });
      }
      const [deleted] = await ctx.db
        .delete(boards)
        .where(eq(boards.id, input.id))
        .returning({ id: boards.id });
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return deleted;
    }),

  /** Tasks per board, for delete confirmations. */
  taskCount: locationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = (await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.boardId, input.id))) as [{ count: number }];
      return row;
    }),
});
