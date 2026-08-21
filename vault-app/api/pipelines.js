/**
 * GET /api/pipelines — funis (setores) da location + o funil/estágio de cada
 * contato (via oportunidades). Usado para segmentar as pastas por setor.
 *
 * Auth: JWT da sessão (escopo por location). Requer os scopes opportunities.readonly
 * (search) e pipelines.readonly / opportunities.readonly (pipelines).
 */
import { verify as jwtVerify } from "../lib/jwt.js";
import { getVaultLocationToken } from "../lib/ghl-token.js";

const BASE = "https://services.leadconnectorhq.com";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const token = req.headers["x-vault-session"] || req.query?.session;
  if (!token) return res.status(401).json({ error: "missing_session" });
  let claims;
  try { claims = jwtVerify(token); } catch (err) { return res.status(401).json({ error: "invalid_session", reason: err.message }); }
  const locationId = claims.locationId;
  if (!locationId) return res.status(403).json({ error: "no_location" });

  let ghlToken;
  try { ghlToken = await getVaultLocationToken(locationId); }
  catch (err) { return res.status(502).json({ error: "ghl_token", reason: err.message }); }

  const G = async (path, params = {}) => {
    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${ghlToken}`, Version: "2021-07-28", Accept: "application/json" } });
    if (!r.ok) throw Object.assign(new Error("ghl_" + r.status), { status: r.status });
    return r.json();
  };

  try {
    const pj = await G("/opportunities/pipelines", { locationId });
    const pipelines = (pj.pipelines || []).map((p) => ({
      id: p.id,
      name: p.name,
      stages: Object.fromEntries((p.stages || []).map((s) => [s.id, s.name])),
    }));
    const pipeName = Object.fromEntries(pipelines.map((p) => [p.id, p.name]));
    const stageName = {};
    for (const p of pipelines) Object.assign(stageName, p.stages);

    // Oportunidades da location (1 página; MVP). Mapeia contato -> funil/estágio.
    const contacts = {};
    try {
      const oj = await G("/opportunities/search", { location_id: locationId, limit: 100 });
      for (const o of (oj.opportunities || [])) {
        const cid = o.contactId || o.contact?.id;
        if (!cid) continue;
        const stId = o.pipelineStageId || o.stageId;
        // mantém a oportunidade mais recente por contato (a última vista)
        contacts[cid] = {
          pipelineId: o.pipelineId,
          pipelineName: pipeName[o.pipelineId] || null,
          stageId: stId,
          stageName: stageName[stId] || null,
          status: o.status,
        };
      }
    } catch (err) {
      console.warn("[pipelines] opportunities search failed:", err.message);
    }

    return res.status(200).json({
      pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
      contacts,
    });
  } catch (err) {
    console.error("[pipelines] failed:", err.message || err);
    return res.status(502).json({ error: "pipelines_failed", status: err.status || null });
  }
}
