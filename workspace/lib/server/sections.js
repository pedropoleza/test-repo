/**
 * Seções da sidebar: agrupamento definido pelo usuário para as páginas de
 * raiz. Organização, não permissão — `visibility` continua sendo quem
 * decide acesso.
 */
import { db } from "./db.js";
import { keyBetween, byPosition } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";

const SECTION_FIELDS =
  "id,workspace_id,name,icon_type,icon_value,position,is_default,created_at,updated_at";

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

/**
 * Lista as seções, semeando as duas padrão na primeira vez.
 *
 * A semeadura é preguiçosa em vez de acontecer na criação do workspace:
 * assim workspaces criados antes desta migration também ganham as seções
 * sem precisar de backfill.
 */
export async function listSections(ctx) {
  const { data, error } = await db()
    .from("workspace_sections")
    .select(SECTION_FIELDS)
    .eq("workspace_id", ctx.workspaceId);
  if (error) fail(error);

  const rows = (data || []).sort(byPosition);
  if (rows.length) return rows;

  const seed = [
    { name: "Privado", position: keyBetween(null, null), is_default: true },
    { name: "Compartilhado", position: keyBetween(keyBetween(null, null), null), is_default: false },
  ];
  const { data: created, error: insErr } = await db()
    .from("workspace_sections")
    .insert(seed.map((s) => ({ ...s, workspace_id: ctx.workspaceId, created_by: ctx.userKey })))
    .select(SECTION_FIELDS);
  if (insErr) {
    // Corrida entre duas abas: relê em vez de estourar.
    const again = await db()
      .from("workspace_sections")
      .select(SECTION_FIELDS)
      .eq("workspace_id", ctx.workspaceId);
    return (again.data || []).sort(byPosition);
  }
  return (created || []).sort(byPosition);
}

export async function getDefaultSection(ctx) {
  const sections = await listSections(ctx);
  return sections.find((s) => s.is_default) || sections[0] || null;
}

export async function createSection(ctx, input = {}) {
  const sections = await listSections(ctx);
  const last = sections[sections.length - 1];

  const { data, error } = await db()
    .from("workspace_sections")
    .insert({
      workspace_id: ctx.workspaceId,
      name: String(input.name || "Nova seção").slice(0, 120),
      icon_type: input.iconType === "emoji" || input.iconType === "url" ? input.iconType : null,
      icon_value: input.iconValue ? String(input.iconValue).slice(0, 2048) : null,
      position: keyBetween(last ? last.position : null, null),
      created_by: ctx.userKey,
    })
    .select(SECTION_FIELDS)
    .maybeSingle();
  if (error) fail(error, "section_create_failed");
  return data;
}

export async function updateSection(ctx, sectionId, patch = {}) {
  await getSection(ctx, sectionId);
  const row = {};
  if (typeof patch.name === "string") row.name = patch.name.slice(0, 120);
  if (patch.iconType === null || patch.iconType === "emoji" || patch.iconType === "url") {
    row.icon_type = patch.iconType;
    row.icon_value = patch.iconType ? String(patch.iconValue || "").slice(0, 2048) : null;
  }
  if (!Object.keys(row).length) return getSection(ctx, sectionId);

  const { data, error } = await db()
    .from("workspace_sections")
    .update(row)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", sectionId)
    .select(SECTION_FIELDS)
    .maybeSingle();
  if (error) fail(error, "section_update_failed");
  return data;
}

export async function moveSection(ctx, sectionId, { afterId, beforeId }) {
  await getSection(ctx, sectionId);
  const siblings = (await listSections(ctx)).filter((s) => s.id !== sectionId);

  let position;
  if (!siblings.length) position = keyBetween(null, null);
  else if (afterId) {
    const i = siblings.findIndex((s) => s.id === afterId);
    position = i >= 0
      ? keyBetween(siblings[i].position, siblings[i + 1]?.position || null)
      : keyBetween(siblings[siblings.length - 1].position, null);
  } else if (beforeId) {
    const i = siblings.findIndex((s) => s.id === beforeId);
    position = i >= 0
      ? keyBetween(siblings[i - 1]?.position || null, siblings[i].position)
      : keyBetween(null, siblings[0].position);
  } else position = keyBetween(siblings[siblings.length - 1].position, null);

  const { data, error } = await db()
    .from("workspace_sections")
    .update({ position })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", sectionId)
    .select(SECTION_FIELDS)
    .maybeSingle();
  if (error) fail(error, "section_move_failed");
  return data;
}

/**
 * Excluir seção NUNCA exclui página: as páginas vão para a seção padrão.
 * A própria seção padrão não pode ser excluída — sem ela existiria página
 * sem lugar na navegação.
 */
export async function deleteSection(ctx, sectionId) {
  const section = await getSection(ctx, sectionId);
  if (section.is_default) throw new WorkspaceError(400, "cannot_delete_default_section");

  const fallback = await getDefaultSection(ctx);
  const { error: moveErr } = await db()
    .from("workspace_pages")
    .update({ section_id: fallback?.id || null })
    .eq("workspace_id", ctx.workspaceId)
    .eq("section_id", sectionId);
  if (moveErr) fail(moveErr, "section_delete_failed");

  const { error } = await db()
    .from("workspace_sections")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", sectionId);
  if (error) fail(error, "section_delete_failed");
  return { id: sectionId, movedTo: fallback?.id || null };
}

async function getSection(ctx, sectionId) {
  const { data, error } = await db()
    .from("workspace_sections")
    .select(SECTION_FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", sectionId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new WorkspaceError(404, "section_not_found");
  return data;
}

export { getSection };
