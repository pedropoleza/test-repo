/**
 * GET /api/contact-data?id=<contactId> — dados de um contato para preencher
 * um template (merge fields). Auth: JWT da sessão (escopo por location).
 *
 * Retorna um mapa achatado de tokens já resolvidos:
 *   { tokens: { "contact.full_name": "...", "contact.address1": "...",
 *               "custom.<fieldKey>": "...", "today": "YYYY-MM-DD" },
 *     contact: { id, name, email, phone } }
 *
 * Os custom fields são resolvidos pelo `fieldKey` da location (ex.:
 * "contact.policy_number" → token "custom.policy_number").
 */
import { verify as jwtVerify } from "../lib/jwt.js";
import { getVaultLocationToken } from "../lib/ghl-token.js";

const BASE = "https://services.leadconnectorhq.com";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const token = req.headers["x-vault-session"] || req.query?.session;
  if (!token) return res.status(401).json({ error: "missing_session" });
  let claims;
  try { claims = jwtVerify(token); } catch (err) { return res.status(401).json({ error: "invalid_session", reason: err.message }); }
  const locationId = claims.locationId;
  if (!locationId) return res.status(403).json({ error: "no_location" });

  const contactId = (req.query?.id || "").trim();
  if (!contactId) return res.status(400).json({ error: "missing_id" });

  let ghlToken;
  try { ghlToken = await getVaultLocationToken(locationId); }
  catch (err) { return res.status(502).json({ error: "ghl_token", reason: err.message }); }

  const H = { Authorization: `Bearer ${ghlToken}`, Version: "2021-07-28", Accept: "application/json" };

  try {
    const cr = await fetch(`${BASE}/contacts/${encodeURIComponent(contactId)}`, { headers: H });
    if (!cr.ok) return res.status(502).json({ error: "ghl_contact", status: cr.status });
    const c = (await cr.json()).contact || {};

    const fullName = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "";
    const tokens = {
      "contact.full_name": fullName,
      "contact.first_name": c.firstName || "",
      "contact.last_name": c.lastName || "",
      "contact.address1": c.address1 || c.address || "",
      "contact.city": c.city || "",
      "contact.state": c.state || "",
      "contact.postal_code": c.postalCode || "",
      "contact.country": c.country || "",
      "contact.phone": c.phone || "",
      "contact.email": c.email || "",
      "contact.date_of_birth": c.dateOfBirth || c.dob || "",
      "contact.company_name": c.companyName || "",
      "today": new Date().toISOString().slice(0, 10),
      "user.name": "",
    };

    // Resolve custom fields via definições da location (fieldKey → valor).
    const cf = Array.isArray(c.customFields) ? c.customFields : (Array.isArray(c.customField) ? c.customField : []);
    if (cf.length) {
      let defs = [];
      try {
        const dr = await fetch(`${BASE}/locations/${locationId}/customFields`, { headers: H });
        if (dr.ok) defs = (await dr.json()).customFields || [];
      } catch { /* best-effort */ }
      const byId = {};
      for (const d of defs) {
        const key = (d.fieldKey || d.name || "").replace(/^contact\./, "");
        if (d.id && key) byId[d.id] = key;
      }
      for (const f of cf) {
        const key = byId[f.id] || f.id;
        const val = f.value ?? f.field_value ?? f.fieldValue ?? "";
        if (key != null) tokens[`custom.${key}`] = Array.isArray(val) ? val.join(", ") : String(val ?? "");
      }
    }

    return res.status(200).json({
      contact: { id: c.id || contactId, name: fullName, email: c.email || null, phone: c.phone || null },
      tokens,
    });
  } catch (err) {
    console.error("[contact-data] failed:", err.message || err);
    return res.status(500).json({ error: "contact_data_failed" });
  }
}
