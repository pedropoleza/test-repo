/**
 * Núcleo da bridge: contact mapping, message bridge, dedupe e loop guard.
 *
 * Aqui vivem as regras de CORREÇÃO mais importantes do sistema:
 *   - §9 Deduplicação: source_message_id UNIQUE. Antes de processar, se já
 *     existe → ignora. (Evita processar o mesmo webhook duas vezes.)
 *   - §10 Loop guard: toda mensagem que o middleware envia é registrada ANTES
 *     da chamada externa com origin='spark_bridge'. Quando o webhook
 *     correspondente volta (ghost_message_id já presente), NÃO reenviamos.
 *     Quebra o loop Ghost→Main→webhook→Ghost→...
 */
import { db } from "../server/db.js";
import { log } from "../server/log.js";

// ------------------------------------------------------------------ dedupe

/**
 * Tenta "reivindicar" um evento de origem. Insere um bridge row placeholder
 * com source_message_id (UNIQUE). Se já existir, devolve claimed=false — o
 * caller deve IGNORAR o evento (dedupe / loop).
 *
 * Uso como trava atômica: o índice único garante que dois webhooks
 * concorrentes com o mesmo source_message_id nunca sejam processados os dois.
 *
 * @returns {{ claimed: boolean, row: object|null }}
 */
export async function claimSourceMessage({
  tenantId,
  sourceMessageId,
  direction,
  origin = "ghl",
  providerId,
  mainContactId = null,
  ghostContactId = null,
  mainMessageId = null,
  ghostMessageId = null,
}) {
  if (!sourceMessageId) throw new Error("sourceMessageId required");

  const insert = {
    tenant_id: tenantId,
    direction,
    origin,
    source_message_id: sourceMessageId,
    provider_id: providerId,
    main_contact_id: mainContactId,
    ghost_contact_id: ghostContactId,
    main_message_id: mainMessageId,
    ghost_message_id: ghostMessageId,
    status: "pending",
  };

  const { data, error } = await db()
    .from("message_bridge")
    .insert(insert)
    .select()
    .single();

  if (!error) return { claimed: true, row: data };

  // 23505 = unique_violation → já existe (dedupe / evento repetido)
  if (error.code === "23505" || /duplicate key|unique/i.test(error.message || "")) {
    const { data: existing } = await db()
      .from("message_bridge")
      .select("*")
      .eq("source_message_id", sourceMessageId)
      .maybeSingle();
    return { claimed: false, row: existing || null };
  }
  throw error;
}

/**
 * Loop guard (§10): true se este ghostMessageId foi originado pelo próprio
 * bridge (i.e. NÓS enviamos essa mensagem pro Ghost). Nesse caso, o webhook
 * de eco NÃO deve ser reinjetado na Main.
 */
export async function isBridgeOriginatedGhostMessage(ghostMessageId) {
  if (!ghostMessageId) return false;
  const { data, error } = await db()
    .from("message_bridge")
    .select("id, origin")
    .eq("ghost_message_id", ghostMessageId)
    .maybeSingle();
  if (error) {
    log.warn("wa.loopGuard.query_failed", { ghostMessageId, error: error.message });
    return false;
  }
  return !!data;
}

/** Atualiza um bridge row (status, ids externos, erro). */
export async function updateBridge(id, patch) {
  const { error } = await db().from("message_bridge").update(patch).eq("id", id);
  if (error) throw error;
}

// --------------------------------------------------------- contact mapping

/**
 * Acha um mapping existente pelo telefone normalizado dentro do
 * tenant/provider — a chave de roteamento (§4). Depois do primeiro match, as
 * próximas mensagens roteiam sem tocar a API do GHL.
 */
export async function findMappingByPhone({ tenantId, providerId, phone }) {
  const { data, error } = await db()
    .from("contact_channel_mapping")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider_id", providerId)
    .eq("phone_normalized", phone)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Acha mapping pelo contato da MAIN (usado no outbound). */
export async function findMappingByMainContact({ tenantId, mainContactId }) {
  const { data, error } = await db()
    .from("contact_channel_mapping")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("main_contact_id", mainContactId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Upsert do mapping por (tenant, provider, phone). Preenche os ids que ainda
 * faltam sem sobrescrever com null.
 */
export async function upsertMapping(entry) {
  const clean = Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined && v !== null),
  );
  const { data, error } = await db()
    .from("contact_channel_mapping")
    .upsert(clean, { onConflict: "tenant_id,provider_id,phone_normalized" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
