/**
 * Ficha do contato ("capa"): uma página do workspace ligada a um contato
 * do GHL.
 *
 * IDEMPOTÊNCIA (§47): a página guarda source='ghl_contact' e
 * source_external_id=<id do contato>, com unique index já criado na
 * migration 0001. Abrir a ficha do mesmo contato duas vezes devolve a
 * MESMA página — nunca duplica.
 *
 * A ficha nasce com um retrato dos dados do CRM em blocos. Depois disso
 * ela é conteúdo local: continua legível e editável mesmo com o GHL fora
 * do ar, que é a doutrina do produto (D3 e §3).
 */
import { db } from "./db.js";
import { keysBetween, keyBetween } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { ensureSectionByName } from "./sections.js";
import { recordRevision } from "./revisions.js";
import {
  listCustomFields, ghlFetch, listPipelines,
  listContactNotes, listContactTasks,
} from "./ghl.js";
import { contactToRecord, opportunityToRecord } from "../../src/shared/crm.js";
import { normalizeBlockContent } from "../../src/shared/blocks.js";

const SOURCE = "ghl_contact";
export const DOSSIER_SECTION = "Contatos";

const PAGE_FIELDS =
  "id,workspace_id,parent_page_id,section_id,title,icon_type,icon_value," +
  "properties,source,source_external_id,position,is_archived,created_at,updated_at";

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

/** Fichas existentes: contactId → pageId. Usado para marcar a tabela. */
export async function listDossiers(ctx) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select("id,title,source_external_id,is_archived")
    .eq("workspace_id", ctx.workspaceId)
    .eq("source", SOURCE);
  if (error) fail(error);
  return (data || [])
    .filter((p) => !p.is_archived)
    .map((p) => ({ contactId: p.source_external_id, pageId: p.id, title: p.title }));
}

export async function findDossier(ctx, contactId) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select(PAGE_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("source", SOURCE)
    .eq("source_external_id", contactId)
    .maybeSingle();
  if (error) fail(error);
  return data || null;
}

/**
 * Abre a ficha do contato, criando na primeira vez.
 * Devolve { page, created }.
 */
export async function openContactDossier(ctx, contactId) {
  if (!contactId) throw new WorkspaceError(400, "missing_contactId");

  const existing = await findDossier(ctx, contactId);
  if (existing) {
    if (existing.is_archived) {
      // Ficha na lixeira: restaura em vez de criar uma segunda.
      await db().from("workspace_pages")
        .update({ is_archived: false, archived_at: null })
        .eq("workspace_id", ctx.workspaceId).eq("id", existing.id);
      return { page: { ...existing, is_archived: false }, created: false, restored: true };
    }
    return { page: existing, created: false };
  }

  const snapshot = await fetchSnapshot(contactId);
  const section = await ensureSectionByName(ctx, DOSSIER_SECTION);

  const siblings = await sectionPages(ctx, section.id);
  const last = siblings[siblings.length - 1];

  const { data: page, error } = await db()
    .from("workspace_pages")
    .insert({
      workspace_id: ctx.workspaceId,
      section_id: section.id,
      title: snapshot.record.title,
      icon_type: "emoji",
      icon_value: "👤",
      cover_type: "gradient",
      cover_value: "spark-blue",
      properties: snapshot.record.properties,
      source: SOURCE,
      source_external_id: contactId,
      position: keyBetween(last ? last.position : null, null),
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    })
    .select(PAGE_FIELDS)
    .maybeSingle();
  if (error) fail(error, "dossier_create_failed");

  await insertBlocks(ctx, page.id, buildBlocks(snapshot));
  await recordRevision(ctx, {
    pageId: page.id, entityType: "page", entityId: page.id,
    operation: "create", after: { source: SOURCE, contactId },
  });

  return { page, created: true, sectionId: section.id };
}

