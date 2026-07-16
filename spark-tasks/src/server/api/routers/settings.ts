import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { locationSettings } from "~/server/db/schema";

/**
 * Per-location settings. `ghlSyncEnabled` controls whether GoHighLevel native
 * tasks are pulled into this location's board. Any user in the location can
 * read/change it (settings are location-level, matching the shared board).
 */
export const settingsRouter = createTRPCRouter({
  get: locationProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(locationSettings)
      .where(eq(locationSettings.locationId, ctx.locationId))
      .limit(1);
    return { ghlSyncEnabled: row ? row.ghlSyncEnabled : true };
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
});
