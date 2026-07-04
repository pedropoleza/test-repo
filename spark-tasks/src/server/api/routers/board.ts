import { eq, asc } from "drizzle-orm";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { boards } from "~/server/db/schema";

/**
 * V1: exactly one default board per location, lazily created on first load.
 * `ctx.db` is the RLS-scoped transaction, so both the select and the insert
 * are pinned to the session's location.
 */
export const boardRouter = createTRPCRouter({
  get: locationProcedure.query(async ({ ctx }) => {
    const [existing] = await ctx.db
      .select()
      .from(boards)
      .where(eq(boards.locationId, ctx.locationId))
      .orderBy(asc(boards.createdAt))
      .limit(1);
    if (existing) return existing;

    const [created] = await ctx.db
      .insert(boards)
      .values({ locationId: ctx.locationId })
      .returning();
    if (!created) throw new Error("board_create_failed");
    return created;
  }),
});
