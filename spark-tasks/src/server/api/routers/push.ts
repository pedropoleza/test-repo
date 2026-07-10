import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { pushSubscriptions } from "~/server/db/schema";
import { env } from "~/env";

/**
 * Web Push subscription management. The subscription is created by the
 * top-level opt-in page (/enable-alerts) — same origin, so the SSO session
 * cookie rides along and scopes it to the location + user.
 */
export const pushRouter = createTRPCRouter({
  /** VAPID public key the client subscribes with (null = push disabled). */
  publicKey: locationProcedure.query(() => env.VAPID_PUBLIC_KEY ?? null),

  subscribe: locationProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1000),
        p256dh: z.string().min(1).max(500),
        auth: z.string().min(1).max(500),
        userAgent: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          locationId: ctx.locationId,
          userId: ctx.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            locationId: ctx.locationId,
            userId: ctx.userId,
            p256dh: input.p256dh,
            auth: input.auth,
            lastSeenAt: sql`now()`,
          },
        });
      return { ok: true };
    }),

  unsubscribe: locationProcedure
    .input(z.object({ endpoint: z.string().url().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.userId),
          ),
        );
      return { ok: true };
    }),
});
