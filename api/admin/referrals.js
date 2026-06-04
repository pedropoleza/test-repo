/**
 * /api/admin/referrals — multi-action endpoint do painel /admin.
 *
 * Auth: header `x-spark-admin-key` ou cookie `spark_admin_key` ou ?k=
 * Match contra ADMIN_URL_SECRET (timing-safe).
 *
 * Actions:
 *   GET (default)                  → últimas referrals (?limit, ?indicador)
 *   GET ?action=search_locations&q → autocomplete por nome/id
 *   GET ?action=dashboard          → KPIs (MRR, conversões, próximos, etc)
 *   GET ?action=locations          → tabela de installations com stats
 *   GET ?action=location&id=X      → drill down de 1 location
 *   GET ?action=leaderboard&period → top indicadores por qualified count
 *   GET ?action=activity           → feed cronológico (audit_log)
 *   GET ?action=cupons             → lista cupons + usage stats
 *   GET ?action=pending            → queue de "atenção" (refunds pendentes etc)
 *   POST                           → cria referral (form principal)
 *   POST ?action=bulk_recompute    → recomputa tier de todas locations
 *   POST ?action=bulk_sync         → roda sync-locations agora
 *   PATCH                          → edita referral existente
 *   DELETE ?id=X                   → remove
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";
import { ensureInstallation } from "../../lib/server/provision.js";
import { stripeClient, ensureLocationPlanCoupons } from "../../lib/server/stripe-coupon.js";
import { log } from "../../lib/server/log.js";
import { audit } from "../../lib/server/audit.js";
import { levels as TIERS } from "../../src/config/tiers.js";

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
    return res.status(404).json({ error: "not_found" });
  }
  const action = req.query?.action || null;

  if (req.method === "GET") {
    switch (action) {
      case "search_locations": return searchLocations(req, res);
      case "dashboard":        return dashboard(req, res);
      case "locations":        return locationsTable(req, res);
      case "location":         return locationDetail(req, res);
      case "leaderboard":      return leaderboard(req, res);
      case "activity":         return activityFeed(req, res);
      case "cupons":           return cuponsList(req, res);
      case "pending":          return pendingQueue(req, res);
      case "plans":            return getPlans(req, res);
      case "diag_coupon":      return diagCoupon(req, res);
      default:                 return listReferrals(req, res);
    }
  }
  if (req.method === "POST") {
    if (action === "bulk_recompute") return bulkRecompute(req, res);
    if (action === "bulk_sync")      return bulkSync(req, res);
    if (action === "update_plan")    return updatePlan(req, res);
    if (action === "backfill_plan_coupons") return backfillPlanCoupons(req, res);
    return createReferral(req, res);
  }
  if (req.method === "PATCH")  return updateReferral(req, res);
  if (req.method === "DELETE") return deleteReferral(req, res);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
}

/* ============ LIST referrals ============ */
async function listReferrals(req, res) {
  const indicador = req.query?.indicador ? String(req.query.indicador).slice(0, 40) : null;
  const status = req.query?.status ? String(req.query.status) : null;
  const tier = req.query?.tier_purchased ? String(req.query.tier_purchased) : null;
  const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 50));

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
  if (status) q = q.eq("status", status);
  if (tier) q = q.eq("tier_purchased", tier);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  return res.status(200).json({ referrals: data || [] });
}

/* ============ search_locations (autocomplete) ============ */
async function searchLocations(req, res) {
  const q = String(req.query?.q || "").trim();
  if (!q || q.length < 2) return res.status(200).json({ locations: [] });

  const { data, error } = await db()
    .from("installations")
    .select("location_id, location_name")
    .or(`location_name.ilike.%${q.replace(/[%_]/g, "")}%,location_id.eq.${q}`)
    .limit(20);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  return res.status(200).json({ locations: data || [] });
}

