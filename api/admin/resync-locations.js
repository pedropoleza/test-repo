/**
 * POST /api/admin/resync-locations
 * Header: x-cron-secret: <CRON_SECRET>
 * Query: ?limit=20  (default 10, max 50)
 *        ?offset=0  (paginação manual)
 *
 * Provisiona um lote de locations (via PIT da agency) que ainda não
 * têm installation. É opcional — o lazy provisioning em
 * ghl-context/tier já cobre as locations conforme elas abrem o app.
 *
 * Útil pra:
 *   - Pré-criar Stripe Coupons antes do agency_owner divulgar o programa
 *   - Backfill após adicionar o GHL_AGENCY_PIT
 *
 * Como evitar timeout do Vercel (10s):
 *   - Cada provisionamento dura ~300-800ms (1 GHL + 2 Stripe calls)
 *   - Limite default de 10 cabe em ~5-8s. Pra varrer todas as 253
 *     locations: chamar várias vezes incrementando offset, ou plugar
 *     num cron diário.
 */
import { ensureInstallation } from "../../lib/server/provision.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const pit = process.env.GHL_AGENCY_PIT;
  if (!pit) return res.status(500).json({ error: "no_agency_pit" });

  const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 10));
  const offset = Math.max(0, Number(req.query?.offset) || 0);

  // Lista locations da agency
  let locations;
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/locations/search?limit=1000`,
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
    locations = data?.locations || [];
  } catch (err) {
    return res.status(502).json({ error: "ghl_fetch_error", message: err.message });
  }

  const slice = locations.slice(offset, offset + limit);
  const summary = {
    total_in_agency: locations.length,
    offset,
    limit,
    in_batch: slice.length,
    provisioned: 0,
    already_existed: 0,
    errors: [],
  };

  for (const loc of slice) {
    try {
      const installed = await ensureInstallation(loc.id, {
        locationName: loc.name,
        companyId: loc.companyId,
      });
      // ensureInstallation devolve a row (nova ou existente). Distinguimos
      // por last_sync_at recente — heurística boa o suficiente pra esse log.
      if (
        installed?.provision_source === "agency_pit" &&
        installed?.coupon_code
      ) {
        summary.provisioned++;
      } else {
        summary.already_existed++;
      }
    } catch (err) {
      summary.errors.push({
        location_id: loc.id,
        name: loc.name,
        error: err?.message || String(err),
      });
    }
  }

  console.info("[admin.resync] batch:", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
