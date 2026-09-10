/**
 * Pedidos de assinatura de documento.
 *
 * O ciclo inteiro de um documento que sai daqui e volta assinado:
 *
 *   criar    → um link único, com os dados do CRM já preenchidos
 *   abrir    → o cliente abriu (marca a hora, vira "aberto")
 *   assinar  → confere/corrige, assina, aprova: o PDF real é carimbado,
 *              o certificado é anexado, o arquivo cai na ficha
 *
 * O idioma sai do contato: decide a língua da página e, quando o acordo
 * tem variante oficial (o divórcio tem pt/en/es), qual PDF vai. Contrato
 * sem variante continua no original em inglês — o que muda de língua é a
 * interface, nunca o texto jurídico.
 */
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { getContact, listCustomFields } from "./ghl.js";
import {
  contactToRecord, customFieldsToColumns, STANDARD_CONTACT_FIELDS,
} from "../../src/shared/crm.js";
import { ACORDOS, arquivoDoAcordo } from "../../src/shared/catalog.js";
import { MAPAS, montarValores } from "./acordo-maps.js";
import { idiomaDoContato, idiomaDoAcordo } from "../../src/shared/idioma.js";
import { validar } from "../../src/shared/doc-forms.js";
import { preencherAcordo } from "./document-fill.js";
import { anexarCertificado } from "./document-sign.js";
import { salvarDocumentoDoContato } from "./contact-documents.js";

const CAMPOS = "id,workspace_id,contact_external_id,acordo,slug,idioma,token,status,"
  + "prefill,valores,assinado_por,assinatura_tipo,assinado_em,file_id,created_at,opened_at";

const novoToken = () => randomBytes(32).toString("base64url");

const semAcento = (s) => String(s || "").normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
  .replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * Cria o pedido: resolve o contato no CRM, descobre o idioma dele, escolhe
 * a variante do documento e guarda o pré-preenchimento do momento do envio.
 */
export async function criarPedido(ctx, { contactId, acordo, idioma } = {}) {
  if (!contactId) throw new WorkspaceError(400, "missing_contactId");
  const def = ACORDOS[acordo];
  if (!def) throw new WorkspaceError(400, "acordo_desconhecido", { acordo });

  const contact = await getContact(contactId);
  if (!contact) throw new WorkspaceError(404, "contact_not_found");

  const customFields = await listCustomFields().catch(() => []);
  const record = contactToRecord(contact, customFields);
  const columns = [...STANDARD_CONTACT_FIELDS, ...customFieldsToColumns(customFields)];

  // O idioma do contato manda; um idioma explícito só sobrepõe quando a
  // equipe escolhe na mão.
  const idiomaCliente = idioma || idiomaDoContato({ contact, record, columns });
  const slug = arquivoDoAcordo(def, idiomaDoAcordo(def, idiomaCliente));
  if (!MAPAS[slug]) throw new WorkspaceError(422, "acordo_sem_preenchimento", { acordo, slug });

  const prefill = montarValores(slug, { contact, record, columns });

  const { data, error } = await db()
    .from("workspace_doc_requests")
    .insert({
      workspace_id: ctx.workspaceId,
      contact_external_id: String(contactId).slice(0, 120),
      acordo, slug, idioma: idiomaCliente,
      token: novoToken(),
      prefill,
      criado_por: ctx.userKey,
    })
    .select(CAMPOS)
    .maybeSingle();
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return data;
}

/** Resolve o pedido de quem chega pelo link. O token é a credencial. */
export async function resolverPedido(token) {
  if (!token || typeof token !== "string" || token.length < 20) return null;
  const { data } = await db()
    .from("workspace_doc_requests")
    .select(CAMPOS)
    .eq("token", token)
    .maybeSingle();
  return data || null;
}

