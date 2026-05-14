/**
 * Lógica de criação/lookup de Stripe Coupons e Promotion Codes.
 *
 * Compartilhado entre:
 *   - lib/server/provision.js (cria cupom do indicado quando provisiona location)
 *   - api/admin/repair-missing-coupons.js (retry pra rows sem coupon)
 *   - lib/server/tier-discount.js (cria cupons do indicador conforme tier)
 *
 * Separação de cupons por metadata.role:
 *   - 'indicado'              → $50 amount_off, once. Aplicado no checkout
 *                                pelo cliente novo digitando o promotion code.
 *   - 'indicador_once'        → bonificação única do tier (varia $30–$100),
 *                                aplicada na assinatura do indicador.
 *   - 'indicador_recurring'   → desconto mensal recorrente do tier ($30–$100),
 *                                aplicado enquanto o tier for mantido.
 *
 * Todos os 3 carregam metadata.location_id (locationId do INDICADOR).
 * Para `indicado`, o location_id ainda é do indicador — é o cupom DELE
 * que outras pessoas vão usar.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";

// === Valores ===========================================================
// $50 fixo de desconto no primeiro pagamento pra quem é indicado.
// Decisão D5=a. Aplica no first invoice (que inclui mensalidade + activation
// fee), reduzindo o total. Recorrências subsequentes ficam sem desconto.
export const INDICADO_DISCOUNT_USD = 50;

// === Constants =========================================================
const STRIPE_COUPON_NAME_MAX = 40;
const COLLISION_RETRIES = 5;

// === Stripe client ====================================================
let _stripe = null;
export function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

/**
 * Detecta a moeda default da conta Stripe na primeira chamada.
 * Cache em memória pelo lifetime do warm container. Fallback pra 'usd'
 * se a key não tiver escopo de ler account.
 */
let _accountCurrency = null;
export async function getAccountCurrency() {
  if (_accountCurrency) return _accountCurrency;
  try {
    const acct = await stripeClient().accounts.retrieve();
    _accountCurrency = acct?.default_currency || "usd";
  } catch {
    _accountCurrency = "usd";
  }
  return _accountCurrency;
}

// === Coupon Code derivation ===========================================

/**
 * Deriva um base (sem OFF) do nome da location, combinando palavras
 * até dar pelo menos 5 chars. Trunca em 16.
 */
export function deriveCouponBase(name) {
  if (!name) return null;
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  if (!words.length) return null;
  let base = "";
  for (const w of words) {
    base += w;
    if (base.length >= 5) break;
  }
  return base.slice(0, 16) || null;
}

function shortName(prefix, suffix) {
  // Trunca em 40 chars (limite duro do Stripe).
  return `${prefix}${suffix}`.slice(0, STRIPE_COUPON_NAME_MAX);
}

// === Idempotent lookup ================================================

/**
 * Busca um Coupon existente filtrando pelos campos de metadata.
 * **Pagina** por todos os coupons da conta (não usa apenas os primeiros 100).
 *
 * `criteria` é um objeto cuja keys são fields de metadata e values são
 * strings esperadas. Match exato.
 *
 * Retorna o primeiro coupon que casa, ou null. Lookups são caros (1 call
 * por página de 100), idealmente chame com cache externo se possível.
 */
export async function findCouponByMetadata(criteria) {
  const stripe = stripeClient();
  let cursor;
  let pages = 0;
  while (pages < 20) {
    const opts = { limit: 100 };
    if (cursor) opts.starting_after = cursor;
    const list = await stripe.coupons.list(opts);
    for (const c of list.data) {
      const m = c.metadata || {};
      let match = true;
      for (const [k, v] of Object.entries(criteria)) {
        if (m[k] !== v) { match = false; break; }
      }
      if (match) return c;
    }
    if (!list.has_more) return null;
    cursor = list.data[list.data.length - 1]?.id;
    pages++;
  }
  // Salvaguarda: nunca itera mais que 2000 coupons.
  return null;
}

