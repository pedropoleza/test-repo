/**
 * Base URL of the CRM UI users should be sent to (contact pages, conversations,
 * dashboard). This is the agency's WHITE-LABEL GHL domain — never the raw
 * app.gohighlevel.com — so redirects land in the client's own branded CRM.
 *
 * Overridable per deployment via NEXT_PUBLIC_GHL_APP_BASE_URL (inlined for the
 * client and readable on the server), defaulting to Spark's white-label domain.
 */
export const GHL_APP_BASE = (
  process.env.NEXT_PUBLIC_GHL_APP_BASE_URL ?? "https://app.sparkleads.pro"
).replace(/\/+$/, "");

/** `.../v2/location/{locationId}` — the per-location root in the CRM. */
export function ghlLocationBase(locationId: string): string {
  return `${GHL_APP_BASE}/v2/location/${locationId}`;
}

/** Deep link to a contact's detail page. */
export function ghlContactUrl(locationId: string, contactId: string): string {
  return `${ghlLocationBase(locationId)}/contacts/detail/${contactId}`;
}

/** Deep link to a conversation. */
export function ghlConversationUrl(locationId: string, convId: string): string {
  return `${ghlLocationBase(locationId)}/conversations/conversations/${convId}`;
}

/** Location dashboard (fallback when there's no contact to open). */
export function ghlDashboardUrl(locationId: string): string {
  return `${ghlLocationBase(locationId)}/dashboard`;
}
