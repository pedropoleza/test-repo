/**
 * Task types — predefined templates that pre-fill a new task's note so the user
 * just fills in the blanks. Picking one from the New-task menu opens the task
 * with its layout ready in the note.
 *
 * Current type:
 *  - "Proposta de cotação": the full insurance-quote proposal (client data,
 *    term-plan tables, accumulation options, observations).
 *
 * Adding a type is an entry here plus a menu option in Board.tsx.
 */

export const PROPOSAL_TASK_TYPE = "proposta";

/** Human label for a task type (used for the modal heading on create). */
export function taskTypeLabel(taskType?: string | null): string | null {
  if (taskType === PROPOSAL_TASK_TYPE) return "Proposta";
  return null;
}

/**
 * Pre-filled title for a task type, ending in ": " so the user just types the
 * contact's name after it (e.g. "Proposta de cotação: João Silva").
 */
export function seedTitleForType(taskType?: string | null): string {
  if (taskType === PROPOSAL_TASK_TYPE) return "Proposta de cotação: ";
  return "";
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
