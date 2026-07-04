import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import {
  boards,
  tasks,
  taskAssignees,
  TASK_STATUSES,
  TASK_COLORS,
} from "~/server/db/schema";
import { runContactWriteback } from "~/server/ghl/writeback";

const statusEnum = z.enum(TASK_STATUSES);
const colorEnum = z.enum(TASK_COLORS);

type Db = Parameters<Parameters<typeof locationProcedure.query>[0]>[0]["ctx"]["db"];

/** V1 single default board — resolve (or lazily create) it inside the tx. */
async function getBoardId(db: Db, locationId: string): Promise<string> {
  const [b] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.locationId, locationId))
    .orderBy(asc(boards.createdAt))
    .limit(1);
  if (b) return b.id;
  const [created] = await db
    .insert(boards)
    .values({ locationId })
    .returning({ id: boards.id });
  if (!created) throw new Error("board_create_failed");
  return created.id;
}

/** Renumber a column 0..n-1 (only writes rows whose position changed). */
async function renumber(
  db: Db,
  ordered: Array<{ id: string; position: number }>,
) {
  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i]!;
    if (t.position !== i) {
      await db.update(tasks).set({ position: i }).where(eq(tasks.id, t.id));
    }
  }
}

export const taskRouter = createTRPCRouter({
  list: locationProcedure
    .input(
      z
        .object({
          status: statusEnum.optional(),
          assigneeId: z.string().optional(),
          contactId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(tasks.locationId, ctx.locationId)];
      if (input?.status) filters.push(eq(tasks.status, input.status));
      if (input?.contactId) filters.push(eq(tasks.contactId, input.contactId));

      const rows = await ctx.db
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(asc(tasks.position), asc(tasks.createdAt));

      const ids = rows.map((r) => r.id);
      const assignees = ids.length
        ? await ctx.db
            .select()
            .from(taskAssignees)
            .where(inArray(taskAssignees.taskId, ids))
        : [];
      const byTask = new Map<string, string[]>();
      for (const a of assignees) {
        const list = byTask.get(a.taskId) ?? [];
        list.push(a.userId);
        byTask.set(a.taskId, list);
      }

      let result = rows.map((r) => ({
        ...r,
        assigneeIds: byTask.get(r.id) ?? [],
      }));
      // Assignee is a FILTER, not a visibility boundary (D6).
      if (input?.assigneeId) {
        result = result.filter((t) => t.assigneeIds.includes(input.assigneeId!));
      }
      return result;
    }),

  create: locationProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(500),
        note: z.string().max(10_000).nullish(),
        status: statusEnum.default("todo"),
        color: colorEnum.default("gray"),
        dueDate: z.date().nullish(),
        contactId: z.string().max(100).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await getBoardId(ctx.db, ctx.locationId);
      // Append to the end of the target column.
      const [{ count }] = (await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.boardId, boardId), eq(tasks.status, input.status)))) as [
        { count: number },
      ];

      const [created] = await ctx.db
        .insert(tasks)
        .values({
          locationId: ctx.locationId, // from session — never client input
          boardId,
          title: input.title,
          note: input.note ?? null,
          status: input.status,
          color: input.color,
          dueDate: input.dueDate ?? null,
          contactId: input.contactId ?? null,
          position: count,
          createdBy: ctx.userId,
        })
        .returning();
      if (!created) throw new Error("task_create_failed");
      return created;
    }),

  update: locationProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(500).optional(),
        note: z.string().max(10_000).nullable().optional(),
        color: colorEnum.optional(),
        dueDate: z.date().nullable().optional(),
        contactId: z.string().max(100).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const set: Record<string, unknown> = { updatedAt: sql`now()` };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.note !== undefined) set.note = patch.note;
      if (patch.color !== undefined) set.color = patch.color;
      if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
      if (patch.contactId !== undefined) set.contactId = patch.contactId;

      const [updated] = await ctx.db
        .update(tasks)
        .set(set)
        .where(eq(tasks.id, id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /**
   * Drag-and-drop persistence: move to (status, index). Idempotent — the same
   * input always converges to the same column ordering. On transition to
   * `done` with a linked contact, enqueue the D7 write-back post-response.
   */
  move: locationProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusEnum,
        index: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      const fromStatus = task.status;
      const toStatus = input.status;

      // Target column, excluding the moved task, in current order.
      const target = await ctx.db
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(
          and(
            eq(tasks.boardId, task.boardId),
            eq(tasks.status, toStatus),
            ne(tasks.id, task.id),
          ),
        )
        .orderBy(asc(tasks.position), asc(tasks.createdAt));

      const idx = Math.min(input.index ?? target.length, target.length);
      target.splice(idx, 0, { id: task.id, position: -1 });
      await ctx.db
        .update(tasks)
        .set({ status: toStatus, updatedAt: sql`now()` })
        .where(eq(tasks.id, task.id));
      await renumber(ctx.db, target);

      // Close the gap in the source column.
      if (fromStatus !== toStatus) {
        const source = await ctx.db
          .select({ id: tasks.id, position: tasks.position })
          .from(tasks)
          .where(
            and(
              eq(tasks.boardId, task.boardId),
              eq(tasks.status, fromStatus),
              ne(tasks.id, task.id),
            ),
          )
          .orderBy(asc(tasks.position), asc(tasks.createdAt));
        await renumber(ctx.db, source);
      }

      // D7: enqueue write-back on the transition into done. `after()` runs
      // post-response (never blocks the UI); the job itself is idempotent and
      // re-checks state, so a rolled-back tx or repeat call is harmless.
      if (
        toStatus === "done" &&
        fromStatus !== "done" &&
        task.contactId &&
        !task.completedWritebackAt
      ) {
        const { id } = task;
        const locationId = ctx.locationId;
        after(() => runContactWriteback(id, locationId));
      }

      return { id: task.id, status: toStatus, index: idx };
    }),

  /** Add/remove assignees (Stage 3). RLS pins everything to the session. */
  assign: locationProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        add: z.array(z.string().min(1).max(100)).default([]),
        remove: z.array(z.string().min(1).max(100)).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.add.length) {
        await ctx.db
          .insert(taskAssignees)
          .values(
            input.add.map((userId) => ({
              taskId: input.id,
              userId,
              locationId: ctx.locationId,
            })),
          )
          .onConflictDoNothing();
      }
      if (input.remove.length) {
        await ctx.db
          .delete(taskAssignees)
          .where(
            and(
              eq(taskAssignees.taskId, input.id),
              inArray(taskAssignees.userId, input.remove),
            ),
          );
      }
      const current = await ctx.db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, input.id));
      return { id: input.id, assigneeIds: current.map((c) => c.userId) };
    }),
});
