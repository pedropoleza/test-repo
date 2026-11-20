/**
 * GHL Private Integration Token (PIT) client — scoped to ONE subaccount.
 *
 * The Marketplace OAuth app doesn't carry the scopes needed to send messages or
 * upload media, so WhatsApp delivery uses a sub-account Private Integration
 * Token instead (same approach as the Soraia metrics app). Today this is wired
 * for Sabrina's location only, via env:
 *   SABRINA_GHL_PIT        — the pit-... token
 *   SABRINA_WA_LOCATION_ID — the location the token belongs to
 *   SABRINA_WA_USER_ID     — the GHL user whose profile phone receives the PDF
 *
 * Nothing here is logged; the token never leaves the server.
 */
const GHL = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

function cfg() {
  return {
    pit: process.env.SABRINA_GHL_PIT ?? "",
    locationId: process.env.SABRINA_WA_LOCATION_ID ?? "",
    userId: process.env.SABRINA_WA_USER_ID ?? "",
  };
}

/** Whether PIT-based WhatsApp is configured for this location. */
export function waConfiguredFor(locationId: string): boolean {
  const c = cfg();
  return !!c.pit && !!c.locationId && locationId === c.locationId;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg().pit}`,
    Version: VERSION,
    Accept: "application/json",
  };
}

async function readError(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  return `ghl_${res.status}: ${t.slice(0, 200)}`;
}

/** The phone saved on a GHL user's profile (E.164), or null. */
export async function getUserPhone(userId: string): Promise<string | null> {
  const res = await fetch(`${GHL}/users/${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { phone?: string };
  const phone = data.phone?.trim();
  return phone || null;
}

/**
 * Find-or-create a contact for a phone number; returns the contact id. We send
 * only the phone (no name) so an existing contact is matched without its name
 * being overwritten; a brand-new contact is created keyed on the number.
 */
export async function upsertContactByPhone(
  locationId: string,
  phone: string,
): Promise<string> {
  const res = await fetch(`${GHL}/contacts/upsert`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ locationId, phone }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { contact?: { id?: string } };
  const id = data.contact?.id;
  if (!id) throw new Error("ghl_upsert_no_contact_id");
  return id;
}

/** Upload a file to the GHL media library; returns its public URL. */
export async function uploadMedia(
  locationId: string,
  bytes: Uint8Array,
  filename: string,
  contentType = "application/pdf",
): Promise<string> {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([bytes as unknown as BlobPart], { type: contentType }),
    filename,
  );
  fd.append("locationId", locationId);
  const res = await fetch(`${GHL}/medias/upload-file`, {
    method: "POST",
    headers: authHeaders(), // let fetch set the multipart boundary
    body: fd,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("ghl_upload_no_url");
  return data.url;
}

/** Send a WhatsApp message (optionally with attachment URLs) to a contact. */
export async function sendWhatsapp(
  contactId: string,
  message: string,
  attachments: string[],
): Promise<string> {
  const res = await fetch(`${GHL}/conversations/messages`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "WhatsApp", contactId, message, attachments }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { messageId?: string };
  return data.messageId ?? "";
}

/**
 * Deliver a task PDF by WhatsApp to the configured user's own number.
 * Returns the GHL message id. Throws with a safe reason on any failure.
 */
export async function sendTaskPdfToConfiguredUser(opts: {
  locationId: string;
  pdf: Uint8Array;
  filename: string;
  message: string;
}): Promise<string> {
  const c = cfg();
  if (!waConfiguredFor(opts.locationId)) throw new Error("wa_not_configured");
  if (!c.userId) throw new Error("wa_user_not_set");

  const phone = await getUserPhone(c.userId);
  if (!phone) throw new Error("user_has_no_phone");

  const contactId = await upsertContactByPhone(opts.locationId, phone);
  const url = await uploadMedia(opts.locationId, opts.pdf, opts.filename);
  return sendWhatsapp(contactId, opts.message, [url]);
}
