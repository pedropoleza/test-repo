/**
 * GET /api/cupom?locationId=...
 *
 * Endpoint público (sem JWT) que devolve o cupom canônico da location
 * e a URL de checkout pronta pra compartilhar.
 *
 * Existe pra resolver o caso onde o front não conseguiu o cupom via
 * SSO (porque o usuário caiu em URL direta, cache, ou o SSO falhou).
 * Faz ensureInstallation se a row não existe — então cobre sub-accounts
 * novas automaticamente.
 *
 * Resposta:
 *   { couponCode, shareUrl, locationName }
 *
 * Não exige JWT porque coupon_code é informação pública (é o ponto
 * inteiro: ele será compartilhado em WhatsApp/email).
 */
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

  // Cache control: pode cachear curto pra reduzir DB hits.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

  let row;
  const { data, error } = await db()
    .from("installations")
    .select("coupon_code, location_name")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) {
    console.error("[cupom] db error:", error);
    return res.status(500).json({ error: "db_error" });
  }
  row = data;

  // Lazy provision: se ainda não existe, cria agora via PIT.
  if (!row && process.env.GHL_AGENCY_PIT) {
    try {
      row = await ensureInstallation(locationId, {});
    } catch (err) {
      console.warn("[cupom] provision failed:", err?.message || err);
    }
  }

  if (!row || !row.coupon_code) {
    return res.status(404).json({
      error: "no_coupon",
      locationId,
      hint: "Location pode não existir ou installation não foi provisionada ainda.",
    });
  }

  const base = process.env.STRIPE_PAYMENT_LINK_BASE;
  let shareUrl = null;
  if (base) {
    const sep = base.includes("?") ? "&" : "?";
    shareUrl = `${base}${sep}prefilled_promo_code=${encodeURIComponent(row.coupon_code)}`;
  }

  return res.status(200).json({
    locationId,
    locationName: row.location_name,
    couponCode: row.coupon_code,
    shareUrl,
  });
}
