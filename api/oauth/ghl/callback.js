/**
 * OAuth callback do GHL (skeleton com TODOs marcando decisões pendentes).
 *
 * Estado atual: aceita o code, mostra página HTML de sucesso. Não troca
 * o code por tokens nem persiste — pendente de DATABASE_URL e das
 * decisões D5 (cupom do indicado).
 *
 * Quando a Etapa 1 começar, este handler vai:
 *   1. Validar o `code` recebido
 *   2. Chamar https://services.leadconnectorhq.com/oauth/token (ou
 *      o endpoint vigente do GHL) trocando code por access/refresh
 *   3. Encriptar tokens com encrypt() de lib/server/crypto.js
 *   4. Persistir installations row com status='active'
 *   5. Criar Stripe Coupon + Promotion Code (D5 define o desconto
 *      do indicado, e D4/D5 a regra de colisão)
 *   6. Assinar JWT curto e redirecionar pro hub com `?session=...`
 */

import { encrypt } from "../../../lib/server/crypto.js";
import { sign as jwtSign } from "../../../lib/server/jwt.js";

export default async function handler(req, res) {
  const { code, locationId, state } = req.query || {};

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // ====== ETAPA 1 — TODO: troca de code por tokens ======
  // const tokens = await fetch("https://services.leadconnectorhq.com/oauth/token", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/x-www-form-urlencoded" },
  //   body: new URLSearchParams({
  //     client_id:     process.env.GHL_CLIENT_ID,
  //     client_secret: process.env.GHL_CLIENT_SECRET,
  //     grant_type:    "authorization_code",
  //     code,
  //     redirect_uri:  `${process.env.PUBLIC_BASE_URL}/api/oauth/ghl/callback`,
  //   }),
  // }).then((r) => r.json());

  // ====== ETAPA 1 — TODO: encrypt + persist ======
  // const enc = {
  //   access_token:  encrypt(tokens.access_token),
  //   refresh_token: encrypt(tokens.refresh_token),
  // };
  // await db.installations.upsert({
  //   location_id:  tokens.locationId,
  //   location_name: tokens.locationName,
  //   ...enc,
  //   expires_at: new Date(Date.now() + tokens.expires_in * 1000),
  //   scope:      tokens.scope,
  //   status:     "active",
  // });

  // ====== ETAPA 3 — TODO(D5): criar Stripe Coupon + Promotion Code ======
  // D5: define o desconto que o indicado ganha quando digita o código.
  // Após resposta, criar:
  //   const coupon = await stripe.coupons.create({
  //     amount_off: D5_AMOUNT_CENTS,
  //     currency: "usd",
  //     duration: "once",
  //     metadata: { location_id: tokens.locationId, role: "indicado" },
  //   });
  //   const promo = await stripe.promotionCodes.create({
  //     coupon: coupon.id,
  //     code:   deriveCoupon(tokens.locationName), // SPARKLEADSOFF etc.
  //     metadata: { location_id: tokens.locationId },
  //   });
  // Em caso de colisão (409): sufixar com 4 chars do locationId
  //   e tentar novamente.

  // ====== ETAPA 1 — TODO: assinar JWT e redirecionar ======
  // const session = jwtSign({ locationId: tokens.locationId, role: "owner" });
  // res.setHeader("Location",
  //   `${process.env.PUBLIC_BASE_URL}/?session=${encodeURIComponent(session)}`);
  // return res.status(302).end();

  // STUB ATUAL: página de sucesso até a Etapa 1 entrar
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>App conectado · Spark Referral Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
           background: #f8fafc; color: #0f172a; padding: 40px 24px; text-align: center; }
    .card { max-width: 460px; margin: 60px auto; background: #fff;
            border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;
            box-shadow: 0 4px 12px -4px rgba(15,23,42,0.06); }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p  { color: #64748b; margin: 0 0 16px; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .ok { color: #16a34a; font-size: 32px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="ok">✓</div>
    <h1>App conectado</h1>
    <p>Autorização recebida pelo Spark Referral Hub. A integração completa
    será concluída na Etapa 1 (troca de code por tokens, persistência e
    redirect ao hub).</p>
    ${code ? `<p><small>code: <code>${String(code).slice(0,16)}…</code></small></p>` : ""}
    ${locationId ? `<p><small>location: <code>${locationId}</code></small></p>` : ""}
    ${state ? `<p><small>state: <code>${state}</code></small></p>` : ""}
    <p>Pode fechar esta janela.</p>
  </div>
</body>
</html>`);
}
