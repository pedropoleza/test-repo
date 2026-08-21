/**
 * GET /api/contacts?q=<busca> — busca contatos reais da location no GHL.
 *
 * Usado pelo modal "Nova pasta de contato" para selecionar o contato ao qual a
 * pasta (e os arquivos) pertence. Auth: JWT da sessão (escopo por location).
 */
import { verify as jwtVerify } from "../lib/jwt.js";
import { getVaultLocationToken } from "../lib/ghl-token.js";

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

  const q = (req.query?.q || "").trim();

  let ghlToken;
  try { ghlToken = await getVaultLocationToken(locationId); }
  catch (err) { return res.status(502).json({ error: "ghl_token", reason: err.message }); }

  try {
    const url = new URL("https://services.leadconnectorhq.com/contacts/");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("limit", "20");
    if (q) url.searchParams.set("query", q);
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${ghlToken}`, Version: "2021-07-28", Accept: "application/json" },
    });
    if (!r.ok) return res.status(502).json({ error: "ghl_contacts", status: r.status });
    const j = await r.json();
    const contacts = (j.contacts || []).map((c) => ({
      id: c.id,
      name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || c.id,
      email: c.email || null,
      phone: c.phone || null,
    }));
    return res.status(200).json({ contacts });
  } catch (err) {
    console.error("[contacts] failed:", err.message || err);
    return res.status(500).json({ error: "contacts_failed" });
  }
}
