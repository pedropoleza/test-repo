/**
 * Fluxo INBOUND (§3–§5): CLIENTE → WhatsApp #2 → Ghost → webhook → aqui → Main.
 *
 *   1. dedupe/loop guard (source_message_id UNIQUE + ghost_message_id conhecido)
 *   2. resolve o MESMO cliente na Main (mapping por telefone, senão cria)
 *   3. injeta a mensagem no Conversations da Main via nosso provider
 *   4. persiste bridge + mapping + log
 *
 * A mensagem aparece no Conversations da Main associada ao provider
 * "Spark WhatsApp / WhatsApp 2" — NUNCA como WhatsApp principal.
 */
import { normalizePhone } from "./phone.js";
import { getInstallationByGhost, mainToken } from "./provider.js";
import { resolveContact, injectInboundToMain } from "./ghl-conversations.js";
import {
  claimSourceMessage,
  isBridgeOriginatedGhostMessage,
  updateBridge,
  findMappingByPhone,
  upsertMapping,
} from "./bridge.js";
import { recordLog } from "./logs.js";
import { log } from "../server/log.js";

export async function processGhostInbound(evt) {
  const {
    ghostLocationId,
    ghostContactId,
    ghostConversationId,
    ghostMessageId,
    phone: rawPhone,
    contactName,
    message,
    attachments,
    direction,
  } = evt;

  // Só reinjetamos mensagens do CLIENTE (inbound). Um evento outbound da Ghost
  // é, na melhor das hipóteses, eco do que nós mesmos enviamos.
  if (direction && String(direction).toLowerCase() !== "inbound") {
    return { status: "ignored", reason: "not_inbound_direction" };
  }
  if (!ghostMessageId) return { status: "error", reason: "missing_ghost_message_id" };

  // Loop guard (§10): mensagem originada pelo próprio bridge não volta pra Main.
  if (await isBridgeOriginatedGhostMessage(ghostMessageId)) {
    return { status: "ignored", reason: "bridge_originated_loop_guard" };
  }

  const inst = await getInstallationByGhost(ghostLocationId);
  if (!inst) return { status: "error", reason: "installation_not_found", ghostLocationId };
  if (inst.status === "disabled") return { status: "ignored", reason: "provider_disabled" };

  const tenantId = inst.tenant_id;
  const providerId = inst.conversation_provider_id;
  const phone = normalizePhone(rawPhone);
  if (!phone) return { status: "error", reason: "unnormalizable_phone", rawPhone };

  // Dedupe (§9): reivindica o source_message_id. Se já existe, ignora.
  const claim = await claimSourceMessage({
    tenantId,
    sourceMessageId: ghostMessageId,
    direction: "INBOUND",
    origin: "ghl",
    providerId,
    ghostContactId,
    ghostMessageId,
  });
  if (!claim.claimed) {
    return { status: "ignored", reason: "duplicate_source_message", bridgeId: claim.row?.id };
  }
  const bridgeId = claim.row.id;

  try {
    // Resolve o mesmo cliente na Main (§3 ETAPA D + §4).
    let mapping = await findMappingByPhone({ tenantId, providerId, phone });
    let mainContactId = mapping?.main_contact_id;

    if (!mainContactId) {
      const resolved = await resolveContact(mainToken(inst), {
        locationId: inst.main_location_id,
        phone,
        name: contactName,
      });
      mainContactId = resolved.contactId;
    }

    // Injeta no Conversations da Main via nosso provider (§5).
    const injected = await injectInboundToMain(mainToken(inst), {
      contactId: mainContactId,
      conversationProviderId: providerId,
      message,
      attachments,
      conversationId: mapping?.main_conversation_id,
    });

    // Persiste mapping (§4) — chave de roteamento pras próximas mensagens.
    mapping = await upsertMapping({
      id: mapping?.id,
      tenant_id: tenantId,
      main_location_id: inst.main_location_id,
      main_contact_id: mainContactId,
      main_conversation_id: injected.conversationId || mapping?.main_conversation_id,
      ghost_location_id: inst.ghost_location_id,
      ghost_contact_id: ghostContactId,
      ghost_conversation_id: ghostConversationId,
      provider_id: providerId,
      phone_normalized: phone,
    });

    await updateBridge(bridgeId, {
      main_message_id: injected.messageId,
      main_contact_id: mainContactId,
      status: "delivered",
    });

    await recordLog({
      tenantId,
      providerId,
      contactName,
      phone,
      direction: "INBOUND",
      message,
      source: "Ghost",
      destination: "Main",
      status: "delivered",
      bridgeId,
    });

    return { status: "ok", bridgeId, mainContactId, mainMessageId: injected.messageId };
  } catch (err) {
    log.error("wa.inbound.failed", { error: err.message, ghostMessageId });
    await updateBridge(bridgeId, { status: "failed", error: err.message }).catch(() => {});
    await recordLog({
      tenantId,
      providerId,
      contactName,
      phone,
      direction: "INBOUND",
      message,
      source: "Ghost",
      destination: "Main",
      status: "failed",
      error: err.message,
      bridgeId,
    });
    return { status: "error", reason: err.message, bridgeId };
  }
}
