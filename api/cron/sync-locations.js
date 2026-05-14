/**
 * GET /api/cron/sync-locations
 *
 * Cron de reconciliação que substitui o webhook GHL (que não suporta
 * assinatura nessa conta — risco de eventos forjados).
 *
 * Roda a cada hora (vercel.json):
 *   1. Lista /locations/search via PIT (todas as sub-accounts da agency)
 *   2. Compara com installations no banco
 *   3. Provisiona as que faltam (ensureInstallation cria cupom também)
 *   4. Loga novidades
 *
 * Como tem 253+ locations, processa um batch limitado por chamada e
 * confia no schedule diário pra eventualmente cobrir todos. Em pratica,
 * o lazy provisioning via SSO já cobre os que abrem o app — esse cron
 * é safety net pras que ninguém abriu ainda.
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { ensureInstallation } from "../../lib/server/provision.js";

const DEFAULT_BATCH_SIZE = 30; // ~15s sequencial, cabe em 60s timeout

function safeEq(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const isVercelCron = !!req.headers["x-vercel-cron"];
  if (!isVercelCron && !safeEq(process.env.CRON_SECRET, req.headers["x-cron-secret"])) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const pit = process.env.GHL_AGENCY_PIT;
  if (!pit) return res.status(500).json({ error: "no_agency_pit" });

  const batchSize = Math.min(
    100,
    Math.max(1, Number(req.query?.batch) || DEFAULT_BATCH_SIZE),
  );

  // 1) Lista locations no GHL
  let allLocations;
  try {
    const r = await fetch(
      "https://services.leadconnectorhq.com/locations/search?limit=1000",
      {
        headers: {
          Authorization: `Bearer ${pit}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({
        error: "ghl_search_failed",
        status: r.status,
        body: txt.slice(0, 200),
      });
    }
    const data = await r.json();
    allLocations = data?.locations || [];
  } catch (err) {
    return res.status(502).json({ error: "ghl_fetch_error", message: err.message });
  }

  // 2) Lista installations já no banco
  const { data: existing, error: dbErr } = await db()
    .from("installations")
    .select("location_id");
  if (dbErr) return res.status(500).json({ error: "db_error", detail: dbErr.message });

  const installedIds = new Set((existing || []).map((r) => r.location_id));

  // 3) Filtra as que faltam, processa só o batch
  const missing = allLocations
    .filter((l) => l.id && !installedIds.has(l.id))
    .slice(0, batchSize);

  const summary = {
    total_in_agency: allLocations.length,
    total_in_db: installedIds.size,
    missing_total: allLocations.length - installedIds.size,
    batch_size: batchSize,
    processed: 0,
    provisioned: 0,
    errors: [],
  };

  for (const loc of missing) {
    summary.processed++;
    try {
      await ensureInstallation(loc.id, {
        locationName: loc.name,
        companyId: loc.companyId,
      });
      summary.provisioned++;
    } catch (err) {
      summary.errors.push({
        location_id: loc.id,
        name: loc.name,
        error: err?.message || String(err),
      });
    }
  }

  console.info("[cron.sync-locations]", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