// === Promo Code creation com retry ====================================

/**
 * Cria um Promotion Code, lidando com colisão de nome.
 * Estratégia:
 *   tentativa 0: ${base}OFF
 *   tentativa 1: ${base}${loc4chars}OFF
 *   tentativa 2: ${base}${loc4chars}2OFF
 *   tentativa 3: ${base}${loc4chars}3OFF
 *   tentativa 4: ${base}${rand4hex}OFF       ← garantido único
 */
async function createPromoCodeWithFallback(coupon, base, locationId) {
  const stripe = stripeClient();
  const suf = (locationId || "")
    .slice(0, 4)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i < COLLISION_RETRIES; i++) {
    let attempt;
    if (i === 0) attempt = `${base}OFF`;
    else if (i < COLLISION_RETRIES - 1) {
      attempt = `${base}${suf}${i === 1 ? "" : i}OFF`;
    } else {
      attempt = `${base}${randomBytes(2).toString("hex").toUpperCase()}OFF`;
    }
    try {
      const promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code: attempt,
        metadata: { location_id: locationId },
      });
      return promo;
    } catch (err) {
      if (
        err?.code === "resource_already_exists" ||
        /already/i.test(err?.message || "")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`promo_code_collision_unresolved_after_${COLLISION_RETRIES}`);
}

// === Public API ========================================================

/**
 * Garante que existe Coupon + Promotion Code do tipo INDICADO pra uma
 * location. Retorna { couponCode, stripeCouponId, stripePromotionId }
 * ou null se Stripe falhar (ex: escopo da key).
 */
export async function ensureIndicadoCoupon(locationId, locationName) {
  const base =
    deriveCouponBase(locationName) ||
    `LOC${(locationId || "").slice(0, 6).toUpperCase()}`;
  const currency = await getAccountCurrency();
  const stripe = stripeClient();

  try {
    let coupon = await findCouponByMetadata({
      location_id: locationId,
      role: "indicado",
    });

    // Se acharmos um Coupon antigo com amount errado (ex: $20 quando agora
    // queremos $50), descartamos: deleta o velho e cria um novo. Isso
    // evita reuso silencioso de coupon stale após mudança de valor.
    const expectedAmountOff = INDICADO_DISCOUNT_USD * 100;
    if (coupon && coupon.amount_off !== expectedAmountOff) {
      console.info(
        "[stripe-coupon] retiring stale coupon",
        coupon.id,
        `(amount_off=${coupon.amount_off}, expected=${expectedAmountOff})`,
      );
      try {
        await stripe.coupons.del(coupon.id);
      } catch (err) {
        // Coupons usados em assinaturas não podem ser deletados; nesse
        // caso renomeia pra metadata.role=indicado_deprecated pra sair
        // do match na próxima busca.
        try {
          await stripe.coupons.update(coupon.id, {
            metadata: {
              ...coupon.metadata,
              role: "indicado_deprecated",
              retired_reason: "amount_changed",
              retired_at: new Date().toISOString(),
            },
          });
        } catch (e2) {
          console.warn("[stripe-coupon] could not retire:", e2.message);
        }
      }
      coupon = null;
    }

    if (!coupon) {
      coupon = await stripe.coupons.create({
        amount_off: expectedAmountOff,
        currency,
        duration: "once",
        name: shortName("Indicação — ", locationName || locationId),
        metadata: {
          location_id: locationId,
          role: "indicado",
          source: "spark-referral-hub",
        },
      });
    }

    const promo = await createPromoCodeWithFallback(coupon, base, locationId);

    return {
      couponCode: promo.code,
      stripeCouponId: coupon.id,
      stripePromotionId: promo.id,
    };
  } catch (err) {
    console.warn("[stripe-coupon] indicado skipped:", err?.message || err);
    return null;
  }
}