/* ============ DASHBOARD KPIs ============ */
async function dashboard(_req, res) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const last30dStart = new Date(now.getTime() - 30 * 86400000).toISOString();
  const next7d = new Date(now.getTime() - 23 * 86400000).toISOString(); // paid há 23+ dias

  const out = {};

  // Total locations
  const { count: totalLocs } = await db()
    .from("installations").select("location_id", { count: "exact", head: true });
  out.locations_total = totalLocs || 0;

  // Referrals counters
  const [{ count: refsTotal }, { count: refsMonth }, { count: refsPaid }, { count: refsQualified }] =
    await Promise.all([
      db().from("referrals").select("id", { count: "exact", head: true }),
      db().from("referrals").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
      db().from("referrals").select("id", { count: "exact", head: true }).eq("status", "paid"),
      db().from("referrals").select("id", { count: "exact", head: true }).eq("status", "qualified"),
    ]);
  out.referrals = {
    total: refsTotal || 0,
    this_month: refsMonth || 0,
    paid: refsPaid || 0,
    qualified: refsQualified || 0,
  };
  out.conversion_rate = refsPaid > 0 ? Math.round((refsQualified / (refsPaid + refsQualified)) * 100) : 0;

  // Próximas a qualificar (paid + first_payment_at entre 23 e 30 dias atrás)
  const { data: nearQual } = await db()
    .from("referrals")
    .select("id, indicado_name, indicado_email, indicador_location, first_payment_at")
    .eq("status", "paid")
    .lte("first_payment_at", next7d)
    .gte("first_payment_at", last30dStart)
    .order("first_payment_at", { ascending: true })
    .limit(10);
  out.qualifying_soon = nearQual || [];

  // MRR estimado (com base em referrals qualificados × preço médio por tier)
  const { data: tierBreakdown } = await db()
    .from("referrals")
    .select("tier_purchased")
    .eq("status", "qualified");
  const tierCounts = { starter: 0, growth: 0, scale: 0 };
  for (const r of tierBreakdown || []) {
    if (r.tier_purchased && tierCounts[r.tier_purchased] !== undefined) {
      tierCounts[r.tier_purchased]++;
    }
  }
  out.mrr_estimated_usd =
    tierCounts.starter * 79 + tierCounts.growth * 120 + tierCounts.scale * 250;
  out.tier_breakdown = tierCounts;

  // Top 3 indicadores do mês
  const { data: topMonth } = await db()
    .from("referrals")
    .select("indicador_location")
    .eq("status", "qualified")
    .gte("qualified_at", monthStart);
  const counts = {};
  for (const r of topMonth || []) {
    counts[r.indicador_location] = (counts[r.indicador_location] || 0) + 1;
  }
  const topIds = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ location_id: id, qualified_count: n }));
  if (topIds.length) {
    const { data: names } = await db()
      .from("installations")
      .select("location_id, location_name")
      .in("location_id", topIds.map((t) => t.location_id));
    const nameMap = Object.fromEntries((names || []).map((n) => [n.location_id, n.location_name]));
    out.top_indicators_month = topIds.map((t) => ({
      ...t,
      location_name: nameMap[t.location_id] || null,
    }));
  } else {
    out.top_indicators_month = [];
  }

  return res.status(200).json(out);
}

/* ============ LOCATIONS table ============ */
async function locationsTable(req, res) {
  const q = req.query?.q ? String(req.query.q).trim() : null;
  const tier = req.query?.tier ? String(req.query.tier) : null;
  const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
  const offset = Math.max(0, Number(req.query?.offset) || 0);

  let query = db()
    .from("installations")
    .select(
      "location_id, location_name, current_tier_id, coupon_code, " +
        "stripe_customer_id, status, installed_at, last_sync_at",
      { count: "exact" },
    )
    .order("location_name", { ascending: true })
    .range(offset, offset + limit - 1);
  if (q) query = query.ilike("location_name", `%${q.replace(/[%_]/g, "")}%`);
  if (tier) query = query.eq("current_tier_id", tier);
  const { data: locs, error, count } = await query;
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  // Annotate com qualified_count por location (1 query agregada)
  const ids = (locs || []).map((l) => l.location_id);
  let qualMap = {};
  if (ids.length) {
    const { data: counts } = await db()
      .from("referrals")
      .select("indicador_location")
      .in("indicador_location", ids)
      .eq("status", "qualified");
    for (const r of counts || []) {
      qualMap[r.indicador_location] = (qualMap[r.indicador_location] || 0) + 1;
    }
  }

  return res.status(200).json({
    total: count || 0,
    offset,
    limit,
    locations: (locs || []).map((l) => ({
      ...l,
      qualified_count: qualMap[l.location_id] || 0,
    })),
  });
}

