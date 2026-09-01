/**
 * Ficha do contato ("capa"): uma página do workspace ligada a um contato
 * do GHL.
 *
 * IDEMPOTÊNCIA (§47): a página guarda source='ghl_contact' e
 * source_external_id=<id do contato>, com unique index já criado na
 * migration 0001. Abrir a ficha do mesmo contato duas vezes devolve a
 * MESMA página — nunca duplica.
 *
 * A ficha mistura duas naturezas de propósito:
 *
 * - Um bloco `crm_contact` ao vivo, que lê os dados e as oportunidades do
 *   CRM a cada abertura e grava de volta. É o que se trabalha.
 * - Blocos normais com o histórico do momento da criação (notas, tarefas)
 *   e espaço livre para escrever. É conteúdo local: continua legível e
 *   editável mesmo com o CRM fora do ar (D3 e §3).
 *
 * O primeiro nasceu depois: a ficha só com o retrato servia para ler, e
 * obrigava a voltar para a tabela só para mudar um estágio.
 */
import { db } from "./db.js";
import { keysBetween, keyBetween } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { textoDaNota } from "../../src/shared/timeline.js";
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
    }
    // Fichas criadas antes do painel ao vivo continuam abrindo; ganham o
    // painel aqui, sem perder nada do que já foi escrito nelas.
    const added = await ensurePanel(ctx, existing, contactId);
    return {
      page: { ...existing, is_archived: false },
      created: false,
      ...(existing.is_archived ? { restored: true } : {}),
      ...(added ? { panelAdded: true } : {}),
    };
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
      // Sem ícone de propósito: numa ficha de contato o lugar do ícone é
      // o rosto, e o avatar mostra as iniciais até haver foto. Um 👤 em
      // todas as fichas ocupava o espaço sem dizer de quem era qual.
      // Ficha é tabela de dados, não texto corrido: a coluna de leitura
      // de 780px espremia 15 campos numa faixa estreita.
      layout_width: "full",
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
  const { record, notes, tasks } = snapshot;
  const blocks = [];

  // Dados do contato, campos personalizados e oportunidades vêm do painel
  // ao vivo — um retrato deles aqui envelheceria em minutos e ainda daria
  // a impressão de ser editável.
  blocks.push({ type: "crm_contact", content: { contactId: record.externalId } });

  blocks.push({ type: "heading2", content: text("Notas do CRM") });
  if (notes.length) {
    for (const n of notes.slice(0, 30)) {
      // `body` vem do CRM com parágrafos e spans inteiros de estilo. O
      // editor renderiza texto puro, então o HTML apareceria como texto
      // literal na ficha — foi o que acontecia.
      blocks.push({ type: "quote", content: text(textoDaNota(n) || "—") });
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

/**
 * Acrescenta o painel ao vivo no topo de uma ficha que não tem.
 * Devolve true se inseriu.
 */
async function ensurePanel(ctx, page, contactId) {
  const { data: blocks, error } = await db()
    .from("workspace_blocks")
    .select("id,type,position")
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", page.id);
  if (error) return false;
  if ((blocks || []).some((b) => b.type === "crm_contact")) return false;

  const primeiro = (blocks || [])
    .map((b) => b.position)
    .sort((a, b) => (a < b ? -1 : 1))[0] || null;

  const { content, plainText } = normalizeBlockContent("crm_contact", { contactId });
  const { error: insertError } = await db().from("workspace_blocks").insert({
    workspace_id: ctx.workspaceId,
    page_id: page.id,
    type: "crm_contact",
    content,
    plain_text: plainText,
    position: keyBetween(null, primeiro),
    source: SOURCE,
    created_by: ctx.userKey,
    updated_by: ctx.userKey,
  });
  return !insertError;
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
      // Marca de origem: distingue o que a ficha gerou do que a pessoa
      // escreveu depois. É o que permite uma migração futura mexer só no
      // conteúdo gerado.
      source: SOURCE,
      created_by: ctx.userKey,
      updated_by: ctx.userKey,
    };
  });
  const { error } = await db().from("workspace_blocks").insert(rows);
  if (error) fail(error, "dossier_blocks_failed");
}
