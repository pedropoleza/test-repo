/**
 * Sincronização de status (§12): o status da mensagem enviada pelo segundo
 * WhatsApp (Ghost) é refletido no provider da MAIN.
 *
 * IMPORTANTE: a API de status do provider exige o token do próprio Marketplace
 * App (o provider pertence ao app), não o token da location — por isso usamos
 * providerAppToken().
 */
import { getInstallationByGhost, providerAppToken } from "./provider.js";
import { updateProviderMessageStatus } from "./ghl-conversations.js";
import { updateBridge } from "./bridge.js";
import { db } from "../server/db.js";
import { recordLog } from "./logs.js";
import { normalizeStatus } from "./payload.js";
import { log } from "../server/log.js";

export async function processStatusEvent(evt) {
  const status = normalizeStatus(evt.status);
  if (!status) return { status: "ignored", reason: "unmapped_status", raw: evt.status };
  if (!evt.ghostMessageId) return { status: "error", reason: "missing_ghost_message_id" };

  // Acha o bridge row que originamos no outbound (ghost_message_id).
  const { data: bridge, error } = await db()
    .from("message_bridge")
    .select("id, tenant_id, provider_id, main_message_id, status")
    .eq("ghost_message_id", evt.ghostMessageId)
    .maybeSingle();
  if (error) throw error;
  if (!bridge) return { status: "ignored", reason: "bridge_not_found" };

  await updateBridge(bridge.id, {
    status,
    error: status === "failed" ? evt.error || "delivery_failed" : null,
  });

  // Reflete no provider da Main (só se temos o main_message_id).
  let reflected = false;
  if (bridge.main_message_id) {
    try {
      const appTok = await providerAppToken();
      await updateProviderMessageStatus(appTok, bridge.main_message_id, status, {
        error: status === "failed" ? evt.error : undefined,
      });
      reflected = true;
    } catch (err) {
      log.warn("wa.status.reflect_failed", { error: err.message, ghostMessageId: evt.ghostMessageId });
    }
  }

  await recordLog({
    tenantId: bridge.tenant_id,
    providerId: bridge.provider_id,
    direction: "OUTBOUND",
    message: `status → ${status}`,
    source: "WhatsApp",
    destination: "Main",
    status,
    error: status === "failed" ? evt.error : null,
    bridgeId: bridge.id,
  });

  return { status: "ok", bridgeId: bridge.id, mapped: status, reflected };
}

// Reexport pra descoberta a partir da rota (mantém a resolução de installation
// disponível caso precise validar o tenant do evento).
export { getInstallationByGhost };