/* ============ LOCATION detail ============ */
async function locationDetail(req, res) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  const { data: inst, error } = await db()
    .from("installations")
    .select("*")
    .eq("location_id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  if (!inst) return res.status(404).json({ error: "not_found" });

  const { data: refs } = await db()
    .from("referrals")
    .select(
      "id, indicado_name, indicado_email, tier_purchased, cupom_code, " +
        "status, first_payment_at, qualified_at, created_at",
    )
    .eq("indicador_location", id)
    .order("created_at", { ascending: false });

  const { data: history } = await db()
    .from("tier_history")
    .select("from_tier, to_tier, qualified_count, reason, created_at")
    .eq("location_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Stats
  const stats = { paid: 0, qualified: 0, pending: 0, invalid: 0 };
  let mrr = 0;
  for (const r of refs || []) {
    if (r.status === "qualified") {
      stats.qualified++;
      if (r.tier_purchased === "starter") mrr += 79;
      else if (r.tier_purchased === "growth") mrr += 120;
      else if (r.tier_purchased === "scale") mrr += 199;
    } else if (r.status === "paid") stats.paid++;
    else if (r.status === "pending") stats.pending++;
    else stats.invalid++;
  }

  return res.status(200).json({
    installation: inst,
    referrals: refs || [],
    tier_history: history || [],
    stats: { ...stats, mrr_generated_usd: mrr, total: (refs || []).length },
  });
}

/* ============ LEADERBOARD ============ */
async function leaderboard(req, res) {
  const period = String(req.query?.period || "all"); // 'month'|'90d'|'all'
  const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

  const now = new Date();
  let dateFilter = null;
  if (period === "month") {
    dateFilter = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  } else if (period === "90d") {
    dateFilter = new Date(now.getTime() - 90 * 86400000).toISOString();
  }

  let q = db()
    .from("referrals")
    .select("indicador_location, tier_purchased")
    .eq("status", "qualified");
  if (dateFilter) q = q.gte("qualified_at", dateFilter);

  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const counts = {};
  const mrr = {};
  for (const r of rows || []) {
    counts[r.indicador_location] = (counts[r.indicador_location] || 0) + 1;
    const price = r.tier_purchased === "starter" ? 79 : r.tier_purchased === "growth" ? 120 : r.tier_purchased === "scale" ? 199 : 0;
    mrr[r.indicador_location] = (mrr[r.indicador_location] || 0) + price;
  }

  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, n], idx) => ({
      rank: idx + 1,
      location_id: id,
      qualified_count: n,
      mrr_contribution_usd: mrr[id] || 0,
    }));

  if (ranked.length) {
    const { data: meta } = await db()
      .from("installations")
      .select("location_id, location_name, current_tier_id")
      .in("location_id", ranked.map((r) => r.location_id));
    const map = Object.fromEntries((meta || []).map((m) => [m.location_id, m]));
    for (const r of ranked) {
      r.location_name = map[r.location_id]?.location_name || null;
      r.current_tier_id = map[r.location_id]?.current_tier_id || "none";
    }
  }

  return res.status(200).json({ period, leaderboard: ranked });
}

