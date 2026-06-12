/**
 * GHL helpers — usa o PIT da subaccount MASTER (efZEjK6PqtPGDHqB2vV6) pra
 * listar/buscar cupons criados lá. Os cupons seguem o padrão:
 *
 *   name: "{location_name} {Tier}"        ← Starter / Growth / Agency
 *   code: "{UPPERCASE_NAME}{TIER}"        ← ex.: VIVIANOSORIOSACSB9STARTER
 *
 * Tier mapping (interno ↔ GHL):
 *   starter ↔ Starter
 *   growth  ↔ Growth
 *   scale   ↔ Agency        ← nosso "Scale" é o tier "Agency" na GHL
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

const GHL_TIER_MAP = {
  starter: "Starter",
  growth: "Growth",
  scale: "Agency",
};
const TIER_FROM_GHL = {
  starter: "starter",
  growth: "growth",
  agency: "scale",
};

export function ghlPit() {
  const t = process.env.GHL_MASTER_PIT;
  if (!t) throw new Error("GHL_MASTER_PIT not configured");
  return t;
}
export function ghlMasterLocation() {
  return process.env.GHL_MASTER_LOCATION_ID || "efZEjK6PqtPGDHqB2vV6";
}

async function ghlFetch(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${ghlPit()}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GHL ${r.status} ${path}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Lista TODOS os cupons da master subaccount (pagina por offset, limit 100).
 * Retorna array bruto. ~793 cupons hoje, ~8 requests.
 */
export async function listAllGhlCoupons() {
  const altId = ghlMasterLocation();
  const out = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 30; page++) {
    const j = await ghlFetch("/payments/coupon/list", {
      altId,
      altType: "location",
      limit,
      offset,
    });
    const items = j.data || [];
    out.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return out;
}

/**
 * Normaliza um nome de location pra comparação tolerante:
 * remove acentos, emojis, pontuação, case-fold, colapsa espaços.
 */
export function normalizeName(s) {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")            // acentos
    .replace(/[^a-zA-Z0-9 ]+/g, " ")            // emojis, pontuação
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dado o name de um cupom GHL ("Wagner Witka's Account Starter"), extrai
 * { locationName, tier } onde tier ∈ {starter, growth, scale} (mapeado).
 * Retorna null se o nome não casa o padrão.
 *
 * Skipa explicitamente cupons marcados como "⚠️ ORFA" ou contendo "MASTER"
 * (cupons especiais da própria SparkLeads, não-indicador).
 */
export function parseCouponName(name) {
  if (!name || typeof name !== "string") return null;
  if (/orfa|órfa|orphan|master|test\b/i.test(name)) return null;

  // tier sufixo no FINAL do nome
  const m = name.match(/^(.*?)\s+(Starter|Growth|Agency)\s*$/i);
  if (!m) return null;
  const locationName = m[1].trim();
  const ghlTier = m[2].toLowerCase();
  const internalTier = TIER_FROM_GHL[ghlTier];
  if (!internalTier) return null;
  return { locationName, tier: internalTier };
}

export { GHL_TIER_MAP, TIER_FROM_GHL };
