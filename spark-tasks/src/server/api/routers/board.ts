import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, asc, sql } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import {
  boards,
  tasks,
  TASK_STATUSES,
  TASK_COLORS,
  type ColumnConfig,
} from "~/server/db/schema";

const nameSchema = z.string().trim().min(1).max(60);
const columnConfigSchema = z.record(
  z.enum(TASK_STATUSES),
  z.object({
    label: z.string().trim().min(1).max(30).optional(),
    color: z.enum(TASK_COLORS).optional(),
  }),
);

/**
 * Boards = "pipelines" de tarefas (por setor/pasta, estilo ClickUp).
 * Um board padrão é criado lazily; clientes podem criar/renomear/excluir.
 * `ctx.db` is the RLS-scoped transaction, so everything is pinned to the
 * session's location.
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
      .values({ locationId: ctx.locationId })
      .returning();
    if (!created) throw new Error("board_create_failed");
    return [created];
  }),

  create: locationProcedure
    .input(z.object({ name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(boards)
        .values({ locationId: ctx.locationId, name: input.name })
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

  /**
   * Per-board column display overrides (name + color). The status KEYS stay
   * fixed (D3 — todo/doing/waiting/done drive all logic incl. the D7
   * write-back); only presentation changes.
   */
  updateColumns: locationProcedure
    .input(z.object({ id: z.string().uuid(), columns: columnConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      const [board] = await ctx.db
        .select({ columnConfig: boards.columnConfig })
        .from(boards)
        .where(eq(boards.id, input.id))
        .limit(1);
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const merged: ColumnConfig = { ...board.columnConfig };
      for (const [status, cfg] of Object.entries(input.columns)) {
        merged[status as keyof ColumnConfig] = {
          ...merged[status as keyof ColumnConfig],
          ...cfg,
        };
      }
      const [updated] = await ctx.db
        .update(boards)
        .set({ columnConfig: merged })
        .where(eq(boards.id, input.id))
        .returning();
      return updated!;
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