/* ============ ACTIVITY FEED ============ */
async function activityFeed(req, res) {
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
  const eventType = req.query?.event_type ? String(req.query.event_type) : null;

  let q = db()
    .from("audit_log")
    .select("id, event_type, actor, resource_type, resource_id, summary, data, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (eventType) q = q.eq("event_type", eventType);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  return res.status(200).json({ activity: data || [] });
}

/* ============ CUPONS list ============ */
async function cuponsList(_req, res) {
  // Cupons per-location (de installations) + 3 cupons INDICACAO_* globais
  const { data: rows } = await db()
    .from("installations")
    .select("location_id, location_name, coupon_code, stripe_promotion_id")
    .not("coupon_code", "is", null)
    .order("location_name");

  // Usage counts via referrals.cupom_code
  const { data: usage } = await db()
    .from("referrals")
    .select("cupom_code")
    .not("cupom_code", "is", null);
  const usageMap = {};
  for (const u of usage || []) {
    if (u.cupom_code) usageMap[u.cupom_code] = (usageMap[u.cupom_code] || 0) + 1;
  }

  const perLocation = (rows || []).map((r) => ({
    type: "per_location",
    location_id: r.location_id,
    location_name: r.location_name,
    code: r.coupon_code,
    times_used: usageMap[r.coupon_code] || 0,
    stripe_promotion_id: r.stripe_promotion_id,
  }));

  const global = ["INDICACAO_STARTER", "INDICACAO_GROWTH", "INDICACAO_SCALE"].map((code) => ({
    type: "tier_global",
    code,
    times_used: usageMap[code] || 0,
  }));

  return res.status(200).json({
    global,
    per_location: perLocation,
    total_per_location: perLocation.length,
  });
}

/* ============ PENDING QUEUE ============ */
async function pendingQueue(_req, res) {
  const now = new Date();
  const out = {
    qualifying_soon: [],
    old_pending: [],
    recent_disqualified: [],
  };

  // Próximos 7 dias a qualificar
  const cutoff23 = new Date(now.getTime() - 23 * 86400000).toISOString();
  const cutoff30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { data: q1 } = await db()
    .from("referrals")
    .select("id, indicado_name, indicado_email, indicador_location, first_payment_at, tier_purchased")
    .eq("status", "paid")
    .gte("first_payment_at", cutoff30)
    .lte("first_payment_at", cutoff23)
    .order("first_payment_at", { ascending: true })
    .limit(20);
  out.qualifying_soon = q1 || [];

  // Pendings > 14 dias (possivelmente desistiu)
  const cutoff14 = new Date(now.getTime() - 14 * 86400000).toISOString();
  const { data: q2 } = await db()
    .from("referrals")
    .select("id, indicado_name, indicado_email, indicador_location, created_at")
    .eq("status", "pending")
    .lte("created_at", cutoff14)
    .order("created_at", { ascending: false })
    .limit(20);
  out.old_pending = q2 || [];

  // Desqualificados nos últimos 7 dias
  const cutoff7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const { data: q3 } = await db()
    .from("referrals")
    .select("id, indicado_name, indicado_email, indicador_location, status, disqualified_at, disqualification_reason")
    .in("status", ["refunded", "fraud", "canceled"])
    .gte("disqualified_at", cutoff7)
    .order("disqualified_at", { ascending: false })
    .limit(20);
  out.recent_disqualified = q3 || [];

  return res.status(200).json(out);
}

/* ============ PLANS — get + update (preços editáveis) ============ */
/* ============ Diagnóstico: inspeciona um Stripe Coupon por ID ============ */
async function diagCoupon(req, res) {
  const id = String(req.query?.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing_id" });
  try {
    const c = await stripeClient().coupons.retrieve(id);
    return res.status(200).json({
      ok: true,
      id: c.id,
      name: c.name,
      amount_off: c.amount_off,
      percent_off: c.percent_off,
      currency: c.currency,
      duration: c.duration,
      duration_in_months: c.duration_in_months,
      valid: c.valid,
      applies_to: c.applies_to || null,
      metadata: c.metadata || {},
    });
  } catch (err) {
    return res.status(404).json({ error: "stripe_error", message: err.message });
  }
}

async function getPlans(_req, res) {
  const { data, error } = await db()
    .from("plan_config")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  return res.status(200).json({ plans: data || [] });
}

async function updatePlan(req, res) {
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  const tier = String(body.tier || "").toLowerCase();
  if (!["starter", "growth", "scale"].includes(tier)) {
    return res.status(400).json({ error: "invalid_tier" });
  }

  // Lê config atual
  const { data: current, error: readErr } = await db()
    .from("plan_config").select("*").eq("tier", tier).maybeSingle();
  if (readErr) return res.status(500).json({ error: "db_error", detail: readErr.message });
  if (!current) return res.status(404).json({ error: "plan_not_found" });

  // Campos editáveis + validação
  const patch = {};
  if (body.name != null) patch.name = String(body.name).slice(0, 80);
  if (body.monthly_usd != null) {
    const v = Number(body.monthly_usd);
    if (!(v >= 0 && v <= 100000)) return res.status(400).json({ error: "invalid_monthly" });
    patch.monthly_usd = v;
  }
  if (body.activation_usd != null) {
    const v = Number(body.activation_usd);
    if (!(v >= 0 && v <= 100000)) return res.status(400).json({ error: "invalid_activation" });
    patch.activation_usd = v;
  }
  let discountChanged = false;
  if (body.indicacao_discount_usd != null) {
    const v = Number(body.indicacao_discount_usd);
    if (!(v >= 0 && v <= 100000)) return res.status(400).json({ error: "invalid_discount" });
    if (v !== Number(current.indicacao_discount_usd)) discountChanged = true;
    patch.indicacao_discount_usd = v;
  }
  if (body.discount_type != null) {
    const t = String(body.discount_type);
    if (!["amount", "percent"].includes(t)) return res.status(400).json({ error: "invalid_discount_type" });
    if (t !== (current.discount_type || "amount")) discountChanged = true;
    patch.discount_type = t;
  }
  if (body.indicacao_duration != null) {
    const d = String(body.indicacao_duration);
    if (!["once", "repeating"].includes(d)) return res.status(400).json({ error: "invalid_duration" });
    if (d !== current.indicacao_duration) discountChanged = true;
    patch.indicacao_duration = d;
  }
  if (body.indicacao_months != null) {
    const m = body.indicacao_months === "" ? null : Number(body.indicacao_months);
    if (m !== null && !(m >= 1 && m <= 36)) return res.status(400).json({ error: "invalid_months" });
    if (m !== current.indicacao_months) discountChanged = true;
    patch.indicacao_months = m;
  }
  if (body.recreate_coupon) discountChanged = true; // força recriação
  if (Object.keys(patch).length === 0 && !body.recreate_coupon) {
    return res.status(400).json({ error: "no_fields" });
  }

  // Se o desconto/duração/tipo mudou, recria o Stripe Coupon (coupons são
  // imutáveis no Stripe) e arquiva o anterior.
  if (discountChanged) {
    const stripe = stripeClient();
    const amount = patch.indicacao_discount_usd ?? Number(current.indicacao_discount_usd);
    const duration = patch.indicacao_duration ?? current.indicacao_duration;
    const months = patch.indicacao_months ?? current.indicacao_months;
    const dtype = patch.discount_type ?? (current.discount_type || "amount");
    try {
      const params = {
        currency: "usd",
        duration,
        metadata: { role: "indicacao", tier, source: "spark-referral-hub" },
      };
      if (dtype === "percent") {
        params.percent_off = Math.min(100, Math.max(1, amount));
        params.name = `Indicação ${tier} — ${params.percent_off}% off`;
        delete params.currency; // percent coupons não usam currency
      } else {
        params.amount_off = Math.round(amount * 100);
        params.name = `Indicação ${tier} — $${amount} off`;
      }
      if (duration === "repeating") params.duration_in_months = months || 3;
      // Restringe o cupom ao produto do plano → SPARKOFF<TIER> só funciona
      // no tier correspondente (Stripe rejeita em outros produtos).
      if (current.product_id) {
        params.applies_to = { products: [current.product_id] };
      }
      const coupon = await stripe.coupons.create(params);

      // Promotion code legível (arquiva o antigo se existir mesmo code)
      const code = `INDICACAO_${tier.toUpperCase()}`;
      try {
        const existing = await stripe.promotionCodes.list({ code, limit: 5 });
        for (const pc of existing.data || []) {
          if (pc.active) await stripe.promotionCodes.update(pc.id, { active: false });
        }
      } catch {}
      try {
        await stripe.promotionCodes.create({ coupon: coupon.id, code, metadata: { role: "indicacao", tier } });
      } catch (e) {
        log.warn("update_plan.promo_recreate_failed", { tier, error: e.message });
      }

      // arquiva coupon antigo (best-effort)
      if (current.coupon_id) {
        try { await stripe.coupons.del(current.coupon_id); } catch {}
      }
      patch.coupon_id = coupon.id;
    } catch (err) {
      return res.status(502).json({ error: "stripe_coupon_failed", message: err.message });
    }
  }

  patch.updated_at = new Date().toISOString();
  const { error: updErr } = await db().from("plan_config").update(patch).eq("tier", tier);
  if (updErr) return res.status(500).json({ error: "db_error", detail: updErr.message });

  await audit({
    eventType: "admin.plan_updated",
    actor: "admin",
    resourceType: "plan",
    resourceId: tier,
    summary: `Plano ${tier} atualizado` + (discountChanged ? " (cupom recriado)" : ""),
    data: patch,
  });

  return res.status(200).json({ ok: true, tier, updated: patch, coupon_recreated: discountChanged });
}

/* ============ BACKFILL per-plan promo codes ============ */
/**
 * Cria os 3 promotion codes per-plano (SPARKOFF*) pra installations que
 * ainda não têm plan_coupons. Processa em lote (limit configurável) pra
 * caber no maxDuration da função. Idempotente — pode chamar várias vezes.
 *
 * POST ?action=backfill_plan_coupons  body: { limit?: number }
 */
async function backfillPlanCoupons(req, res) {
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { body = {}; }
  const limit = Math.min(Number(body.limit) || 25, 60);

  // Carrega os coupon_ids compartilhados (com applies_to product).
  const { data: plans, error: planErr } = await db()
    .from("plan_config").select("tier, coupon_id");
  if (planErr) return res.status(500).json({ error: "db_error", detail: planErr.message });
  const planCouponIds = {};
  for (const p of plans || []) if (p.coupon_id) planCouponIds[p.tier] = p.coupon_id;
  if (!Object.keys(planCouponIds).length) {
    return res.status(400).json({ error: "no_plan_coupons", message: "plan_config sem coupon_id" });
  }

  // Locations ainda sem plan_coupons.
  const { data: rows, error: rowErr } = await db()
    .from("installations")
    .select("location_id, location_name")
    .is("plan_coupons", null)
    .limit(limit);
  if (rowErr) return res.status(500).json({ error: "db_error", detail: rowErr.message });

  let processed = 0, created = 0, failed = 0;
  for (const row of rows || []) {
    processed++;
    try {
      const codes = await ensureLocationPlanCoupons(row.location_id, row.location_name, planCouponIds);
      if (codes && Object.keys(codes).length) {
        await db().from("installations").update({ plan_coupons: codes }).eq("location_id", row.location_id);
        created++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      log.warn("backfill.location_failed", { location: row.location_id, error: err.message });
    }
  }

  // Quantas ainda faltam?
  const { count: remaining } = await db()
    .from("installations").select("location_id", { count: "exact", head: true }).is("plan_coupons", null);

  await audit({
    eventType: "admin.backfill_plan_coupons",
    actor: "admin",
    resourceType: "installations",
    summary: `Backfill cupons per-plano: ${created} criados, ${failed} falhas, ${remaining ?? "?"} restantes`,
    data: { processed, created, failed, remaining },
  });

  return res.status(200).json({ ok: true, processed, created, failed, remaining: remaining ?? null, done: (remaining ?? 0) === 0 });
}

/* ============ CREATE referral ============ */
async function createReferral(req, res) {
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  const indicadorLocation = String(body.indicador_location || "").trim();
  if (!indicadorLocation || !/^[A-Za-z0-9]{15,30}$/.test(indicadorLocation)) {
    return res.status(400).json({ error: "invalid_indicador_location" });
  }
  const { data: install, error: instErr } = await db()
    .from("installations").select("location_id, location_name").eq("location_id", indicadorLocation).maybeSingle();
  if (instErr) return res.status(500).json({ error: "db_error", detail: instErr.message });
  if (!install) return res.status(404).json({ error: "indicador_not_found" });

  const indicadoEmail = String(body.indicado_email || "").trim().toLowerCase();
  if (!indicadoEmail || !/^\S+@\S+\.\S+$/.test(indicadoEmail)) return res.status(400).json({ error: "invalid_indicado_email" });
  const indicadoName = String(body.indicado_name || "").trim().slice(0, 200);
  if (!indicadoName) return res.status(400).json({ error: "missing_indicado_name" });

  const tier = body.tier_purchased ? String(body.tier_purchased).toLowerCase() : null;
  if (tier && !["starter", "growth", "scale"].includes(tier)) return res.status(400).json({ error: "invalid_tier_purchased" });

  const allowedStatus = ["pending", "paid", "qualified"];
  const status = body.status && allowedStatus.includes(body.status) ? body.status : "pending";

  const insert = {
    indicador_location: indicadorLocation,
    indicado_email: indicadoEmail,
    indicado_name: indicadoName,
    tier_purchased: tier,
    cupom_code: body.cupom_code ? String(body.cupom_code).slice(0, 40) : null,
    activation_paid: !!body.activation_paid,
    status,
  };
  if (status === "paid" || status === "qualified") insert.first_payment_at = new Date().toISOString();
  if (status === "qualified") insert.qualified_at = new Date().toISOString();

  const { data: created, error: insErr } = await db().from("referrals").insert(insert).select().single();
  if (insErr) {
    if (insErr.code === "23505" || /duplicate/i.test(insErr.message || "")) {
      return res.status(409).json({ error: "duplicate_referral" });
    }
    return res.status(500).json({ error: "db_error", detail: insErr.message });
  }

  await audit({
    eventType: "admin.referral_created",
    actor: "admin",
    resourceType: "referral",
    resourceId: created.id,
    summary: `${indicadoName} indicado por ${install.location_name || indicadorLocation} (${status})`,
    data: { tier, status },
  });

  if (status === "qualified") {
    try { await recomputeTier(indicadorLocation, { reason: "admin_manual" }); }
    catch (err) { log.warn("admin.recompute_failed", { error: err.message }); }
  }

  return res.status(201).json({ ok: true, referral: created, indicador_name: install.location_name });
}

/* ============ UPDATE referral ============ */
async function updateReferral(req, res) {
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "invalid_json" }); }
  const id = body.id;
  if (!id) return res.status(400).json({ error: "missing_id" });

  const allowed = [
    "indicado_email", "indicado_name", "tier_purchased", "cupom_code",
    "activation_paid", "status", "first_payment_at", "qualified_at",
    "disqualification_reason",
  ];
  const patch = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no_fields" });

  if (patch.status && !["pending", "paid", "qualified", "refunded", "fraud", "canceled"].includes(patch.status))
    return res.status(400).json({ error: "invalid_status" });
  if (patch.tier_purchased && !["starter", "growth", "scale"].includes(patch.tier_purchased))
    return res.status(400).json({ error: "invalid_tier_purchased" });
  if (patch.status === "qualified" && !patch.qualified_at) patch.qualified_at = new Date().toISOString();

  const { data: updated, error } = await db()
    .from("referrals").update(patch).eq("id", id)
    .select("indicador_location, status, indicado_name").maybeSingle();
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  if (!updated) return res.status(404).json({ error: "not_found" });

  await audit({
    eventType: "admin.referral_updated",
    actor: "admin",
    resourceType: "referral",
    resourceId: id,
    summary: `${updated.indicado_name} → ${patch.status || "(parcial)"}`,
    data: patch,
  });

  if (patch.status === "qualified" || ["refunded", "fraud", "canceled"].includes(patch.status)) {
    try { await recomputeTier(updated.indicador_location, { reason: `admin_${patch.status}` }); }
    catch {}
  }
  return res.status(200).json({ ok: true });
}

