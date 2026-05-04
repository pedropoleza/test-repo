/**
 * POST /api/portal
 * Header: x-spark-session: <JWT>
 *
 * Cria uma sessão do Stripe Customer Portal pra location atual e
 * retorna a URL de redirect. O botão "Abrir portal" da Settings vai
 * abrir essa URL em nova aba.
 *
 * Pré-requisitos (Etapa 0):
 *   - Customer Portal habilitado no Stripe Dashboard
 *   - Mapeamento location → stripe_customer_id resolvido (Etapa 0
 *     decisão de mapeamento — preferimos customer.metadata.location_id)
 */

import { verify as jwtVerify } from "../lib/server/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // ====== ETAPA 1 — TODO: validar JWT ======
  // const token = req.headers["x-spark-session"];
  // let claims;
  // try {
  //   claims = jwtVerify(token);
  // } catch {
  //   return res.status(401).json({ error: "invalid_session" });
  // }
  // const { locationId } = claims;

  // ====== ETAPA 2 — TODO: resolver Stripe customer ======
  // Estratégia preferida: customer.metadata.location_id == locationId
  //
  //   const customers = await stripe.customers.search({
  //     query: `metadata['location_id']:'${locationId}'`,
  //   });
  //   if (!customers.data.length) {
  //     return res.status(404).json({ error: "no_stripe_customer" });
  //   }
  //   const customer = customers.data[0];
  //
  //   const session = await stripe.billingPortal.sessions.create({
  //     customer: customer.id,
  //     return_url: `${process.env.PUBLIC_BASE_URL}?tab=settings`,
  //   });
  //   return res.status(200).json({ url: session.url });

  // STUB: backend ainda não plugado — front mostra toast informativo.
  return res.status(503).json({
    error: "not_implemented",
    message: "Stripe portal integration arrives in Etapa 2.",
  });
}
