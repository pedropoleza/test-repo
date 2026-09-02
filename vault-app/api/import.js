/**
 * POST /api/import — importador administrativo (TEMPORÁRIO, protegido por CRON_SECRET).
 *
 * Dois modos no mesmo body:
 *  - templates: [{ name, mime, base64 }]  → guarda PDFs numa "pasta" do Cofre
 *    (contact_id '__templates__', contact_name 'Templates — Latino USA').
 *  - contacts:  [{ firstName, lastName, name, phone, tags[], note }] → upsert no
 *    GHL (dedup por telefone/nome) + nota. Sem oportunidade/pipeline.
 *
 * Processa em lote pequeno por request (o chamador manda em chunks).
 */
import { randomUUID } from "node:crypto";
import { sql } from "../lib/db.js";
import { getVaultLocationToken } from "../lib/ghl-token.js";

export const config = { maxDuration: 60 };

const BASE = "https://services.leadconnectorhq.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if ((req.headers["x-cron-secret"] || req.query?.s) !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method_not_allowed" }); }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const locationId = body.locationId;
  if (!locationId) return res.status(400).json({ error: "missing_location" });

  const out = {};

  // ---- Templates → Cofre ----
  if (Array.isArray(body.templates) && body.templates.length) {
    let stored = 0;
    for (const t of body.templates) {
      try {
        const buf = Buffer.from(t.base64, "base64");
        await sql()`
          insert into document_vault.documents
            (location_id, contact_id, contact_name, source, source_ref, contact_resolution,
             filename, mime, size_bytes, status, content, created_at_ghl)
          values
            (${locationId}, '__templates__', 'Templates — Latino USA', 'upload', ${"tpl:" + t.name},
             'manual', ${t.name}, ${t.mime || "application/pdf"}, ${buf.length}, 'mirrored', ${buf}, now())
          on conflict (location_id, source, source_ref) do nothing`;
        stored++;
      } catch (err) { console.warn("[import] template failed:", t.name, err.message); }
    }
    out.templates = { received: body.templates.length, stored };
  }

  // ---- Contacts → GHL (upsert + nota) ----
  if (Array.isArray(body.contacts) && body.contacts.length) {
    let token;
    try { token = await getVaultLocationToken(locationId); }
    catch (err) { return res.status(502).json({ error: "ghl_token", reason: err.message }); }

    const results = [];
    for (const c of body.contacts) {
      try {
        const payload = {
          locationId,
          firstName: c.firstName || undefined,
          lastName: c.lastName || undefined,
          name: c.name || undefined,
          phone: c.phone || undefined,
          tags: c.tags && c.tags.length ? c.tags : undefined,
          source: c.source || "Import — Latino USA",
        };
        const r = await fetch(`${BASE}/contacts/upsert`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        const contactId = j.contact?.id || j.id;
        if (!r.ok || !contactId) { results.push({ name: c.name, ok: false, status: r.status, err: (j.message || "").toString().slice(0, 120) }); await sleep(120); continue; }

        if (c.note) {
          await fetch(`${BASE}/contacts/${contactId}/notes`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ body: c.note }),
          }).catch(() => {});
        }
        results.push({ name: c.name, ok: true, id: contactId, new: j.new ?? null });
        await sleep(120);
      } catch (err) { results.push({ name: c.name, ok: false, err: String(err.message || err).slice(0, 120) }); }
    }
    out.contacts = {
      received: body.contacts.length,
      ok: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      sample_fail: results.filter((x) => !x.ok).slice(0, 5),
    };
  }

  return res.status(200).json({ ok: true, ...out });
}
