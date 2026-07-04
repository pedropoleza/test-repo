import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import { getLocationUsers, searchContacts, getContact } from "~/server/ghl/api";

/**
 * GHL-facing queries. Always scoped to the SESSION's location — the client
 * cannot ask about any other location. Errors are mapped to a stable code the
 * UI can render ("connect the app") without leaking API details.
 */
function mapGhlError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "unknown";
  if (msg.includes("agency_not_installed") || msg.includes("no_refresh_token")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ghl_not_connected",
    });
  }
  console.error(`[ghl] ${msg}`);
  throw new TRPCError({ code: "BAD_GATEWAY", message: "ghl_unavailable" });
}

export const ghlRouter = createTRPCRouter({
  users: locationProcedure.query(async ({ ctx }) => {
    try {
      return await getLocationUsers(ctx.locationId);
    } catch (err) {
      mapGhlError(err);
    }
  }),

  contactsSearch: locationProcedure
    .input(z.object({ query: z.string().trim().min(2).max(200) }))
    .query(async ({ ctx, input }) => {
      try {
        return await searchContacts(ctx.locationId, input.query);
      } catch (err) {
        mapGhlError(err);
      }
    }),

  /** Resolve a linked contact's display data (card chip / modal). */
  contactGet: locationProcedure
    .input(z.object({ contactId: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getContact(ctx.locationId, input.contactId);
      } catch (err) {
        mapGhlError(err);
      }
    }),
});
