/**
 * Painel de documentos para assinar.
 *
 * A ficha mostra os documentos de UM contato; aqui está a fila inteira da
 * conta: o que foi enviado e ninguém abriu, o que o cliente abriu mas não
 * assinou, e o que já voltou assinado. É por esta tela que se cobra quem
 * ficou pelo caminho — que é onde o dinheiro costuma parar.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";

const FAIXAS = [
  { id: "aberto",    nome: "Aberto pelo cliente, sem assinar", tom: "warn" },
  { id: "pendente",  nome: "Enviado, ainda não aberto",        tom: "info" },
  { id: "assinado",  nome: "Assinado",                         tom: "ok" },
  { id: "cancelado", nome: "Cancelado",                        tom: "neutral" },
];

export function createDocsView(host, { onOpenPage } = {}) {
  let pedidos = [];
  let nomes = new Map();

  async function load() {
    host.replaceChildren(renderLoader("Buscando os documentos…"));
    try {
      const [lista, contatos] = await Promise.all([
        api.docs.all(),
        // Só para trocar o id do contato por um nome legível.
        api.crm.contacts(300).catch(() => ({ records: [] })),
      ]);
      pedidos = lista.pedidos || [];
      nomes = new Map((contatos.records || []).map((c) => [c.externalId, c.title]));
      render();
    } catch (err) {
      host.replaceChildren(erro(err));
    }
  }

  function erro(err) {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = err?.code === "ghl_not_configured" ? "CRM não conectado"
      : "Não foi possível carregar os documentos";
    const p = document.createElement("p");
    p.textContent = "O serviço de dados não respondeu. Nada foi alterado.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "ws-btn"; retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-renew";

    const barra = document.createElement("div");
    barra.className = "ws-renew__bar";
    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "ws-btn ws-btn--ghost";
    atualizar.textContent = "Atualizar";
    atualizar.addEventListener("click", load);
    barra.appendChild(atualizar);
    host.appendChild(barra);

    if (!pedidos.length) {
      const vazio = document.createElement("div");
      vazio.className = "ws-db__empty";
      vazio.textContent = "Nenhum documento enviado ainda. Mande um pela ficha do contato.";
      host.appendChild(vazio);
      return;
    }

    for (const faixa of FAIXAS) {
      const doGrupo = pedidos.filter((p) => p.status === faixa.id);
      if (!doGrupo.length) continue;
      host.appendChild(renderFaixa(faixa, doGrupo));
    }

    const rodape = document.createElement("p");
    rodape.className = "ws-renew__foot ws-muted";
    rodape.textContent = `${pedidos.length} ${pedidos.length === 1 ? "documento" : "documentos"}.`;
    host.appendChild(rodape);
  }

  function renderFaixa(faixa, itens) {
    const bloco = document.createElement("section");
    bloco.className = "ws-renew__band";
    bloco.dataset.tom = faixa.tom === "ok" ? "info" : faixa.tom;

    const head = document.createElement("header");
    head.className = "ws-renew__band-head";
    head.style.cursor = "default";
    const titulo = document.createElement("h2");
    titulo.textContent = faixa.nome;
    const conta = document.createElement("span");
    conta.className = "ws-renew__band-count";
    conta.textContent = itens.length;
    head.append(titulo, conta);

    const grade = document.createElement("div");
    grade.className = "ws-renew__grid";
    for (const p of itens) grade.appendChild(renderCartao(p));

    bloco.append(head, grade);
    return bloco;
  }

  function renderCartao(p) {
    const card = document.createElement("article");
    card.className = "ws-renew__card";

    const topo = document.createElement("div");
    topo.className = "ws-renew__card-top";
    const nome = document.createElement("h3");
    nome.className = "ws-renew__name";
    nome.textContent = nomes.get(p.contactId) || p.contactId;
    const chip = document.createElement("span");
    chip.className = "ws-chip";
    chip.style.cursor = "default";
    chip.dataset.color = p.idioma === "pt" ? "green" : p.idioma === "es" ? "orange" : "blue";
    chip.textContent = (p.idioma || "").toUpperCase();
    topo.append(nome, chip);
    card.appendChild(topo);

    const doc = document.createElement("p");
    doc.className = "ws-renew__idle";
    doc.textContent = p.nome;
    card.appendChild(doc);

    const quando = document.createElement("p");
    quando.className = "ws-renew__idle";
    quando.dataset.nivel = p.status === "aberto" ? "alto" : "ok";
    quando.textContent = p.status === "assinado" && p.assinadoEm
      ? `Assinado por ${p.assinadoPor || "cliente"} · ${dataCurta(p.assinadoEm)}`
      : `Enviado ${dataCurta(p.criadoEm)}${p.abertoEm ? ` · aberto ${dataCurta(p.abertoEm)}` : ""}`;
    card.appendChild(quando);

    if (p.contactId) {
      const abrir = document.createElement("button");
      abrir.type = "button";
      abrir.className = "ws-btn ws-btn--ghost ws-renew__open";
      abrir.textContent = "Abrir pasta";
      abrir.addEventListener("click", () => abrirFicha(p.contactId, abrir));
      card.appendChild(abrir);
    }
    return card;
  }

  function dataCurta(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  async function abrirFicha(contactId, botao) {
    botao.disabled = true;
    try {
      const { page } = await api.crm.openDossier(contactId);
      onOpenPage?.(page.id);
    } catch {
      toast("Não foi possível abrir a pasta.", { tone: "danger" });
      botao.disabled = false;
    }
  }

  load();
  return { reload: load };
}
