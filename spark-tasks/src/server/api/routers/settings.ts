import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { locationSettings, userBoardRouting, boards } from "~/server/db/schema";

/**
 * Per-location settings:
 *  - ghlSyncEnabled: pull GoHighLevel native tasks into this board.
 *  - calendarSyncEnabled: show tasks as to-dos on the GHL calendar.
 *  - userRouting: per-user default pipeline (board) for auto-created tasks.
 * Settings are location-level (shared board), so any user in the location can
 * read/change them.
 */
export const settingsRouter = createTRPCRouter({
  get: locationProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(locationSettings)
      .where(eq(locationSettings.locationId, ctx.locationId))
      .limit(1);
    return {
      ghlSyncEnabled: row ? row.ghlSyncEnabled : true,
      calendarSyncEnabled: row ? row.calendarSyncEnabled : false,
    };
  }),

  setGhlSync: locationProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(locationSettings)
        .values({ locationId: ctx.locationId, ghlSyncEnabled: input.enabled })
        .onConflictDoUpdate({
          target: locationSettings.locationId,
          set: { ghlSyncEnabled: input.enabled, updatedAt: sql`now()` },
        });
      return { ghlSyncEnabled: input.enabled };
    }),

  setCalendarSync: locationProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(locationSettings)
        .values({
          locationId: ctx.locationId,
          calendarSyncEnabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: locationSettings.locationId,
          set: { calendarSyncEnabled: input.enabled, updatedAt: sql`now()` },
        });
      return { calendarSyncEnabled: input.enabled };
    }),

  // ---- Per-user pipeline routing ----
  userRouting: createTRPCRouter({
    list: locationProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select({
          userId: userBoardRouting.userId,
          boardId: userBoardRouting.boardId,
        })
        .from(userBoardRouting)
        .where(eq(userBoardRouting.locationId, ctx.locationId));
    }),

    set: locationProcedure
      .input(
        z.object({
          userId: z.string().trim().min(1).max(100),
          boardId: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Board must belong to this location (RLS also enforces it).
        const [b] = await ctx.db
          .select({ id: boards.id })
          .from(boards)
          .where(
            and(
              eq(boards.id, input.boardId),
              eq(boards.locationId, ctx.locationId),
            ),
          )
          .limit(1);
        if (!b) throw new TRPCError({ code: "BAD_REQUEST", message: "board" });

        await ctx.db
          .insert(userBoardRouting)
          .values({
            locationId: ctx.locationId,
            userId: input.userId,
            boardId: input.boardId,
          })
          .onConflictDoUpdate({
            target: [userBoardRouting.locationId, userBoardRouting.userId],
            set: { boardId: input.boardId, updatedAt: sql`now()` },
          });
        return { ok: true };
      }),

    remove: locationProcedure
      .input(z.object({ userId: z.string().trim().min(1).max(100) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(userBoardRouting)
          .where(
            and(
              eq(userBoardRouting.locationId, ctx.locationId),
              eq(userBoardRouting.userId, input.userId),
            ),
          );
        return { ok: true };
      }),
  }),
});