/**
 * Cria (ou reusa) Coupon do INDICADOR para um tier específico.
 * - `kind` = 'once' ou 'recurring'
 * - `amountUsd` = valor do desconto (em USD, sem cents)
 *
 * Não cria Promotion Code (não é pra ninguém digitar — é aplicado
 * direto na customer.discount do indicador).
 */
export async function ensureIndicadorCoupon({
  locationId,
  tierId,
  kind,
  amountUsd,
}) {
  if (!locationId || !tierId || !amountUsd) {
    throw new Error("missing_params");
  }
  if (kind !== "once" && kind !== "recurring") {
    throw new Error("invalid_kind");
  }
  const role = kind === "once" ? "indicador_once" : "indicador_recurring";
  const duration = kind === "once" ? "once" : "forever";
  const currency = await getAccountCurrency();
  const stripe = stripeClient();

  // Idempotência: cupom por (location_id + role + tier + amount).
  // Se o tier subir/descer, criamos um cupom novo (com tier+amount
  // novos no metadata) e descartamos o anterior — caller é responsável
  // por aplicar/revogar.
  const existing = await findCouponByMetadata({
    location_id: locationId,
    role,
    tier: tierId,
    amount_usd: String(amountUsd),
  });
  if (existing) return existing;

  return await stripe.coupons.create({
    amount_off: amountUsd * 100,
    currency,
    duration,
    name: shortName(
      kind === "once" ? "Indicador único — " : "Indicador mensal — ",
      `${locationId} ${tierId}`,
    ),
    metadata: {
      location_id: locationId,
      role,
      tier: tierId,
      amount_usd: String(amountUsd),
      source: "spark-referral-hub",
    },
  });
}

/**
 * Cria um Payment Link **por location**, com discount automático
 * (cupom $50 once aplicado pelos line_items, sem digitar).
 *
 * Cliente que abre o link vê o desconto já aplicado.
 *
 * Idempotência: se installation.payment_link_id existe, valida e
 * reusa. Senão, cria novo.
 *
 * Args:
 *   - couponId:        ID do Stripe Coupon (role=indicado) da location
 *   - locationId:      pra metadata
 *   - locationName:    pra metadata legível
 *   - existingLinkId:  payment_link_id atual do DB (pra check)
 *
 * Retorna { id, url } ou null se Stripe falhar.
 */
export async function ensureLocationPaymentLink({
  couponId,
  locationId,
  locationName,
  existingLinkId,
}) {
  if (!couponId || !locationId) {
    throw new Error("missing_params");
  }
  const stripe = stripeClient();

  // 1) Validate existing
  if (existingLinkId) {
    try {
      const link = await stripe.paymentLinks.retrieve(existingLinkId);
      // Confirma que está ativo + tem o coupon certo
      const hasCoupon = link.discounts?.some((d) => d.coupon === couponId);
      if (link.active && hasCoupon) {
        return { id: link.id, url: link.url };
      }
      // Não está mais válido — desativa e cria novo
      if (link.active) {
        try {
          await stripe.paymentLinks.update(existingLinkId, { active: false });
        } catch {}
      }
    } catch {
      // Não achou; segue pra criar novo
    }
  }

  // 2) Cria novo
  const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
  const priceActivation = process.env.STRIPE_PRICE_ACTIVATION;
  if (!priceMonthly || !priceActivation) {
    throw new Error("STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ACTIVATION not set");
  }

  const link = await stripe.paymentLinks.create({
    line_items: [
      { price: priceMonthly, quantity: 1 },
      { price: priceActivation, quantity: 1 },
    ],
    discounts: [{ coupon: couponId }],
    // discounts e allow_promotion_codes são mutuamente exclusivos.
    billing_address_collection: "auto",
    metadata: {
      location_id: locationId,
      location_name: (locationName || "").slice(0, 60),
      source: "spark-referral-hub",
      coupon_id: couponId,
    },
  });

  return { id: link.id, url: link.url };
}
