/**
 * Root tRPC router. Task/board/ghl routers are added in Stages 2–4. For
 * Stage 1 we expose a `system.whoami` proof that isolation + session work.
 */
import { createTRPCRouter, locationProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  system: createTRPCRouter({
    // Returns the session's location — proves the SSO -> session -> scoped-tx
    // chain end to end. location_id here comes only from the session.
    whoami: locationProcedure.query(({ ctx }) => ({
      locationId: ctx.locationId,
      userId: ctx.userId,
    })),
  }),
});

export type AppRouter = typeof appRouter;
