import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { notifications } from "~/server/db/schema";
import { sendPushToUser } from "~/server/push";

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

  /**
   * Self-test: creates a notification for the CURRENT user (in-app pop-up)
   * and fires a desktop push to their subscriptions. One-click diagnosis of
   * the whole alert pipeline.
   */
  test: locationProcedure.mutation(async ({ ctx }) => {
    await ctx.db.insert(notifications).values({
      locationId: ctx.locationId,
      userId: ctx.userId,
      type: "test",
      title: "Test notification",
      body: "If you can see this pop-up, in-app alerts work.",
      actorId: null,
    });
    const { locationId, userId } = ctx;
    after(() =>
      sendPushToUser(locationId, userId, {
        title: "Spark Tasks — test alert",
        body: "Desktop alerts are working.",
        tag: "self-test",
      }),
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