async function sectionPages(ctx, sectionId) {
  const { data } = await db()
    .from("workspace_pages")
    .select("id,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("section_id", sectionId);
  return (data || []).sort((a, b) => (a.position < b.position ? -1 : 1));
}

/** Busca tudo que compõe a ficha. Partes opcionais não derrubam o todo. */
async function fetchSnapshot(contactId) {
  const contact = await ghlFetch(`/contacts/${contactId}`).then((d) => d?.contact);
  if (!contact) throw new WorkspaceError(404, "contact_not_found");

  const [customFields, notes, tasks, pipelines] = await Promise.all([
    listCustomFields().catch(() => []),
    listContactNotes(contactId).catch(() => []),
    listContactTasks(contactId).catch(() => []),
    listPipelines().catch(() => []),
  ]);

  // Oportunidades do contato: a busca por contato evita puxar a base toda.
  let opportunities = [];
  try {
    const data = await ghlFetch("/opportunities/search", {
      query: { location_id: contact.locationId, contact_id: contactId, limit: 50 },
    });
    opportunities = (data?.opportunities || []).map((o) => opportunityToRecord(o, pipelines));
  } catch {
    opportunities = [];
  }

  return {
    contact,
    record: contactToRecord(contact, customFields),
    customFields,
    notes,
    tasks,
    opportunities,
  };
}

/* ------------------------------------------------------------------ */
/* Montagem dos blocos                                                */
/* ------------------------------------------------------------------ */

const text = (s) => ({ rich: [{ s: String(s) }] });

/**
 * A ficha já nasce dividida: identificação, dados, oportunidades, notas,
 * tarefas e um espaço livre para escrever. É o "já vem separado".
 */
function buildBlocks(snapshot) {
  const { record, notes, tasks, opportunities } = snapshot;
  const p = record.properties || {};
  const blocks = [];

  const contato = [p.email, p.phone].filter(Boolean).join(" · ");
  blocks.push({
    type: "callout",
    content: {
      emoji: "👤",
      tone: "info",
      rich: [{ s: contato || "Sem e-mail ou telefone cadastrado" }],
    },
  });

  blocks.push({ type: "heading2", content: text("Dados do contato") });
  const dados = [
    ["E-mail", p.email], ["Telefone", p.phone], ["Empresa", p.company],
    ["Origem", p.source],
    ["Local", [p.city, p.state, p.country].filter(Boolean).join(", ")],
    ["Tags", (p.tags || []).join(", ")],
    ["Criado em", p.created_at],
  ].filter(([, v]) => v);
  if (dados.length) {
    for (const [k, v] of dados) {
      blocks.push({ type: "bulleted_list", content: { rich: [{ s: `${k}: `, m: ["b"] }, { s: String(v) }] } });
    }
  } else {
    blocks.push({ type: "paragraph", content: text("Sem dados preenchidos no CRM.") });
  }

  const custom = Object.entries(p)
    .filter(([k, v]) => k.startsWith("cf_") && v !== "" && v !== null &&
      !(Array.isArray(v) && !v.length))
    .slice(0, 25);
  if (custom.length) {
    blocks.push({ type: "heading3", content: text("Campos personalizados") });
    const byKey = Object.fromEntries(
      (snapshot.customFields || []).map((f) => [`cf_${f.id}`, f.name]));
    for (const [k, v] of custom) {
      blocks.push({
        type: "bulleted_list",
        content: { rich: [
          { s: `${byKey[k] || k}: `, m: ["b"] },
          { s: Array.isArray(v) ? v.join(", ") : String(v) },
        ] },
      });
    }
  }

  blocks.push({ type: "heading2", content: text("Oportunidades") });
  if (opportunities.length) {
    for (const o of opportunities) {
      const partes = [o.properties.pipeline, o.properties.stage, o.properties.status]
        .filter(Boolean).join(" · ");
      blocks.push({
        type: "bulleted_list",
        content: { rich: [{ s: `${o.title} `, m: ["b"] }, { s: partes ? `— ${partes}` : "" }] },
      });
    }
  } else {
    blocks.push({ type: "paragraph", content: text("Nenhuma oportunidade neste contato.") });
  }

  blocks.push({ type: "heading2", content: text("Notas do CRM") });
  if (notes.length) {
    for (const n of notes.slice(0, 30)) {
      blocks.push({ type: "quote", content: text(n.body || n.note || "—") });
    }
  } else {
    blocks.push({ type: "paragraph", content: text("Nenhuma nota registrada no CRM.") });
  }

  blocks.push({ type: "heading2", content: text("Tarefas") });
  if (tasks.length) {
    for (const t of tasks.slice(0, 30)) {
      blocks.push({
        type: "checklist",
        content: { checked: !!t.completed, rich: [{ s: t.title || t.body || "—" }] },
      });
    }
  } else {
    blocks.push({ type: "paragraph", content: text("Nenhuma tarefa aberta.") });
  }

  blocks.push({ type: "heading2", content: text("Anotações") });
  blocks.push({ type: "paragraph", content: { rich: [] } });

  return blocks;
}

/** Insere os blocos da ficha de uma vez — 30 inserts seriais seriam lentos. */
async function insertBlocks(ctx, pageId, blocks) {
  if (!blocks.length) return;
  const positions = keysBetween(null, null, blocks.length);
  const rows = blocks.map((b, i) => {
    const { content, plainText } = normalizeBlockContent(b.type, b.content);
    return {
      workspace_id: ctx.workspaceId,
      page_id: pageId,
      type: b.type,
      content,
      plain_text: plainText,
      position: positions[i],
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    };
  });
  const { error } = await db().from("workspace_blocks").insert(rows);
  if (error) fail(error, "dossier_blocks_failed");
}
