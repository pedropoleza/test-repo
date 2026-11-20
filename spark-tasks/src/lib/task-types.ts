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

// Blank version of the cotação note (same structure the automation fills in).
const PROPOSAL_NOTE = `## DADOS DO CLIENTE

Nome completo:
Cliente/Estado:
Data de nascimento:
Fumante:
Indicação:
Estado civil:
Informações do cônjuge:
Uso de medicamentos:

## OBSERVAÇÕES

Data da cotação:
Responsável pela cotação:
Informações complementares:
`;

/** Pre-filled note template for a task type (empty if the type has none). */
export function seedNoteForType(taskType?: string | null): string {
  if (taskType === PROPOSAL_TASK_TYPE) return PROPOSAL_NOTE;
  return "";
}
