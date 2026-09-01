/**
 * Tarefas do Spark Tasks no formato de tabela.
 *
 * Compartilhado entre browser e servidor, como os outros shared/: as
 * colunas são as mesmas dos dois lados, então filtro e ordenação da
 * interface batem com o que foi gravado.
 */

export const TASK_STATUS = [
  { id: "open", name: "Aberta", color: "blue" },
  { id: "done", name: "Concluída", color: "green" },
];

export const TASK_FIELDS = [
  { key: "title",     name: "Tarefa",      type: "text", primary: true },
  { key: "status",    name: "Status",      type: "select", options: TASK_STATUS },
  { key: "due_date",  name: "Vence em",    type: "date" },
  { key: "assignee",  name: "Responsável", type: "text" },
  { key: "url",       name: "Abrir",       type: "url" },
  { key: "updated_at", name: "Atualizada", type: "date" },
];

export function taskToRecord(row) {
  return {
    externalId: row.source_external_id,
    // Fora de properties: é o elo para abrir a pasta do contato, não uma
    // coluna da tabela.
    contactId: row.contact_id || null,
    title: row.title || "Sem título",
    properties: {
      status: row.status || "open",
      due_date: row.due_date || null,
      assignee: row.assignee || "",
      url: row.url || "",
      updated_at: row.source_updated_at ? String(row.source_updated_at).slice(0, 10) : null,
    },
  };
}
