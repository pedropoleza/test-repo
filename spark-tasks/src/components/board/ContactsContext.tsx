"use client";

/**
 * Board-wide contact resolution. The board resolves every linked contact in a
 * single batched request and shares the result here, so each card's contact
 * chip reads from memory instead of firing its own GHL lookup. Cards outside a
 * provider (or ids the batch didn't cover) fall back to an individual query.
 */
import { createContext, useContext } from "react";

export type MiniContact = { id: string; name: string; photoUrl?: string };

export type ContactsCtxValue = {
  /** Found contacts, keyed by id. */
  contacts: Record<string, MiniContact>;
  /** Ids the board asked the batch to resolve (found or not). */
  requestedIds: Set<string>;
  /** Batch request in flight — hold off individual fallbacks until it settles. */
  pending: boolean;
};

export const ContactsContext = createContext<ContactsCtxValue | null>(null);

export function useContactsCtx() {
  return useContext(ContactsContext);
}