async function deleteReferral(req, res) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "missing_id" });
  const { data: row } = await db().from("referrals").select("indicador_location, indicado_name").eq("id", id).maybeSingle();
  if (!row) return res.status(404).json({ error: "not_found" });
  const { error } = await db().from("referrals").delete().eq("id", id);
  if (error) return res.status(500).json({ error: "db_error" });
  try { await recomputeTier(row.indicador_location, { reason: "admin_deleted" }); } catch {}
  await audit({
    eventType: "admin.referral_deleted",
    actor: "admin",
    resourceType: "referral",
    resourceId: id,
    summary: `Removida: ${row.indicado_name}`,
  });
  return res.status(200).json({ ok: true });
}

/* ============ BULK OPERATIONS ============ */
async function bulkRecompute(_req, res) {
  // Recomputa tier de todas locations que têm pelo menos 1 qualified ref
  const { data: locs } = await db()
    .from("referrals")
    .select("indicador_location")
    .eq("status", "qualified");
  const unique = [...new Set((locs || []).map((r) => r.indicador_location))];
  const summary = { total: unique.length, recomputed: 0, errors: [] };
  for (const id of unique) {
    try {
      await recomputeTier(id, { reason: "bulk_recompute" });
      summary.recomputed++;
    } catch (err) {
      summary.errors.push({ id, error: err.message });
    }
  }
  await audit({
    eventType: "admin.bulk_recompute",
    actor: "admin",
    summary: `Recomputou ${summary.recomputed}/${summary.total} indicadores`,
    data: summary,
  });
  return res.status(200).json({ ok: true, summary });
}

