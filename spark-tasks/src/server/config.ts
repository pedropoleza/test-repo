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
