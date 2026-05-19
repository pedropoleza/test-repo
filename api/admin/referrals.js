/**
 * /api/admin/referrals
 *
 * Endpoint pro painel /admin (interno Spark). Permite Spark team
 * registrar manualmente uma indicação que aconteceu fora do checkout
 * automático (ou pra ajustar/criar dados de pre-evento).
 *
 * Auth: precisa do header `x-spark-admin-key` (ou cookie spark_admin_key)
 * que bate com ADMIN_URL_SECRET. URL secreta = segurança principal.
 *
 * Métodos:
 *   GET    ?indicador=<locationId>  → lista referrals de um indicador
 *   GET    (sem query)              → lista últimas 50 referrals
 *   POST   { indicador_location, indicado_email, indicado_name,
 *            tier_purchased?, cupom_code?, activation_paid?, status? }
 *          → cria referral + recomputa tier do indicador
 *   PATCH  { id, ...campos }        → edita
 *   DELETE ?id=<uuid>               → remove (cuidado)
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";
import { log } from "../../lib/server/log.js";

function parseCookies(req) {
  const cookie = req.headers?.cookie || "";
  const obj = {};
  cookie.split(";").forEach((p) => {
    const [k, ...v] = p.trim().split("=");
    if (k) obj[k] = decodeURIComponent(v.join("=") || "");
  });
  return obj;
}

function checkAdminKey(req) {
  const expected = process.env.ADMIN_URL_SECRET;
  if (!expected) return false;
  const cookies = parseCookies(req);
  const provided =
    req.headers["x-spark-admin-key"] ||
    cookies["spark_admin_key"] ||
    req.query?.k;
  if (!provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!checkAdminKey(req)) {
    return res.status(404).json({ error: "not_found" }); // 404 ao invés de 401 pra obscurity
  }

  if (req.method === "GET") return listReferrals(req, res);
  if (req.method === "POST") return createReferral(req, res);
  if (req.method === "PATCH") return updateReferral(req, res);
  if (req.method === "DELETE") return deleteReferral(req, res);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
}

async function listReferrals(req, res) {
  const indicador = req.query?.indicador
    ? String(req.query.indicador).slice(0, 40)
    : null;
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));

  let q = db()
    .from("referrals")
    .select(
      "id, indicador_location, indicado_email, indicado_name, " +
        "tier_purchased, cupom_code, activation_paid, status, " +
        "first_payment_at, qualified_at, disqualified_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (indicador) q = q.eq("indicador_location", indicador);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  return res.status(200).json({ referrals: data || [] });
}

async function createReferral(req, res) {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const indicadorLocation = String(body.indicador_location || "").trim();
  if (!indicadorLocation || !/^[A-Za-z0-9]{15,30}$/.test(indicadorLocation)) {
    return res.status(400).json({ error: "invalid_indicador_location" });
  }

  // Confirma que indicador existe em installations
  const { data: install, error: instErr } = await db()
    .from("installations")
    .select("location_id, location_name")
    .eq("location_id", indicadorLocation)
    .maybeSingle();
  if (instErr) return res.status(500).json({ error: "db_error", detail: instErr.message });
  if (!install) {
    return res.status(404).json({
      error: "indicador_not_found",
      message: "Essa location não está provisionada.",
    });
  }

  const indicadoEmail = String(body.indicado_email || "").trim().toLowerCase();
  if (!indicadoEmail || !/^\S+@\S+\.\S+$/.test(indicadoEmail)) {
    return res.status(400).json({ error: "invalid_indicado_email" });
  }
  const indicadoName = String(body.indicado_name || "").trim().slice(0, 200);
  if (!indicadoName) return res.status(400).json({ error: "missing_indicado_name" });

  const tier = body.tier_purchased
    ? String(body.tier_purchased).toLowerCase()
    : null;
  if (tier && !["starter", "growth", "scale"].includes(tier)) {
    return res.status(400).json({ error: "invalid_tier_purchased" });
  }

  const allowedStatus = ["pending", "paid", "qualified"];
  const status = body.status && allowedStatus.includes(body.status)
    ? body.status
    : "pending";

  const insert = {
    indicador_location: indicadorLocation,
    indicado_email: indicadoEmail,
    indicado_name: indicadoName,
    tier_purchased: tier,
    cupom_code: body.cupom_code ? String(body.cupom_code).slice(0, 40) : null,
    activation_paid: !!body.activation_paid,
    status,
  };
  if (status === "paid" || status === "qualified") {
    insert.first_payment_at = new Date().toISOString();
  }
  if (status === "qualified") {
    insert.qualified_at = new Date().toISOString();
  }

  const { data: created, error: insErr } = await db()
    .from("referrals")
    .insert(insert)
    .select()
    .single();
  if (insErr) {
    if (
      insErr.code === "23505" ||
      /duplicate/i.test(insErr.message || "")
    ) {
      return res.status(409).json({
        error: "duplicate_referral",
        message: "Essa indicação já existe.",
      });
    }
    return res.status(500).json({ error: "db_error", detail: insErr.message });
  }

  log.info("admin.referral_created", {
    referral_id: created.id,
    indicador: indicadorLocation,
    indicado_email: indicadoEmail,
    tier,
    status,
  });

  // Recomputa tier do indicador se for paid/qualified
  if (status === "qualified") {
    try {
      await recomputeTier(indicadorLocation, { reason: "admin_manual" });
    } catch (err) {
      log.warn("admin.recompute_failed", {
        indicador: indicadorLocation,
        error: err.message,
      });
    }
  }

  return res.status(201).json({
    ok: true,
    referral: created,
    indicador_name: install.location_name,
  });
}

async function updateReferral(req, res) {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }
  const id = body.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  const allowed = [
    "indicado_email",
    "indicado_name",
    "tier_purchased",
    "cupom_code",
    "activation_paid",
    "status",
    "first_payment_at",
    "qualified_at",
    "disqualification_reason",
  ];
  const patch = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no_fields_to_update" });
  }

  if (
    patch.status &&
    !["pending", "paid", "qualified", "refunded", "fraud", "canceled"].includes(patch.status)
  ) {
    return res.status(400).json({ error: "invalid_status" });
  }
  if (
    patch.tier_purchased &&
    !["starter", "growth", "scale"].includes(patch.tier_purchased)
  ) {
    return res.status(400).json({ error: "invalid_tier_purchased" });
  }
  if (patch.status === "qualified" && !patch.qualified_at) {
    patch.qualified_at = new Date().toISOString();
  }

  const { data: updated, error } = await db()
    .from("referrals")
    .update(patch)
    .eq("id", id)
    .select("indicador_location, status")
    .maybeSingle();
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  if (!updated) return res.status(404).json({ error: "referral_not_found" });

  log.info("admin.referral_updated", { id, patch });

  // Recomputa se status mudou pra qualified ou pra um estado inválido
  if (
    patch.status === "qualified" ||
    ["refunded", "fraud", "canceled"].includes(patch.status)
  ) {
    try {
      await recomputeTier(updated.indicador_location, {
        reason: `admin_update_${patch.status}`,
      });
    } catch (err) {
      log.warn("admin.recompute_failed", { error: err.message });
    }
  }

  return res.status(200).json({ ok: true });
}

async function deleteReferral(req, res) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  const { data: row, error: readErr } = await db()
    .from("referrals")
    .select("indicador_location")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return res.status(500).json({ error: "db_error" });
  if (!row) return res.status(404).json({ error: "not_found" });

  const { error: delErr } = await db().from("referrals").delete().eq("id", id);
  if (delErr) return res.status(500).json({ error: "db_error", detail: delErr.message });

  try {
    await recomputeTier(row.indicador_location, { reason: "admin_deleted" });
  } catch {}

  log.info("admin.referral_deleted", { id, indicador: row.indicador_location });
  return res.status(200).json({ ok: true });
}
