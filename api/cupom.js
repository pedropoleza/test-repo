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
  // Format GHL: 20 chars alphanumeric. Rejeita lixo pra não provisionar
  // cupom Stripe por engano (DoS protection).
  if (!/^[A-Za-z0-9]{15,30}$/.test(locationId)) {
    return res.status(400).json({ error: "invalid_locationId_format" });
  }

  // Cache control: pode cachear curto pra reduzir DB hits.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

  let row;
  const { data, error } = await db()
    .from("installations")
    .select("coupon_code, location_name, plan_coupons")
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

  // 3-tier URLs (Starter/Growth/Scale). Cada um com cupom prefilled.
  const buildTierUrl = (envKey) => {
    const url = process.env[envKey];
    if (!url) return null;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}prefilled_promo_code=${encodeURIComponent(row.coupon_code)}`;
  };
  // Cupons per-plano dessa subaccount, formato ${BASE}${TIER}OFF.
  // Cada um só funciona no plano do nome (trava por produto) e já registra
  // a indicação automaticamente quando usado.
  const planCoupons = row.plan_coupons || {};

  // Preços + descontos vivos vêm de plan_config (editáveis no /admin).
  const { data: planCfg } = await db()
    .from("plan_config")
    .select("tier, name, monthly_usd, activation_usd, indicacao_discount_usd, discount_type, indicacao_duration, indicacao_months, sort_order")
    .order("sort_order", { ascending: true });
  const cfgByTier = {};
  for (const p of planCfg || []) cfgByTier[p.tier] = p;

  // URL do checkout próprio Spark (não Stripe-hosted). Cada plano com o
  // cupom per-plano prefilled — usar = registro automático da indicação.
  const checkoutBase = process.env.CHECKOUT_BASE_URL || "/checkout";
  const buildCheckoutUrl = (tier) => {
    const code = planCoupons[tier];
    const params = new URLSearchParams({ tier });
    if (code) params.set("cupom", code);
    else params.set("ref", locationId);
    const sep = checkoutBase.includes("?") ? "&" : "?";
    return `${checkoutBase}${sep}${params.toString()}`;
  };

  // Frase humana do desconto. Ex:
  //   amount/repeating(3)  -> "−$20/mês por 3 meses"
  //   amount/once          -> "−$50 na 1ª fatura"
  //   percent/repeating(3) -> "100% off por 3 meses"
  const describeDiscount = (cfg) => {
    if (!cfg || !cfg.indicacao_discount_usd) return null;
    const v = Number(cfg.indicacao_discount_usd);
    const months = Number(cfg.indicacao_months) || null;
    const isRepeating = cfg.indicacao_duration === "repeating";
    if (cfg.discount_type === "percent") {
      return isRepeating
        ? `${v}% off por ${months || 3} meses`
        : `${v}% off na 1ª fatura`;
    }
    return isRepeating
      ? `−$${v}/mês por ${months || 3} meses`
      : `−$${v} na 1ª fatura`;
  };

  const tierMeta = (tierId, fallbackName) => {
    const cfg = cfgByTier[tierId] || {};
    return {
      name: cfg.name || fallbackName,
      monthly_usd: Number(cfg.monthly_usd) || 0,
      activation_usd: Number(cfg.activation_usd) || 0,
      price_usd: Number(cfg.monthly_usd) || 0,        // legado, mantém p/ compat
      cupom: planCoupons[tierId] || null,
      url: buildCheckoutUrl(tierId),
      link: buildTierUrl(`STRIPE_LINK_${tierId.toUpperCase()}`),
      discount: cfg.indicacao_discount_usd != null ? {
        value: Number(cfg.indicacao_discount_usd),
        type: cfg.discount_type || "amount",
        duration: cfg.indicacao_duration || "once",
        months: cfg.indicacao_months || null,
        label: describeDiscount(cfg),
      } : null,
    };
  };

  const tiers = {
    starter: tierMeta("starter", "Spark Starter"),
    growth:  tierMeta("growth",  "Spark Growth"),
    scale:   tierMeta("scale",   "Spark Scale"),
  };

  return res.status(200).json({
    locationId,
    locationName: row.location_name,
    couponCode: row.coupon_code,
    planCoupons,
    shareUrl,
    tiers,
  });
}
