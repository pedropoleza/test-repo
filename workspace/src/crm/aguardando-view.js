/**
 * Painel operacional "Aguardando".
 *
 * O que está parado agora: esperando o cliente trazer documento, ou
 * esperando um terceiro responder. Ordenado por tempo parado, para ela
 * ligar primeiro para quem espera há mais tempo. É o batimento do dia.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import { organizarAguardando } from "../shared/waiting.js";

export function createAguardandoView(host, { onOpenPage } = {}) {
  let records = [];
  let users = new Map();
  let busca = "";

  async function load() {
    host.replaceChildren(renderLoader("Buscando os casos parados…"));
    try {
      const data = await api.crm.opportunities(300);
      users = new Map((data.users || []).map((u) => [u.id, u.name]));
      records = data.records || [];
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
      : "Não foi possível carregar os casos";
    const p = document.createElement("p");
    p.textContent = "O serviço de dados não respondeu. Nada foi alterado.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "ws-btn"; retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  function filtrados() {
    const termo = busca.trim().toLowerCase();
    if (!termo) return records;
    return records.filter((r) => {
      const alvo = `${r.title} ${r.properties?.contact || ""}`.toLowerCase();
      return alvo.includes(termo);
    });
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-renew";
    host.appendChild(renderBarra());

    const { grupos, total } = organizarAguardando(filtrados());
    if (!total) {
      const vazio = document.createElement("div");
      vazio.className = "ws-db__empty";
      vazio.textContent = busca
        ? "Nenhum caso parado com esse nome."
        : "Nenhum caso parado. Tudo em andamento ou entregue.";
      host.appendChild(vazio);
      return;
    }

    for (const grupo of grupos) host.appendChild(renderFaixa(grupo));

    const rodape = document.createElement("p");
    rodape.className = "ws-renew__foot ws-muted";
    rodape.textContent = `${total} ${total === 1 ? "caso parado" : "casos parados"}.`;
    host.appendChild(rodape);
  }

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-renew__bar";
    const campo = document.createElement("input");
    campo.type = "search";
    campo.className = "ws-input ws-renew__search";
    campo.placeholder = "Buscar por caso ou contato";
    campo.value = busca;
    campo.addEventListener("input", () => {
      busca = campo.value;
      const foco = document.activeElement === campo;
      render();
      if (foco) {
        const novo = host.querySelector(".ws-renew__search");
        novo?.focus();
        novo?.setSelectionRange(novo.value.length, novo.value.length);
      }
    });
    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "ws-btn ws-btn--ghost";
    atualizar.textContent = "Atualizar";
    atualizar.addEventListener("click", load);
    barra.append(campo, atualizar);
    return barra;
  }

  function renderFaixa(grupo) {
    const bloco = document.createElement("section");
    bloco.className = "ws-renew__band";
    // Espera pelo cliente é acionável por telefone: destaque quente. A do
    // terceiro depende de fora: tom mais frio.
    bloco.dataset.tom = grupo.tipo === "cliente" ? "warn" : "info";

    const head = document.createElement("header");
    head.className = "ws-renew__band-head";
    head.style.cursor = "default";
    const titulo = document.createElement("h2");
    titulo.textContent = grupo.nome;
    const conta = document.createElement("span");
    conta.className = "ws-renew__band-count";
    conta.textContent = grupo.itens.length;
    head.append(titulo, conta);

    const grade = document.createElement("div");
    grade.className = "ws-renew__grid";
    for (const item of grupo.itens) grade.appendChild(renderCartao(item));

    bloco.append(head, grade);
    return bloco;
  }

  function renderCartao({ record, dias }) {
    const card = document.createElement("article");
    card.className = "ws-renew__card";

    const topo = document.createElement("div");
    topo.className = "ws-renew__card-top";
    const nome = document.createElement("h3");
    nome.className = "ws-renew__name";
    nome.textContent = record.properties?.contact || record.title || "Sem nome";
    const chip = document.createElement("span");
    chip.className = "ws-chip ws-renew__month";
    chip.dataset.color = corDosDias(dias);
    chip.style.cursor = "default";
    chip.textContent = servicoCurto(record.properties?.pipeline);
    topo.append(nome, chip);
    card.appendChild(topo);

    const meta = document.createElement("dl");
    meta.className = "ws-renew__meta";
    if (record.title && record.title !== nome.textContent) linha(meta, "Caso", record.title);
    const responsavel = users.get(record.properties?.assigned);
    if (responsavel) linha(meta, "Responsável", responsavel);
    if (meta.childElementCount) card.appendChild(meta);

    const tag = document.createElement("p");
    tag.className = "ws-renew__idle";
    tag.dataset.nivel = dias >= 30 ? "alto" : "ok";
    tag.textContent = dias === null ? "Sem registro de movimentação"
      : dias === 0 ? "Parou hoje"
      : `Parado há ${dias} ${dias === 1 ? "dia" : "dias"}`;
    card.appendChild(tag);

    if (record.contactId) {
      const abrir = document.createElement("button");
      abrir.type = "button";
      abrir.className = "ws-btn ws-btn--ghost ws-renew__open";
      abrir.textContent = "Abrir pasta";
      abrir.addEventListener("click", () => abrirFicha(record.contactId, abrir));
      card.appendChild(abrir);
    }
    return card;
  }

  function linha(dl, rotulo, valor) {
    const dt = document.createElement("dt"); dt.textContent = rotulo;
    const dd = document.createElement("dd"); dd.textContent = valor;
    dl.append(dt, dd);
  }

  /** Tira a numeração da pipeline: "3 · Empresas e Fiscal" → "Empresas e Fiscal". */
  function servicoCurto(nome) {
    return String(nome || "").replace(/^\s*\d+\s*[.·:\-—)]\s*/, "").trim() || "Serviço";
  }

  function corDosDias(dias) {
    if (dias === null) return "gray";
    if (dias >= 30) return "red";
    if (dias >= 14) return "orange";
    return "yellow";
  }

  async function abrirFicha(contactId, botao) {
    const rotulo = botao.textContent;
    botao.disabled = true; botao.textContent = "Abrindo…";
    try {
      const { page, created } = await api.crm.openDossier(contactId);
      toast(created ? "Pasta do contato criada." : "Abrindo a pasta.", { tone: "success" });
      onOpenPage?.(page.id);
    } catch (err) {
      toast(err?.code === "contact_not_found"
        ? "Este contato não existe mais na conta." : "Não foi possível abrir a pasta.",
        { tone: "danger" });
      botao.disabled = false; botao.textContent = rotulo;
    }
  }

  load();
  return { reload: load };
}
