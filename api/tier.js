/**
 * GET /api/tier?locationId=...
 * Header (preferido): x-spark-session: <JWT>
 * Query alternativa:  ?session=<JWT>  (usada no primeiro redirect pós-OAuth)
 *
 * Valida o JWT, lê referrals da location no Supabase e devolve no
 * shape consumido por qualify() no front. O front mantém qualify()
 * como fonte única da regra de negócio.
 */
import { verify as jwtVerify } from "../lib/server/jwt.js";
import { db } from "../lib/server/db.js";
import { ensureInstallation } from "../lib/server/provision.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const locationId = req.query?.locationId;
  if (!locationId || typeof locationId !== "string") {
    return res.status(400).json({ error: "missing_locationId" });
  }

  const token = req.headers["x-spark-session"] || req.query?.session;
  if (!token) return res.status(401).json({ error: "missing_session" });

  let claims;
  try {
    claims = jwtVerify(token);
  } catch (err) {
    return res.status(401).json({ error: "invalid_session", reason: err.message });
  }
  if (claims.locationId !== locationId) {
    return res.status(403).json({ error: "location_mismatch" });
  }

  // Defesa em profundidade: se a location ainda não tem installation,
  // provisiona agora via PIT da agency. Idempotente — noop se já existe.
  let installation = null;
  if (process.env.GHL_AGENCY_PIT) {
    try {
      installation = await ensureInstallation(locationId, { companyId: claims.companyId });
    } catch (err) {
      console.warn("[tier] provision skipped:", err?.message || err);
    }
  }
  if (!installation) {
    const { data } = await db()
      .from("installations")
      .select("coupon_code")
      .eq("location_id", locationId)
      .maybeSingle();
    installation = data;
  }

  let shareUrl = null;
  const linkBase = process.env.STRIPE_PAYMENT_LINK_BASE;
  if (linkBase && installation?.coupon_code) {
    const sep = linkBase.includes("?") ? "&" : "?";
    shareUrl = `${linkBase}${sep}prefilled_promo_code=${encodeURIComponent(installation.coupon_code)}`;
  }

  const { data, error } = await db()
    .from("referrals")
    .select(
      "id,indicado_location,indicado_email,coupon_used,status," +
        "subaccount_created_at,first_payment_at,qualified_at," +
        "disqualified_at,disqualification_reason",
    )
    .eq("indicador_location", locationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[tier] db error:", error);
    return res.status(500).json({ error: "db_error" });
  }

  const referrals = (data || []).map(rowToReferral);

  return res.status(200).json({
    locationId,
    referrals,
    couponCode: installation?.coupon_code || null,
    shareUrl,
    asOf: new Date().toISOString(),
  });
}

function rowToReferral(r) {
  return {
    name:
      r.indicado_email ||
      r.indicado_location ||
      `Indicação ${(r.id || "").slice(0, 4)}`,
    subaccountAddedAt: r.subaccount_created_at,
    couponIssued: !!r.coupon_used,
    cancelled: r.status === "canceled",
    refunded: r.status === "refunded",
    fraud: r.status === "fraud",
  };
}
