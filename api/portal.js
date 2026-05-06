/**
 * POST /api/portal
 * Header: x-spark-session: <JWT>
 *
 * Cria uma sessão do Stripe Customer Portal para a location atual e
 * retorna { url } pra o front fazer redirect.
 *
 * Resolução do customer Stripe:
 *   1. Lê installations.stripe_customer_id (cache)
 *   2. Se não houver, faz stripe.customers.search por
 *      metadata['location_id'] = locationId
 *   3. Se achar, salva o id em installations e cria a sessão
 *
 * Pré-requisitos no Stripe (Etapa 0):
 *   - Customer Portal habilitado em Settings → Billing
 *   - Restricted key com escopos: Customers:Read,
 *     Billing Portal Sessions:Write
 */
import Stripe from "stripe";
import { verify as jwtVerify } from "../lib/server/jwt.js";
import { db } from "../lib/server/db.js";

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const token = req.headers["x-spark-session"];
  let claims;
  try {
    claims = jwtVerify(token);
  } catch (err) {
    return res.status(401).json({ error: "invalid_session", reason: err.message });
  }

  const locationId = claims.locationId;
  if (!locationId) return res.status(400).json({ error: "no_location_in_session" });

  // 1) Cache em installations
  let install;
  {
    const { data, error } = await db()
      .from("installations")
      .select("stripe_customer_id, location_name")
      .eq("location_id", locationId)
      .maybeSingle();
    if (error) {
      console.error("[portal] db read error:", error);
      return res.status(500).json({ error: "db_error" });
    }
    install = data;
  }
  if (!install) return res.status(404).json({ error: "no_installation" });

  let customerId = install.stripe_customer_id;

  // 2) Fallback: search por metadata.location_id no Stripe
  if (!customerId) {
    try {
      const search = await stripeClient().customers.search({
        query: `metadata['location_id']:'${locationId}'`,
        limit: 1,
      });
      customerId = search.data[0]?.id || null;
      if (customerId) {
        await db()
          .from("installations")
          .update({ stripe_customer_id: customerId })
          .eq("location_id", locationId);
      }
    } catch (err) {
      console.warn("[portal] stripe search failed:", err.message);
    }
  }

  if (!customerId) {
    return res.status(404).json({
      error: "no_stripe_customer",
      message:
        "Sua location ainda não tem customer Stripe associado. " +
        "Backfill de customer.metadata.location_id pendente (D8).",
    });
  }

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.PUBLIC_BASE_URL || ""}/?tab=settings`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("[portal] create session failed:", err.message);
    return res.status(500).json({
      error: "stripe_error",
      message: err.message,
      hint:
        err.code === "permission_denied"
          ? "Verifique se a restricted key inclui o escopo Billing Portal Sessions:Write"
          : undefined,
    });
  }
}
