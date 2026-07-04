import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import {
  boards,
  tasks,
  taskAssignees,
  taskComments,
  TASK_STATUSES,
  TASK_COLORS,
  TASK_PRIORITIES,
  CARD_STYLES,
} from "~/server/db/schema";
import { runContactWriteback } from "~/server/ghl/writeback";

const statusEnum = z.enum(TASK_STATUSES);
const colorEnum = z.enum(TASK_COLORS);
const priorityEnum = z.enum(TASK_PRIORITIES);
const cardStyleEnum = z.enum(CARD_STYLES);
const labelsSchema = z.array(z.string().trim().min(1).max(30)).max(10);
const checklistSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(40),
      text: z.string().trim().min(1).max(500),
      done: z.boolean(),
    }),
  )
  .max(50);

type Db = Parameters<Parameters<typeof locationProcedure.query>[0]>[0]["ctx"]["db"];

/**
 * Resolve the target board: an explicit id is verified to exist in this
 * location (RLS scopes the read); otherwise the default board is used
 * (lazily created).
 */
async function getBoardId(
  db: Db,
  locationId: string,
  boardId?: string,
): Promise<string> {
  if (boardId) {
    const [b] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);
    if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "board" });
    return b.id;
  }
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
          boardId: z.string().uuid().optional(),
          status: statusEnum.optional(),
          assigneeId: z.string().optional(),
          contactId: z.string().optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(tasks.locationId, ctx.locationId)];
      if (input?.boardId) filters.push(eq(tasks.boardId, input.boardId));
      if (!input?.includeArchived) filters.push(isNull(tasks.archivedAt));
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
        boardId: z.string().uuid().optional(),
        title: z.string().trim().min(1).max(500),
        note: z.string().max(10_000).nullish(),
        status: statusEnum.default("todo"),
        color: colorEnum.default("gray"),
        cardStyle: cardStyleEnum.default("strip"),
        priority: priorityEnum.default("none"),
        labels: labelsSchema.default([]),
        dueDate: z.date().nullish(),
        contactId: z.string().max(100).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await getBoardId(ctx.db, ctx.locationId, input.boardId);
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
          cardStyle: input.cardStyle,
          priority: input.priority,
          labels: input.labels,
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
        cardStyle: cardStyleEnum.optional(),
        priority: priorityEnum.optional(),
        labels: labelsSchema.optional(),
        checklist: checklistSchema.optional(),
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
      if (patch.cardStyle !== undefined) set.cardStyle = patch.cardStyle;
      if (patch.priority !== undefined) set.priority = patch.priority;
      if (patch.labels !== undefined) set.labels = patch.labels;
      if (patch.checklist !== undefined) set.checklist = patch.checklist;
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

  /** Archive (soft delete) / restore. Archived tasks leave the board. */
  setArchived: locationProcedure
    .input(z.object({ id: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(tasks)
        .set({
          archivedAt: input.archived ? sql`now()` : null,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, input.id))
        .returning({ id: tasks.id, archivedAt: tasks.archivedAt });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  /** Hard delete (assignees + comments cascade). */
  delete: locationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(tasks)
        .where(eq(tasks.id, input.id))
        .returning({ id: tasks.id });
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return deleted;
    }),

  /** Duplicate a task (fields + assignees; comments stay behind). */
  duplicate: locationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [src] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });

      const [{ count }] = (await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.boardId, src.boardId), eq(tasks.status, src.status)))) as [
        { count: number },
      ];

      const [copy] = await ctx.db
        .insert(tasks)
        .values({
          locationId: ctx.locationId,
          boardId: src.boardId,
          title: `${src.title} (cópia)`,
          note: src.note,
          status: src.status,
          color: src.color,
          cardStyle: src.cardStyle,
          priority: src.priority,
          labels: src.labels,
          // Reset done-state of checklist items on the copy.
          checklist: src.checklist.map((c) => ({ ...c, done: false })),
          dueDate: src.dueDate,
          contactId: src.contactId,
          position: count,
          createdBy: ctx.userId,
        })
        .returning();
      if (!copy) throw new Error("task_duplicate_failed");

      const srcAssignees = await ctx.db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, src.id));
      if (srcAssignees.length) {
        await ctx.db
          .insert(taskAssignees)
          .values(
            srcAssignees.map((a) => ({
              taskId: copy.id,
              userId: a.userId,
              locationId: ctx.locationId,
            })),
          )
          .onConflictDoNothing();
      }
      return copy;
    }),

  /**
   * Bulk actions over selected tasks (kanban multi-select / list view).
   * Everything runs in the same RLS-scoped tx; done-transitions enqueue the
   * D7 write-back per task, same as single move.
   */
  bulkUpdate: locationProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(100),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        color: colorEnum.optional(),
        archived: z.boolean().optional(),
        addAssigneeIds: z.array(z.string().min(1).max(100)).max(20).optional(),
        removeAssigneeIds: z
          .array(z.string().min(1).max(100))
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, input.ids));
      if (!rows.length) return { updated: 0 };

      const set: Record<string, unknown> = { updatedAt: sql`now()` };
      if (input.status !== undefined) set.status = input.status;
      if (input.priority !== undefined) set.priority = input.priority;
      if (input.color !== undefined) set.color = input.color;
      if (input.archived !== undefined) {
        set.archivedAt = input.archived ? sql`now()` : null;
      }
      if (Object.keys(set).length > 1) {
        await ctx.db
          .update(tasks)
          .set(set)
          .where(inArray(tasks.id, rows.map((r) => r.id)));
      }

      if (input.addAssigneeIds?.length) {
        await ctx.db
          .insert(taskAssignees)
          .values(
            rows.flatMap((r) =>
              input.addAssigneeIds!.map((userId) => ({
                taskId: r.id,
                userId,
                locationId: ctx.locationId,
              })),
            ),
          )
          .onConflictDoNothing();
      }
      if (input.removeAssigneeIds?.length) {
        await ctx.db
          .delete(taskAssignees)
          .where(
            and(
              inArray(taskAssignees.taskId, rows.map((r) => r.id)),
              inArray(taskAssignees.userId, input.removeAssigneeIds),
            ),
          );
      }

      // D7 write-back for tasks that just transitioned into done.
      if (input.status === "done") {
        const locationId = ctx.locationId;
        for (const r of rows) {
          if (r.status !== "done" && r.contactId && !r.completedWritebackAt) {
            const id = r.id;
            after(() => runContactWriteback(id, locationId));
          }
        }
      }
      return { updated: rows.length };
    }),

  bulkDelete: locationProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(tasks)
        .where(inArray(tasks.id, input.ids))
        .returning({ id: tasks.id });
      return { deleted: deleted.length };
    }),

  comments: createTRPCRouter({
    list: locationProcedure
      .input(z.object({ taskId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        ctx.db
          .select()
          .from(taskComments)
          .where(eq(taskComments.taskId, input.taskId))
          .orderBy(asc(taskComments.createdAt)),
      ),

    add: locationProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          body: z.string().trim().min(1).max(4000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Ensure the task exists in this location (RLS scopes the read).
        const [task] = await ctx.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .limit(1);
        if (!task) throw new TRPCError({ code: "NOT_FOUND" });

        const [created] = await ctx.db
          .insert(taskComments)
          .values({
            taskId: input.taskId,
            locationId: ctx.locationId,
            authorId: ctx.userId,
            body: input.body,
          })
          .returning();
        return created!;
      }),

    /** Authors can remove their own comments. */
    remove: locationProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [deleted] = await ctx.db
          .delete(taskComments)
          .where(
            and(
              eq(taskComments.id, input.id),
              eq(taskComments.authorId, ctx.userId),
            ),
          )
          .returning({ id: taskComments.id });
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
        return deleted;
      }),
  }),
});