/** Marca que o cliente abriu — só a primeira vez muda o status. */
export async function registrarAbertura(pedido) {
  if (!pedido || pedido.status !== "pendente") return pedido;
  await db()
    .from("workspace_doc_requests")
    .update({ status: "aberto", opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", pedido.id);
  return { ...pedido, status: "aberto" };
}

/**
 * Assina: valida o obrigatório, carimba o PDF real, anexa o certificado,
 * guarda o arquivo na ficha do contato e fecha o pedido.
 *
 * Devolve `{ pedido, arquivo }`. Um pedido já assinado ou cancelado não
 * assina de novo — o link é de uma vez só.
 */
export async function assinarPedido(token, {
  valores = {}, assinadoPor = "", tipo = "digitada", imagem = "", ip = "",
} = {}) {
  const pedido = await resolverPedido(token);
  if (!pedido) throw new WorkspaceError(404, "pedido_nao_encontrado");
  if (pedido.status === "assinado") throw new WorkspaceError(409, "ja_assinado");
  if (pedido.status === "cancelado") throw new WorkspaceError(409, "cancelado");

  const nome = String(assinadoPor || "").trim();
  if (!nome) throw new WorkspaceError(400, "assinatura_sem_nome");

  // O que vale é o que o cliente confirmou; o prefill preenche o que ele
  // não mexeu.
  const finais = { ...(pedido.prefill || {}), ...valores };
  const faltando = validar(pedido.slug, finais, pedido.idioma);
  if (faltando.length) {
    throw new WorkspaceError(400, "campos_obrigatorios", { campos: faltando.map((c) => c.campo) });
  }

  const def = ACORDOS[pedido.acordo];
  const mapa = MAPAS[pedido.slug];
  const base = await preencherAcordo({ slug: pedido.slug, valores: finais, mapa: mapa.mapa });
  const assinadoEm = new Date();
  const bytes = await anexarCertificado(base, {
    documento: def?.nome || pedido.acordo,
    assinadoPor: nome,
    tipo: tipo === "desenhada" ? "desenhada" : "digitada",
    imagem,
    assinadoEm, ip,
    referencia: pedido.id,
    idioma: pedido.idioma,
  });

  const arquivo = await salvarDocumentoDoContato(
    { workspaceId: pedido.workspace_id, userKey: "portal" },
    {
      contactId: pedido.contact_external_id,
      bytes: Buffer.from(bytes),
      nome: `${semAcento(def?.nome || pedido.acordo)}_${semAcento(nome)}_assinado.pdf`,
      categoria: "contrato",
    },
  );

  const { data, error } = await db()
    .from("workspace_doc_requests")
    .update({
      status: "assinado",
      valores: finais,
      assinado_por: nome,
      assinatura_tipo: tipo === "desenhada" ? "desenhada" : "digitada",
      assinado_em: assinadoEm.toISOString(),
      assinado_ip: String(ip || "").slice(0, 64),
      file_id: arquivo?.id || null,
      updated_at: assinadoEm.toISOString(),
    })
    .eq("id", pedido.id)
    .select(CAMPOS)
    .maybeSingle();
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });

  return { pedido: data, arquivo };
}

/** Os pedidos de um contato, do mais novo para o mais antigo. */
export async function listarPedidos(ctx, contactId) {
  if (!contactId) return [];
  const { data, error } = await db()
    .from("workspace_doc_requests")
    .select(CAMPOS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_external_id", String(contactId))
    .order("created_at", { ascending: false });
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return data || [];
}

/** Todos os pedidos da conta — alimenta o painel de Documentos. */
export async function listarTodos(ctx, { limite = 200 } = {}) {
  const { data, error } = await db()
    .from("workspace_doc_requests")
    .select(CAMPOS)
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return data || [];
}

/** Cancela um pedido: o link para de funcionar na hora. */
export async function cancelarPedido(ctx, id) {
  if (!id) throw new WorkspaceError(400, "missing_id");
  const { error } = await db()
    .from("workspace_doc_requests")
    .update({ status: "cancelado", updated_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", String(id))
    .in("status", ["pendente", "aberto"]);
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return { ok: true };
}