async function bulkSync(_req, res) {
  // Roda o sync-locations agora — mas o real cron tem max 30s.
  // Aqui retornamos status pra UI; o sync de verdade roda async.
  const pit = process.env.GHL_AGENCY_PIT;
  if (!pit) return res.status(500).json({ error: "no_agency_pit" });

  let locations = [];
  try {
    const r = await fetch(
      "https://services.leadconnectorhq.com/locations/search?limit=1000",
      { headers: { Authorization: `Bearer ${pit}`, Version: "2021-07-28", Accept: "application/json" } },
    );
    if (r.ok) { const d = await r.json(); locations = d.locations || []; }
  } catch (err) {
    return res.status(502).json({ error: "ghl_fetch_failed", message: err.message });
  }

  const { data: existing } = await db().from("installations").select("location_id");
  const haveIds = new Set((existing || []).map((r) => r.location_id));
  const missing = locations.filter((l) => l.id && !haveIds.has(l.id)).slice(0, 30);

  const summary = { total_in_agency: locations.length, in_db: haveIds.size, missing_total: locations.length - haveIds.size, processed: 0, errors: [] };
  for (const loc of missing) {
    try {
      await ensureInstallation(loc.id, { locationName: loc.name, companyId: loc.companyId });
      summary.processed++;
    } catch (err) {
      summary.errors.push({ id: loc.id, error: err.message });
    }
  }
  await audit({
    eventType: "admin.bulk_sync",
    actor: "admin",
    summary: `Sync provisionou ${summary.processed} novas locations`,
    data: summary,
  });
  return res.status(200).json({ ok: true, summary });
}
