/**
 * /api/crm — leitura dos dados da sub-account no GoHighLevel.
 *
 *   GET ?action=status         → diagnóstico de configuração e escopos
 *   GET ?action=contacts       → contatos normalizados + colunas
 *   GET ?action=opportunities  → oportunidades + pipelines
 *   GET ?action=contact&id=    → contato + notas + tarefas
 *
 * Somente leitura nesta fase. Escrita de volta no GHL exige política de
 * conflito, e isso é assunto de outra etapa.
 */
import {
  resolveContext, sendError, WorkspaceError,
} from "../lib/server/context.js";
import {
  isConfigured, ghlLocationId, checkScopes, getLocation,
  listContacts, listCustomFields, listTags, listOpportunities, listPipelines,
  listContactNotes, listContactTasks, GhlError,
} from "../lib/server/ghl.js";
import {
  STANDARD_CONTACT_FIELDS, OPPORTUNITY_FIELDS,
  customFieldsToColumns, tagsToOptions, contactToRecord, opportunityToRecord,
} from "../src/shared/crm.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    await resolveContext(req);
  } catch (err) {
    return sendError(res, err);
  }

  const action = req.query?.action || "status";

  try {
    if (action === "status") return res.status(200).json(await status());
    if (!isConfigured()) throw new WorkspaceError(503, "ghl_not_configured");

    if (action === "contacts")      return res.status(200).json(await contacts(req));
    if (action === "opportunities") return res.status(200).json(await opportunities(req));
    if (action === "contact")       return res.status(200).json(await contactDetail(req));

    throw new WorkspaceError(400, "unknown_action", { action });
  } catch (err) {
    if (err instanceof GhlError) {
      log.warn("crm.request_failed", { action, code: err.code, status: err.status });
      return res.status(err.status === 401 ? 502 : err.status).json({
        error: err.code,
        detail: err.detail,
        ...(err.code === "missing_scope" ? { fix: SCOPE_FIX } : {}),
      });
    }
    return sendError(res, err);
  }
}

const SCOPE_FIX =
  "O token do GHL não tem escopo para este recurso. Na Private Integration, " +
  "habilite leitura de Contacts, Opportunities, Custom Fields e Tags.";

async function status() {
  const configured = isConfigured();
  if (!configured) {
    return {
      configured: false,
      locationId: ghlLocationId(),
      hint: "Defina GHL_LOCATION_TOKEN (e GHL_LOCATION_ID, se diferente do tenant fixo).",
    };
  }
  const scopes = await checkScopes();
  const missing = Object.entries(scopes)
    .filter(([, v]) => !v.ok && v.code === "missing_scope")
    .map(([k]) => k);

  let location = null;
  if (scopes.location?.ok) {
    try {
      const l = await getLocation();
      location = { id: l?.id, name: l?.name };
    } catch { /* já refletido em scopes */ }
  }

  return {
    configured: true,
    locationId: ghlLocationId(),
    location,
    scopes,
    missingScopes: missing,
    ready: missing.length === 0,
    ...(missing.length ? { fix: SCOPE_FIX } : {}),
  };
}

async function contacts(req) {
  const limit = Math.min(Number(req.query?.limit) || 200, 500);
  const [rows, customFields, tags] = await Promise.all([
    listContacts({ limit }),
    listCustomFields(),
    listTags().catch(() => []),
  ]);

  const columns = [
    ...STANDARD_CONTACT_FIELDS,
    ...customFieldsToColumns(customFields),
  ].map((c) => (c.key === "tags" ? { ...c, options: tagsToOptions(tags) } : c));

  return {
    source: "ghl",
    locationId: ghlLocationId(),
    columns,
    records: rows.map((c) => contactToRecord(c, customFields)),
    total: rows.length,
    truncated: rows.length >= limit,
  };
}

async function opportunities(req) {
  const limit = Math.min(Number(req.query?.limit) || 200, 500);
  const [rows, pipelines] = await Promise.all([
    listOpportunities({ limit }),
    listPipelines().catch(() => []),
  ]);

  const stageOptions = pipelines.flatMap((p) =>
    (p.stages || []).map((s) => ({ id: s.name, name: s.name, color: "blue" })));

  const columns = OPPORTUNITY_FIELDS.map((c) => {
    if (c.key === "stage") return { ...c, options: stageOptions };
    if (c.key === "pipeline") {
      return { ...c, options: pipelines.map((p) => ({ id: p.name, name: p.name, color: "gray" })) };
    }
    if (c.key === "status") {
      return { ...c, options: ["open", "won", "lost", "abandoned"]
        .map((s) => ({ id: s, name: s, color: s === "won" ? "green" : s === "lost" ? "red" : "gray" })) };
    }
    return c;
  });

  return {
    source: "ghl",
    columns,
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    records: rows.map((o) => opportunityToRecord(o, pipelines)),
    total: rows.length,
    truncated: rows.length >= limit,
  };
}

async function contactDetail(req) {
  const id = req.query?.id;
  if (!id) throw new WorkspaceError(400, "missing_id");
  const [notes, tasks] = await Promise.all([
    listContactNotes(id).catch(() => []),
    listContactTasks(id).catch(() => []),
  ]);
  return { contactId: id, notes, tasks };
}
