/**
 * Fluxo OUTBOUND (§6–§7) — o ponto mais importante da arquitetura.
 *
 *   AGENT → Main Conversations → seleciona "WhatsApp 2" → GHL chama nossa
 *   Delivery URL → aqui → resolve Ghost → envia pelo WhatsApp real.
 *
 *   1. dedupe (source_message_id = main messageId, UNIQUE)
 *   2. resolve o contato correspondente na Ghost (mapping, senão cria)
 *   3. registra o bridge ANTES da chamada externa com origin='spark_bridge'
 *      (§10) — assim o eco do webhook é reconhecido e não vira loop
 *   4. envia via Ghost /conversations/messages type=WhatsApp
 *   5. atualiza bridge (ghost_message_id, status) + log
 *
 * Pro atendente, tudo acontece na Main. Ele não sabe da Ghost.
 */
import { normalizePhone } from "./phone.js";
import { getInstallationByProvider, ghostToken } from "./provider.js";
import { resolveContact, sendOutboundFromGhost } from "./ghl-conversations.js";
import {
  claimSourceMessage,
  updateBridge,
  findMappingByMainContact,
  findMappingByPhone,
  upsertMapping,
} from "./bridge.js";
import { recordLog } from "./logs.js";
import { log } from "../server/log.js";

export async function processProviderOutbound(evt) {
  const {
    mainLocationId,
    mainContactId,
    mainMessageId,
    conversationProviderId,
    phone: rawPhone,
    contactName,
    message,
    attachments,
  } = evt;

  if (!mainMessageId) return { status: "error", reason: "missing_main_message_id" };

  const inst = await getInstallationByProvider(conversationProviderId, mainLocationId);
  if (!inst) {
    return { status: "error", reason: "installation_not_found", conversationProviderId };
  }
  if (inst.status === "disabled") return { status: "ignored", reason: "provider_disabled" };

  const tenantId = inst.tenant_id;
  const providerId = inst.conversation_provider_id;

  // Dedupe (§9): reivindica o main messageId como source. origin='spark_bridge'
  // porque ESTA mensagem nasce da nossa bridge — é o registro que o §10 exige
  // ANTES da chamada externa.
  const claim = await claimSourceMessage({
    tenantId,
    sourceMessageId: mainMessageId,
    direction: "OUTBOUND",
    origin: "spark_bridge",
    providerId,
    mainContactId,
    mainMessageId,
  });
  if (!claim.claimed) {
    return { status: "ignored", reason: "duplicate_source_message", bridgeId: claim.row?.id };
  }
  const bridgeId = claim.row.id;

  try {
    // Resolve o contato correspondente na Ghost (§6 → §7).
    const phone = normalizePhone(rawPhone);
    let mapping =
      (await findMappingByMainContact({ tenantId, mainContactId })) ||
      (phone ? await findMappingByPhone({ tenantId, providerId, phone }) : null);

    let ghostContactId = mapping?.ghost_contact_id;

    if (!ghostContactId) {
      if (!phone) throw new Error("no_ghost_contact_and_unnormalizable_phone");
      const resolved = await resolveContact(ghostToken(inst), {
        locationId: inst.ghost_location_id,
        phone,
        name: contactName,
      });
      ghostContactId = resolved.contactId;
    }

    // Envia pelo WhatsApp real a partir da Ghost (§7).
    const sent = await sendOutboundFromGhost(ghostToken(inst), {
      ghostContactId,
      message,
      attachments,
    });

    // Registra o ghost_message_id — é o que o loop guard (§10) procura quando o
    // eco do webhook voltar.
    await updateBridge(bridgeId, {
      ghost_message_id: sent.messageId,
      ghost_contact_id: ghostContactId,
      external_message_id: sent.messageId,
      status: "sent",
    });

    // Atualiza/garante o mapping.
    await upsertMapping({
      id: mapping?.id,
      tenant_id: tenantId,
      main_location_id: inst.main_location_id,
      main_contact_id: mainContactId,
      main_conversation_id: mapping?.main_conversation_id,
      ghost_location_id: inst.ghost_location_id,
      ghost_contact_id: ghostContactId,
      ghost_conversation_id: sent.conversationId || mapping?.ghost_conversation_id,
      provider_id: providerId,
      phone_normalized: phone || mapping?.phone_normalized,
    });

    await recordLog({
      tenantId,
      providerId,
      contactName,
      phone,
      direction: "OUTBOUND",
      message,
      source: "Main",
      destination: "WhatsApp",
      status: "sent",
      bridgeId,
    });

    return { status: "ok", bridgeId, ghostContactId, ghostMessageId: sent.messageId };
  } catch (err) {
    log.error("wa.outbound.failed", { error: err.message, mainMessageId });
    await updateBridge(bridgeId, { status: "failed", error: err.message }).catch(() => {});
    await recordLog({
      tenantId,
      providerId,
      contactName,
      phone: normalizePhone(rawPhone),
      direction: "OUTBOUND",
      message,
      source: "Main",
      destination: "WhatsApp",
      status: "failed",
      error: err.message,
      bridgeId,
    });
    return { status: "error", reason: err.message, bridgeId };
  }
}
