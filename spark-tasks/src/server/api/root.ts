/**
 * Root tRPC router — the full V1 surface (plan §7).
 */
import { createTRPCRouter, locationProcedure } from "./trpc";
import { boardRouter } from "./routers/board";
import { taskRouter } from "./routers/task";
import { ghlRouter } from "./routers/ghl";

export const appRouter = createTRPCRouter({
  board: boardRouter,
  task: taskRouter,
  ghl: ghlRouter,
  system: createTRPCRouter({
    // Session probe: proves SSO -> session -> scoped-tx and gives the client
    // its location id for display/deep-links. Always session-derived.
    whoami: locationProcedure.query(({ ctx }) => ({
      locationId: ctx.locationId,
      userId: ctx.userId,
    })),
  }),
});

export type AppRouter = typeof appRouter;
