/**
 * Geração de um acordo preenchido para um contato.
 *
 * Junta as três peças: o catálogo diz quais acordos o serviço tem, o
 * mapa diz onde cada valor entra no PDF, e o motor estampa. O dado vem
 * do CRM, ao vivo — o documento nunca guarda uma cópia velha do cliente.
 */
import { getContact, listCustomFields } from "./ghl.js";
import { WorkspaceError } from "./context.js";
import { customFieldsToColumns, contactToRecord, STANDARD_CONTACT_FIELDS } from "../../src/shared/crm.js";
import { ACORDOS, arquivoDoAcordo } from "../../src/shared/catalog.js";
import { MAPAS, montarValores } from "./acordo-maps.js";
import { preencherAcordo } from "./document-fill.js";

const semAcento = (s) => String(s || "").normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");

export async function gerarDocumento(ctx, { contactId, acordo, idioma = "en" } = {}) {
  if (!contactId) throw new WorkspaceError(400, "missing_contactId");
  const def = ACORDOS[acordo];
  if (!def) throw new WorkspaceError(400, "acordo_desconhecido");

  const slug = arquivoDoAcordo(def, idioma);
  const mapa = MAPAS[slug];
  // Um acordo sem mapa de campos ainda não foi preparado para
  // preenchimento — melhor dizer isso do que devolver um PDF em branco.
  if (!mapa) throw new WorkspaceError(422, "acordo_sem_preenchimento", { acordo, slug });

  const contact = await getContact(contactId);
  if (!contact) throw new WorkspaceError(404, "contact_not_found");

  const customFields = await listCustomFields().catch(() => []);
  const record = contactToRecord(contact, customFields);
  const columns = [...STANDARD_CONTACT_FIELDS, ...customFieldsToColumns(customFields)];

  const valores = montarValores(slug, { contact, record, columns });
  const bytes = await preencherAcordo({ slug, valores, mapa: mapa.mapa });

  const nome = semAcento(record.title || "cliente");
  return {
    bytes,
    filename: `${semAcento(def.nome)}_${nome}.pdf`,
    preenchidos: Object.keys(valores).length,
  };
}
