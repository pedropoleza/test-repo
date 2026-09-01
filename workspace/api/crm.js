/**
 * /api/crm — leitura e escrita dos dados da conta no CRM.
 *
 *   GET ?action=status         → diagnóstico de configuração e escopos
 *   GET ?action=contacts       → contatos normalizados + colunas
 *   GET ?action=opportunities  → oportunidades + pipelines
 *   GET ?action=contact&id=    → contato + notas + tarefas
 *
 *   POST action=move-stage        → move a oportunidade de estágio
 *   POST action=update-opportunity → grava campos da oportunidade
 *   POST action=update-contact     → grava campos do contato
 *
 *   GET  ?action=lists         → abas salvas de pipeline/estágio
 *   POST action=list-create    → cria uma aba a partir de pipeline/estágio
 *   POST action=list-update    → renomeia ou troca o ícone
 *   POST action=list-delete    → remove a aba (não toca no CRM)
 *
 * A escrita é campo a campo e sempre parcial: mandamos só o que mudou.
 * Não há resolução de conflito — quem grava por último vence, igual ao
 * próprio CRM. O que evitamos é o pior caso, que é um PUT com o objeto
 * inteiro apagando alterações feitas por outra pessoa no intervalo.
 */
import {
  resolveContext, requireRole, sendError, WorkspaceError,
} from "../lib/server/context.js";
import { openContactDossier, listDossiers } from "../lib/server/dossier.js";
import {
  listCrmLists, createCrmList, updateCrmList, deleteCrmList,
} from "../lib/server/crm-lists.js";
import {
  isConfigured, ghlLocationId, checkScopes, getLocation,
  listContacts, listCustomFields, listTags, listOpportunities, listPipelines, listUsers,
  listContactOpportunities, moveOpportunity, updateOpportunity, updateContact, GhlError,
} from "../lib/server/ghl.js";
import {
  STANDARD_CONTACT_FIELDS, OPPORTUNITY_FIELDS, OPPORTUNITY_STATUS,
  customFieldsToColumns, tagsToOptions, usersToOptions, stageOptions,
  contactToRecord, opportunityToRecord, opportunityPatch, contactPatch,
} from "../src/shared/crm.js";
import { loadContactDetail } from "../lib/server/contact-detail.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let ctx;
  try {
    ctx = await resolveContext(req);
  } catch (err) {
    return sendError(res, err);
  }

  const body = parseBody(req);
  const action = req.query?.action || body.action || "status";

  try {
    if (action === "status") return res.status(200).json(await status());
    if (action === "dossiers") return res.status(200).json({ dossiers: await listDossiers(ctx) });

    if (action === "lists") return res.status(200).json({ lists: await listCrmLists(ctx) });

    if (action === "list-create") {
      requireRole(ctx, "editor");
      const list = await createCrmList(ctx, body);
      log.info("crm.list.created", { workspaceId: ctx.workspaceId, listId: list.id });
      return res.status(201).json({ list });
    }
    if (action === "list-update") {
      requireRole(ctx, "editor");
      return res.status(200).json({ list: await updateCrmList(ctx, body.id, body) });
    }
    if (action === "list-delete") {
      requireRole(ctx, "editor");
      await deleteCrmList(ctx, body.id || req.query?.id);
      return res.status(200).json({ ok: true });
    }

    if (!isConfigured()) throw new WorkspaceError(503, "ghl_not_configured");

    if (action === "contacts")      return res.status(200).json(await contacts(req));
    if (action === "opportunities") return res.status(200).json(await opportunities(req));
    if (action === "contact")       return res.status(200).json(await contactDetail(req));

    if (action === "contact-opportunities") {
      const id = req.query?.id || body.contactId;
      if (!id) throw new WorkspaceError(400, "missing_id");
      const [rows, pipelines, users] = await Promise.all([
        listContactOpportunities(id),
        listPipelines().catch(() => []),
        listUsers().catch(() => []),
      ]);
      return res.status(200).json({
        contactId: id,
        pipelines: pipelines.map((p) => ({
          id: p.id, name: p.name,
          stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
        })),
        users: users.map((u) => ({ id: u.id, name: u.name })),
        opportunities: rows.map((o) => ({
          ...opportunityToRecord(o, pipelines),
          pipelineId: o.pipelineId,
          stageId: o.pipelineStageId,
        })),
      });
    }

    if (action === "move-stage") {
      requireRole(ctx, "editor");
      const { opportunityId, pipelineId, stageId } = body;
      const moved = await moveOpportunity(opportunityId, { pipelineId, stageId });
      log.info("crm.opportunity.moved", {
        workspaceId: ctx.workspaceId, opportunityId, stageId,
      });
      return res.status(200).json({ opportunity: moved });
    }

    if (action === "update-opportunity") {
      requireRole(ctx, "editor");
      const { opportunityId, changes } = body;
      if (!opportunityId) throw new WorkspaceError(400, "missing_id");
      const patch = opportunityPatch(changes || {});
      if (!Object.keys(patch).length) throw new WorkspaceError(400, "nothing_to_update");
      const updated = await updateOpportunity(opportunityId, patch);
      log.info("crm.opportunity.updated", {
        workspaceId: ctx.workspaceId, opportunityId, fields: Object.keys(patch),
      });
      return res.status(200).json({ opportunity: updated });
    }

    if (action === "update-contact") {
      requireRole(ctx, "editor");
      const { contactId, changes } = body;
      if (!contactId) throw new WorkspaceError(400, "missing_id");
      const patch = contactPatch(changes || {});
      if (!Object.keys(patch).length) throw new WorkspaceError(400, "nothing_to_update");
      const updated = await updateContact(contactId, patch);
      log.info("crm.contact.updated", {
        // Os nomes dos campos entram no log; os valores não — um deles
        // pode ser telefone ou e-mail do lead.
        workspaceId: ctx.workspaceId, contactId, fields: Object.keys(patch),
      });
      return res.status(200).json({ contact: updated });
    }

    if (action === "dossier") {
      requireRole(ctx, "editor");
      const contactId = req.query?.contactId || body.contactId;
      const result = await openContactDossier(ctx, contactId);
      log.info("crm.dossier.opened", {
        workspaceId: ctx.workspaceId, pageId: result.page.id, created: result.created,
      });
      return res.status(result.created ? 201 : 200).json(result);
    }

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
  "O token não tem permissão para este recurso. Habilite leitura de Contatos, " +
  "Oportunidades, Campos personalizados e Tags na integração da conta.";

async function status() {
  const configured = isConfigured();
  if (!configured) {
    return {
      configured: false,
      locationId: ghlLocationId(),
      hint: "Defina SPARK_CRM_TOKEN (e SPARK_CRM_ACCOUNT_ID, se diferente do tenant fixo).",
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
    source: "spark",
    locationId: ghlLocationId(),
    columns,
    records: rows.map((c) => contactToRecord(c, customFields)),
    total: rows.length,
    truncated: rows.length >= limit,
  };
}

async function opportunities(req) {
  const limit = Math.min(Number(req.query?.limit) || 200, 500);
  const [rows, pipelines, users] = await Promise.all([
    listOpportunities({ limit }),
    listPipelines().catch(() => []),
    listUsers().catch(() => []),
  ]);

  const estagios = stageOptions(pipelines);

  const columns = OPPORTUNITY_FIELDS.map((c) => {
    if (c.key === "stage") return { ...c, options: estagios };
    if (c.key === "pipeline") {
      return { ...c, options: pipelines.map((p) => ({ id: p.name, name: p.name, color: "gray" })) };
    }
    if (c.key === "status") return { ...c, options: OPPORTUNITY_STATUS };
    if (c.key === "assigned") {
      return { ...c, options: usersToOptions(users, rows.map((o) => o.assignedTo)) };
    }
    return c;
  });

  return {
    source: "spark",
    columns,
    // Com os estágios: é o que permite mover a oportunidade direto da
    // célula, inclusive para outra pipeline.
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
    })),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    records: rows.map((o) => ({
      ...opportunityToRecord(o, pipelines),
      pipelineId: o.pipelineId,
      stageId: o.pipelineStageId,
    })),
    total: rows.length,
    truncated: rows.length >= limit,
  };
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

async function contactDetail(req) {
  return loadContactDetail(req.query?.id);
}
