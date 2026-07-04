/**
 * tRPC setup + the isolation-enforcing middleware (plan §2, §7).
 *
 * `locationProcedure` is the ONLY procedure builder task routers use. It:
 *   1. requires a valid session (from the signed httpOnly cookie);
 *   2. opens a DB transaction and, inside it, downgrades to the non-superuser
 *      `spark_tasks_app` role and sets `app.location_id` to the SESSION's
 *      location via SET LOCAL — so RLS scopes every statement;
 *   3. hands the transaction-bound db (`ctx.db`) + `locationId`/`userId` to the
 *      resolver.
 *
 * location_id NEVER comes from client input — only from the session here.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { db as rootDb } from "~/server/db";
import { verifySessionToken, SESSION_COOKIE, type Session } from "~/server/auth/session";

/**
 * Context is built per request from the incoming headers (cookie).
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  const cookie = opts.headers.get("cookie") ?? "";
  const token = readCookie(cookie, SESSION_COOKIE);
  const session = verifySessionToken(token);
  return { session, rootDb };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

/**
 * Authenticated + tenant-scoped procedure. Everything task-related uses this.
 */
export const locationProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session: Session | null = ctx.session;
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "no_session" });
  }
  // Run the resolver inside a transaction scoped to this location. SET LOCAL is
  // rolled back at tx end, so scopes never leak between pooled connections.
  return ctx.rootDb.transaction(async (tx) => {
    await tx.execute(sql`set local role spark_tasks_app`);
    await tx.execute(
      sql`select set_config('app.location_id', ${session.locationId}, true)`,
    );
    return next({
      ctx: {
        db: tx,
        locationId: session.locationId,
        userId: session.userId,
      },
    });
  });
});

function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
