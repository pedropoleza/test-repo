import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, locationProcedure } from "../trpc";
import {
  getLocationUsers,
  searchContacts,
  getContact,
  getContactsByIds,
  getConversationId,
  getPipelines,
} from "~/server/ghl/api";
import { ghlContactUrl, ghlConversationUrl } from "~/lib/ghl-app";

/**
 * GHL-facing queries. Always scoped to the SESSION's location — the client
 * cannot ask about any other location. Errors are mapped to a stable code the
 * UI can render ("connect the app") without leaking API details.
 */
function mapGhlError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "unknown";
  if (
    msg.includes("not_installed") ||
    msg.includes("agency_not_installed") ||
    msg.includes("no_refresh_token")
  ) {
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

  /** Pipelines + stages, for the call-disposition "move opportunity" picker. */
  pipelines: locationProcedure.query(async ({ ctx }) => {
    try {
      return await getPipelines(ctx.locationId);
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

  /**
   * Resolve many linked contacts in one request (card chips for the whole
   * board). Server-side cache + bounded concurrency, so a board full of
   * contact-linked cards costs one round-trip instead of one per card.
   * Returns a record of found contacts keyed by id (missing ids are absent).
   */
  contactsBatch: locationProcedure
    .input(z.object({ ids: z.array(z.string().min(1).max(100)).max(300) }))
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0)
        return {} as Record<
          string,
          { id: string; name: string; photoUrl?: string }
        >;
      try {
        const map = await getContactsByIds(ctx.locationId, input.ids);
        const out: Record<
          string,
          { id: string; name: string; photoUrl?: string }
        > = {};
        for (const [id, c] of map) {
          if (c) out[id] = { id: c.id, name: c.name, photoUrl: c.photoUrl };
        }
        return out;
      } catch (err) {
        mapGhlError(err);
      }
    }),

  /**
   * Deep link to the client's conversation. Resolves the conversation id when
   * possible; otherwise falls back to the contact page so the button always
   * lands somewhere useful. locationId is server-derived from the session.
   */
  conversationUrl: locationProcedure
    .input(z.object({ contactId: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      try {
        const convId = await getConversationId(ctx.locationId, input.contactId);
        if (convId) {
          return { url: ghlConversationUrl(ctx.locationId, convId) };
        }
      } catch {
        // scope missing / no conversation — fall back below
      }
      return { url: ghlContactUrl(ctx.locationId, input.contactId) };
    }),
});
