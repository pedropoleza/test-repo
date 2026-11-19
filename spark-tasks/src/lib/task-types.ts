/**
 * Task types — predefined "templates" that seed a new task so the user just
 * fills in the blanks. Picking one from the New-task menu opens the task with
 * its layout ready.
 *
 * There are two shapes a type can seed (a type can use either or both):
 *  - Structured fields: a fixed set of labeled, typed inputs (see CustomField).
 *    Best for short intake forms. → "Cotação".
 *  - A note template: a pre-filled multi-section document in the task note.
 *    Best for long documents with tables/many rows. → "Proposta de cotação".
 *
 * Adding a type is an entry here plus a menu option in Board.tsx — the modal
 * renders whatever a task carries.
 */
import type { CustomField, CustomFieldType } from "~/server/db/schema";

/** Short intake form: the data we need to run a quote. */
export const QUOTE_TASK_TYPE = "cotacao";
/** The full insurance-quote proposal document (tables + accumulation options). */
export const PROPOSAL_TASK_TYPE = "proposta";

export type FieldDef = { id: string; label: string; type: CustomFieldType };

/** The fields a "Cotação" task is seeded with, in display order. */
export const QUOTE_FIELD_DEFS: FieldDef[] = [
  { id: "nome", label: "Nome", type: "text" },
  { id: "sobrenome", label: "Sobrenome", type: "text" },
  { id: "nascimento", label: "Data de nascimento", type: "date" },
  { id: "estado", label: "Estado", type: "text" },
  { id: "fumante", label: "É fumante?", type: "boolean" },
  { id: "remedio", label: "Toma algum remédio prescrito?", type: "boolean" },
  { id: "casado", label: "É casado(a)?", type: "boolean" },
];

/** Build the empty structured field set for a task type (empty if none). */
export function seedFieldsForType(taskType?: string | null): CustomField[] {
  if (taskType === QUOTE_TASK_TYPE) {
    return QUOTE_FIELD_DEFS.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      value: "",
    }));
  }
  return [];
}

/** Human label for a task type (for the modal heading and the card badge). */
export function taskTypeLabel(taskType?: string | null): string | null {
  if (taskType === QUOTE_TASK_TYPE) return "Cotação";
  if (taskType === PROPOSAL_TASK_TYPE) return "Proposta";
  return null;
}

// ---------------------------------------------------------------------------
// Note templates
// ---------------------------------------------------------------------------

/** Accumulation plan: 19 options from US$100 to US$1000/mo in US$50 steps. */
function accumulationBlock(): string {
  const lines: string[] = ["## SEGURO COM ACUMULAÇÃO", ""];
  for (let i = 0; i < 19; i++) {
    const monthly = 100 + i * 50;
    const n = String(i + 1).padStart(2, "0");
    lines.push(
      `### Opção ${n} — US$ ${monthly}/mês`,
      "Valor do seguro:",
      "Acumulação aos 66 anos:",
      "Renda vitalícia:",
      "",
    );
  }
  return lines.join("\n");
}

const PROPOSAL_NOTE = `MODELO DE COTAÇÃO DE SEGURO

## DADOS DO CLIENTE
Cliente/Estado:
Nome completo:
Data de nascimento:
Fumante:
Indicação:
Estado civil:
Situação do cônjuge:
Uso de medicamentos:
Observações:

## PLANO TERMO — 20 ANOS
US$ 1.000.000 — Mensalidade:
US$ 900.000 — Mensalidade:
US$ 800.000 — Mensalidade:
US$ 700.000 — Mensalidade:
US$ 600.000 — Mensalidade:

## PLANO TERMO — 30 ANOS
US$ 1.000.000 — Mensalidade:
US$ 900.000 — Mensalidade:
US$ 800.000 — Mensalidade:
US$ 700.000 — Mensalidade:
US$ 600.000 — Mensalidade:
US$ 500.000 — Mensalidade:
US$ 400.000 — Mensalidade:

${accumulationBlock()}
## OBSERVAÇÕES ADICIONAIS
Informações complementares:
Data da cotação:
Responsável pela cotação:
`;

/** Pre-filled note template for a task type (empty if the type has none). */
export function seedNoteForType(taskType?: string | null): string {
  if (taskType === PROPOSAL_TASK_TYPE) return PROPOSAL_NOTE;
  return "";
}
