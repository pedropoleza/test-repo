/**
 * Centralized audit logger.
 *
 * Records into audit_log table for query/playback by /admin's Atividade tab.
 * Never throws — never blocks the caller.
 */
import { db } from "./db.js";
import { log } from "./log.js";

export async function audit({
  eventType,
  actor = "system",
  resourceType = null,
  resourceId = null,
  summary = null,
  data = null,
}) {
  if (!eventType) return;
  try {
    await db().from("audit_log").insert({
      event_type: eventType,
      actor,
      resource_type: resourceType,
      resource_id: resourceId,
      summary,
      data,
    });
  } catch (err) {
    log.warn("audit.write_failed", { eventType, error: err.message });
  }
}
