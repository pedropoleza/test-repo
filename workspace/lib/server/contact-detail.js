/**
 * Tudo o que descreve um contato, numa carga só.
 *
 * Serve à ficha na tela e ao PDF: os dois mostram o mesmo contato, e
 * montar cada um com sua própria consulta faria o papel divergir da tela
 * com o tempo — que é exatamente o que ninguém percebe até imprimir.
 */
import {
  getContact, listCustomFields, listTags, listUsers, listPipelines,
  listContactNotes, listContactTasks, listContactOpportunities,
} from "./ghl.js";
import { WorkspaceError } from "./context.js";
import { listRelations } from "./relations.js";
import {
  STANDARD_CONTACT_FIELDS, OPPORTUNITY_FIELDS, OPPORTUNITY_STATUS,
  customFieldsToColumns, tagsToOptions, usersToOptions, stageOptions,
  contactToRecord, opportunityToRecord,
} from "../../src/shared/crm.js";

export async function loadContactDetail(contactId, ctx = null) {
  if (!contactId) throw new WorkspaceError(400, "missing_id");

  const [contact, customFields, tags, notes, tasks, pipelines, users] = await Promise.all([
    getContact(contactId),
    listCustomFields().catch(() => []),
    listTags().catch(() => []),
    listContactNotes(contactId).catch(() => []),
    listContactTasks(contactId).catch(() => []),
    listPipelines().catch(() => []),
    listUsers().catch(() => []),
  ]);
  if (!contact) throw new WorkspaceError(404, "contact_not_found");

  const opps = await listContactOpportunities(contactId).catch(() => []);

  // "Responsável" também no contato: o CRM guarda o id do usuário, e sem
  // as opções para traduzir a coluna mostraria a cadeia crua.
  const donos = usersToOptions(users, [contact.assignedTo, ...opps.map((o) => o.assignedTo)]);

  const columns = [
    ...STANDARD_CONTACT_FIELDS,
    { key: "assigned", name: "Responsável", type: "select", options: donos },
    ...customFieldsToColumns(customFields),
  ].map((c) => (c.key === "tags" ? { ...c, options: tagsToOptions(tags) } : c));

  const record = contactToRecord(contact, customFields);
  record.properties.assigned = contact.assignedTo || "";

  const opportunityColumns = OPPORTUNITY_FIELDS.map((c) => {
    if (c.key === "status") return { ...c, options: OPPORTUNITY_STATUS };
    if (c.key === "assigned") return { ...c, options: donos };
    if (c.key === "stage") return { ...c, options: stageOptions(pipelines) };
    if (c.key === "pipeline") {
      return { ...c, options: pipelines.map((p) => ({ id: p.name, name: p.name, color: "gray" })) };
    }
    return c;
  });

  // Vínculos com nome e foto de quem está do outro lado: uma lista de
  // ids não diria nada a quem abre a ficha.
  let relations = [];
  if (ctx) {
    const brutos = await listRelations(ctx, contactId).catch(() => []);
    relations = await Promise.all(brutos.map(async (r) => {
      const outro = await getContact(r.related_contact_id).catch(() => null);
      return {
        contactId: r.related_contact_id,
        relation: r.relation,
        // Contato apagado no CRM: o vínculo continua, com o que sobrou.
        title: outro ? contactToRecord(outro, customFields).title : "Contato removido",
        email: outro?.email || "",
        phone: outro?.phone || "",
        existe: !!outro,
      };
    }));
  }

  return {
    contactId,
    relations,
    columns,
    record,
    notes,
    tasks,
    opportunityColumns,
    opportunities: opps.map((o) => ({
      ...opportunityToRecord(o, pipelines),
      pipelineId: o.pipelineId,
      stageId: o.pipelineStageId,
    })),
    pipelines: pipelines.map((p) => ({
      id: p.id, name: p.name,
      stages: (p.stages || []).map((st) => ({ id: st.id, name: st.name })),
    })),
  };
}
