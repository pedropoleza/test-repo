/**
 * Logger estruturado em JSON. Cada log = um objeto serializável,
 * facilita query no Vercel Logs / Logflare / Datadog.
 *
 * Uso:
 *   import { log } from "../lib/server/log.js";
 *   log.info("oauth.callback", { locationId, status: "ok" });
 *   log.error("oauth.callback.failure", { error: err.message });
 */

function emit(level, event, fields = {}) {
  const obj = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  // Stringify defensivamente: errors viram { message, code }
  const payload = JSON.stringify(obj, (_, v) => {
    if (v instanceof Error) return { message: v.message, code: v.code, type: v.type };
    return v;
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export const log = {
  debug: (event, fields) => emit("debug", event, fields),
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
};
