import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { notifications } from "~/server/db/schema";

/**
 * In-app notifications for the current user. RLS scopes rows to the location;
 * we additionally filter to the session's user (own inbox). All users of a
 * location can see all tasks (D6), but notifications are personal.
 */
export const notificationsRouter = createTRPCRouter({
  list: locationProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(30),
  ),

  unreadCount: locationProcedure.query(async ({ ctx }) => {
    const [row] = (await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          isNull(notifications.readAt),
        ),
      )) as [{ count: number }];
    return row?.count ?? 0;
  }),

  markRead: locationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.id, input.id),
            eq(notifications.userId, ctx.userId),
          ),
        );
      return { ok: true };
    }),

  markAllRead: locationProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  }),
});
