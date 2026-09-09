/**
 * Dados do portal de status, para o contato de um token.
 *
 * Traduz os estágios internos das oportunidades do contato em frases que
 * o cliente entende, no idioma escolhido. Reusa loadContactDetail (que já
 * busca contato + oportunidades no CRM) e o mapa por categoria de
 * client-status.js — um estágio novo que caia no padrão já sai certo.
 */
import { loadContactDetail } from "./contact-detail.js";
import { statusDoCaso } from "../../src/shared/client-status.js";

/** Só o primeiro nome, para a saudação — sem expor o nome completo. */
function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

/**
 * `{ nome, servicos: [{ nome, status, acaoCliente }] }` para o idioma
 * dado. Serviço = a oportunidade; o nome amigável é o da pipeline.
 */
export async function buildStatusData(contactId, lang = "pt") {
  const detail = await loadContactDetail(contactId, null);
  const servicos = (detail.opportunities || [])
    .filter((o) => (o.properties?.status || "open") !== "lost")
    .map((o) => {
      const st = statusDoCaso(o.properties?.stage || "", lang);
      return {
        nome: o.properties?.pipeline || o.title || "Serviço",
        status: st.titulo,
        categoria: st.id,
        acaoCliente: st.acaoCliente,
      };
    });
  return { nome: primeiroNome(detail.record?.title), servicos };
}
