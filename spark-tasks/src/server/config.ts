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
 * `QUOTE_TASK_LOCATION_IDS` — comma-separated location ids that get the
 * "Cotação" task type in the New-task menu. The quote fields (smoker, prescribed
 * meds, etc.) are specific to accounts that do insurance quoting, so this is
 * gated per subaccount. When the env is UNSET/empty the type is hidden
 * everywhere (opt-in); list a location to turn it on there.
 */
const QUOTE_TASK_LOCATIONS = new Set(
  (process.env.QUOTE_TASK_LOCATION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function locationHasQuoteTask(locationId: string): boolean {
  return QUOTE_TASK_LOCATIONS.has(locationId);
}
