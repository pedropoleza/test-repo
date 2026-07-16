/**
 * Root tRPC router — the full V1 surface (plan §7).
 */
import { createTRPCRouter, locationProcedure } from "./trpc";
import { boardRouter } from "./routers/board";
import { taskRouter } from "./routers/task";
import { ghlRouter } from "./routers/ghl";
import { notificationsRouter } from "./routers/notifications";
import { pushRouter } from "./routers/push";
import { settingsRouter } from "./routers/settings";
import { locationRequiresOwner } from "~/server/config";

export const appRouter = createTRPCRouter({
  board: boardRouter,
  task: taskRouter,
  ghl: ghlRouter,
  notifications: notificationsRouter,
  push: pushRouter,
  settings: settingsRouter,
  system: createTRPCRouter({
    // Session probe: proves SSO -> session -> scoped-tx and gives the client
    // its location id for display/deep-links. Always session-derived.
    whoami: locationProcedure.query(({ ctx }) => ({
      locationId: ctx.locationId,
      userId: ctx.userId,
      requiresOwner: locationRequiresOwner(ctx.locationId),
    })),
  }),
});

export type AppRouter = typeof appRouter;
