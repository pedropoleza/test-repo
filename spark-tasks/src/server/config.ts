/**
 * Per-location behavior toggles.
 *
 * `REQUIRE_OWNER_LOCATION_IDS` — comma-separated GHL location ids where a task
 * MUST have at least one assignee (owner) to be created. Defaults to the one
 * subaccount that requested it; set the env var to add/replace ids without a
 * code change.
 */
const RAW_OWNER_REQUIRED =
  process.env.REQUIRE_OWNER_LOCATION_IDS ?? "ndGxLx498EoZIYMjSHvh";

const OWNER_REQUIRED = new Set(
  RAW_OWNER_REQUIRED.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function locationRequiresOwner(locationId: string): boolean {
  return OWNER_REQUIRED.has(locationId);
}

/**
 * Daily "call list" automations. For each configured location, a scheduled job
 * pulls the leads sitting in a pipeline stage and creates one call task per
 * lead (capped), assigned to a named user, due that day.
 *
 * Names (pipeline / stage / assignee) are matched case-insensitively at run
 * time against the live GHL data, so this survives id changes in GHL. Override
 * via the CALL_LISTS env var (JSON array of the same shape) without a deploy.
 *
 * NOTE: reading the leads in a stage needs the `opportunities.readonly` scope
 * on the GHL app. Until the location reauthorizes with that scope, the job
 * logs a clear error and creates nothing.
 */
export type CallListConfig = {
  /** GHL location this automation runs for. */
  locationId: string;
  /** Opportunity pipeline name (case-insensitive), e.g. "VENDAS". */
  pipelineName: string;
  /** Stage name within the pipeline (case-insensitive), e.g. "LIGAÇÕES LUCIANA". */
  stageName: string;
  /** Assignee to match by name (case-insensitive), e.g. "Luciana". */
  assigneeName: string;
  /** Max tasks to create per run (one per lead, oldest-in-stage first). */
  maxTasks: number;
  /** Optional board label shown on the generated cards. */
  label?: string;
};

const DEFAULT_CALL_LISTS: CallListConfig[] = [
  {
    locationId: "l02PcA5r4TL2umdwpWgn",
    pipelineName: "VENDAS",
    // The client called it "LIGAÇÕES LUCIANA"; the actual GHL stage is
    // "LUCIANA LIGAR" (verified against the live pipeline).
    stageName: "LUCIANA LIGAR",
    assigneeName: "Luciana",
    maxTasks: 30,
    label: "Ligações Luciana",
  },
];

function parseCallLists(): CallListConfig[] {
  const raw = process.env.CALL_LISTS;
  if (!raw) return DEFAULT_CALL_LISTS;
  try {
    const parsed = JSON.parse(raw) as CallListConfig[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    console.error("[config] CALL_LISTS is not valid JSON — using defaults");
  }
  return DEFAULT_CALL_LISTS;
}

export const CALL_LISTS: CallListConfig[] = parseCallLists();
