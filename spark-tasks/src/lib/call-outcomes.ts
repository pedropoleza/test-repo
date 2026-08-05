/**
 * Call-list dispositions. Shared by the client (outcome picker) and the server
 * (disposeCall mutation) so both agree on the set and on which outcomes should,
 * by default, spawn a follow-up call for the next day.
 */
/** Visual tone for the outcome chip (subtle color coding). */
export type CallTone = "positive" | "retry" | "neutral" | "negative";

export type CallOutcome = {
  id: string;
  /** Human label (pt-BR — the client that requested this feature). */
  label: string;
  /** When true, the disposition modal pre-checks "generate a follow-up call". */
  retryByDefault: boolean;
  tone: CallTone;
};

export const CALL_OUTCOMES: CallOutcome[] = [
  { id: "answered", label: "Atendeu", retryByDefault: false, tone: "positive" },
  { id: "no_answer", label: "Não atendeu", retryByDefault: true, tone: "retry" },
  { id: "busy", label: "Ocupado", retryByDefault: true, tone: "retry" },
  { id: "voicemail", label: "Caixa postal", retryByDefault: true, tone: "retry" },
  { id: "callback", label: "Pediu para ligar depois", retryByDefault: true, tone: "retry" },
  { id: "wrong_number", label: "Número errado", retryByDefault: false, tone: "negative" },
  { id: "not_interested", label: "Sem interesse", retryByDefault: false, tone: "negative" },
  { id: "closed", label: "Fechou negócio", retryByDefault: false, tone: "positive" },
];

export const CALL_OUTCOME_IDS = CALL_OUTCOMES.map((o) => o.id) as [
  string,
  ...string[],
];

export function callOutcomeLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return CALL_OUTCOMES.find((o) => o.id === id)?.label ?? id;
}

/** A task is a generated call task when its marker externalId begins "call:". */
export function isCallTask(externalId: string | null | undefined): boolean {
  return !!externalId && externalId.startsWith("call:");
}
