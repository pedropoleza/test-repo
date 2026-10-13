/**
 * Criar um funil inteiro numa chamada.
 *
 * Página + tabela + campo de etapas + campos da ficha + vista de quadro
 * + vista de tabela + o bloco que mostra o quadro na página. Oito
 * inserts que, feitos um a um pela tela, deixariam metade de um funil de
 * pé se qualquer um falhasse — e meio funil é pior que nenhum, porque
 * parece pronto.
 *
 * Não reusa `createDatabase` de propósito: ela planta os campos padrão
 * (Status, Responsável, Prazo) e uma vista de tabela, e um funil quer
 * outros campos e o quadro na frente. Limpar depois seria mais código
 * que montar certo.
 */
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { keyBetween } from "../../src/shared/fracdex.js";
import { fieldKeyFrom } from "../../src/shared/fields.js";
import { montarFunil } from "../../src/shared/funil.js";
import { log } from "./log.js";

/** Erro de banco com código próprio, como no resto do módulo de dados. */
function fail(error, code) {
  throw new WorkspaceError(500, code, { detail: error.message });
}

/**
 * `{ nome, etapas, campos }` → `{ page, database, viewId }`.
 *
 * A página nasce em largura total: um funil de dez colunas dentro da
 * coluna de leitura de uma página mostraria três.
 */
export async function criarFunil(ctx, input = {}) {
  const molde = montarFunil({
    nome: input.nome,
    etapas: Array.isArray(input.etapas) ? input.etapas : [],
    ...(Array.isArray(input.campos) && input.campos.length ? { campos: input.campos } : {}),
  });

  const page = await inserir("workspace_pages", {
    workspace_id: ctx.workspaceId,
    title: molde.titulo,
    icon_type: "emoji",
    icon_value: input.icone || "🎯",
    layout_width: "full",
    visibility: "shared",
    position: keyBetween(null, null),
    created_by: ctx.userKey,
    updated_by: ctx.userKey,
  }, "id,title,icon_type,icon_value,position,parent_page_id", "funnel_page_failed");

  const database = await inserir("workspace_databases", {
    workspace_id: ctx.workspaceId,
    page_id: page.id,
    title: molde.titulo,
    icon_type: "emoji",
    icon_value: input.icone || "🎯",
    created_by: ctx.userKey,
    updated_by: ctx.userKey,
  }, "id,title", "funnel_database_failed");

  // Ordem dos campos: o nome (coluna principal), depois as etapas, depois
  // a ficha. É a ordem em que se lê um lead.
  const specs = [
    { name: "Nome completo", type: "text", config: {}, is_primary: true },
    { ...molde.campoDeEtapas, is_primary: false },
    ...molde.campos.map((c) => ({ ...c, is_primary: false })),
  ];

  let position = null;
  const tomadas = [];
  let chaveDasEtapas = null;
  for (const spec of specs) {
    position = keyBetween(position, null);
    const key = fieldKeyFrom(spec.name, tomadas);
    tomadas.push(key);
    if (spec === specs[1]) chaveDasEtapas = key;
    const { error } = await db().from("workspace_database_fields").insert({
      workspace_id: ctx.workspaceId,
      database_id: database.id,
      key,
      name: spec.name,
      type: spec.type,
      config: spec.config || {},
      is_primary: !!spec.is_primary,
      position,
    });
    if (error) fail(error, "funnel_field_failed");
  }

  // O quadro na frente (position 'a'), a tabela ao lado: o funil é para
  // ser visto em colunas; a tabela é para quando ela quiser filtrar.
  const quadro = await inserir("workspace_database_views", {
    workspace_id: ctx.workspaceId,
    database_id: database.id,
    name: "Quadro",
    type: "board",
    group_by: chaveDasEtapas,
    layout: { cardSize: "completo" },
    position: keyBetween(null, null),
  }, "id,name,type", "funnel_view_failed");

  const { error: tErr } = await db().from("workspace_database_views").insert({
    workspace_id: ctx.workspaceId,
    database_id: database.id,
    name: "Tabela",
    type: "table",
    position: keyBetween(quadro ? "a" : null, null),
  });
  if (tErr) fail(tErr, "funnel_view_failed");

  const { error: bErr } = await db().from("workspace_blocks").insert({
    workspace_id: ctx.workspaceId,
    page_id: page.id,
    type: "database",
    content: { databaseId: database.id, viewId: quadro.id },
    plain_text: "",
    position: keyBetween(null, null),
    created_by: ctx.userKey,
    updated_by: ctx.userKey,
  });
  if (bErr) fail(bErr, "funnel_block_failed");

  log.info("funnel.created", {
    workspaceId: ctx.workspaceId,
    etapas: molde.campoDeEtapas.config.options.length,
  });

  return { page, database, viewId: quadro.id, databaseId: database.id };
}

async function inserir(tabela, linha, select, codigoDeErro) {
  const { data, error } = await db().from(tabela).insert(linha).select(select).maybeSingle();
  if (error) fail(error, codigoDeErro);
  if (!data) throw new WorkspaceError(500, codigoDeErro);
  return data;
}
