/**
 * Renovações de apólice.
 *
 * A pipeline "Policies" desta conta usa os doze meses como estágios: ela
 * JÁ é um calendário de renovação, só que ninguém consegue lê-lo como
 * calendário — na tabela, "Setembro" é só mais um valor de coluna, e
 * quem renova este mês fica no meio de 300 linhas.
 *
 * Esta tela faz a leitura que faltava: quem vence agora, quem vence no
 * mês que vem, e quem está esquecido há tempo demais. A ação principal —
 * mover para o mês do ano seguinte, que é o que "renovar" significa
 * aqui — está no próprio cartão.
 *
 * Não inventa dados: usa o estágio (100% preenchido) e o
 * `lastStageChangeAt` (idem). O campo "Next Policy Anniversary" existe
 * mas está em 1 de 300 contatos, e uma tela construída sobre ele
 * mostraria uma apólice.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import { openStageMenu, commitMove, aplicarMovimentosRecentes } from "./editing.js";
import {
  organizarRenovacoes, ehPipelineDeRenovacao, nomeDoMes, mesesAte, LIMITE_PARADA,
} from "../shared/renewals.js";

export function createRenewalsView(host, { onOpenPage } = {}) {
  let records = [];
  let pipelines = [];
  let users = new Map();
  let calendarios = [];       // as pipelines que são calendário
  let pipelineId = null;      // qual delas está na tela
  let busca = "";
  // O que a pessoa abriu ou fechou nesta sessão, por faixa. Guarda só o
  // que ela mexeu: o resto segue o padrão (as três de prazo abertas,
  // "mais adiante" fechada), que é o que a tela quer destacar.
  const aberturas = new Map();

  async function load() {
    host.replaceChildren(renderLoader("Buscando as apólices…"));
    try {
      const data = await api.crm.opportunities(300);
      pipelines = data.pipelines || [];
      users = new Map((data.users || []).map((u) => [u.id, u.name]));
      calendarios = pipelines.filter(ehPipelineDeRenovacao);
      if (!calendarios.some((p) => p.id === pipelineId)) {
        pipelineId = calendarios[0]?.id || null;
      }
      // Idem à tabela: a busca do CRM demora a refletir um estágio
      // recém-gravado, e aqui o estágio é a própria organização da tela.
      records = aplicarMovimentosRecentes(data.records || []);
      render();
    } catch (err) {
      host.replaceChildren(erro(err));
    }
  }

  function erro(err) {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = err?.code === "ghl_not_configured"
      ? "CRM não conectado"
      : "Não foi possível carregar as apólices";
    const p = document.createElement("p");
    p.textContent = err?.code === "ghl_not_configured"
      ? "Falta configurar o token de acesso da conta. Seu conteúdo do workspace não é afetado."
      : "O serviço de dados não respondeu. Nada foi alterado.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ws-btn";
    retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  /** Só as oportunidades da pipeline-calendário escolhida. */
  function apolices() {
    const termo = busca.trim().toLowerCase();
    return records.filter((r) => {
      if (r.pipelineId !== pipelineId) return false;
      if (!termo) return true;
      const alvo = `${r.title} ${r.properties?.contact || ""}`.toLowerCase();
      return alvo.includes(termo);
    });
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-renew";

    if (!calendarios.length) {
      host.appendChild(semCalendario());
      return;
    }

    host.appendChild(renderBarra());

    const { grupos, total } = organizarRenovacoes(apolices());
    if (!total) {
      const vazio = document.createElement("div");
      vazio.className = "ws-db__empty";
      vazio.textContent = busca
        ? "Nenhuma apólice com esse nome."
        : "Nenhuma apólice nesta pipeline ainda.";
      host.appendChild(vazio);
      return;
    }

    for (const grupo of grupos) host.appendChild(renderFaixa(grupo));

    const rodape = document.createElement("p");
    rodape.className = "ws-renew__foot ws-muted";
    rodape.textContent = `${total} ${total === 1 ? "apólice" : "apólices"} nesta pipeline.`;
    host.appendChild(rodape);
  }

  /**
   * Quando nenhuma pipeline é calendário não há o que consertar clicando:
   * a tela explica o que ela espera encontrar, em vez de ficar vazia.
   */
  function semCalendario() {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = "Nenhuma pipeline de renovação encontrada";
    const p = document.createElement("p");
    p.textContent = "Esta tela lê pipelines cujos estágios são os meses do ano — "
      + "é assim que a pipeline de apólices marca quando cada uma vence. "
      + "Nenhuma pipeline da conta está organizada desse jeito.";
    box.append(h, p);
    return box;
  }

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-renew__bar";

    if (calendarios.length > 1) {
      const sel = document.createElement("select");
      sel.className = "ws-select";
      sel.setAttribute("aria-label", "Pipeline de renovação");
      for (const p of calendarios) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        opt.selected = p.id === pipelineId;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => { pipelineId = sel.value; render(); });
      barra.appendChild(sel);
    }

    const campo = document.createElement("input");
    campo.type = "search";
    campo.className = "ws-input ws-renew__search";
    campo.placeholder = "Buscar por apólice ou contato";
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
    barra.appendChild(campo);

    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "ws-btn ws-btn--ghost";
    atualizar.textContent = "Atualizar";
    atualizar.addEventListener("click", load);
    barra.appendChild(atualizar);
    return barra;
  }

  /**
   * Uma faixa. As três de cima ficam abertas; "mais adiante" chega
   * fechada — num calendário de doze meses ela é sempre a maioria (46 de
   * 67 hoje), e aberta ela enterra justamente as que vencem agora.
   */
  function renderFaixa(grupo) {
    const bloco = document.createElement("section");
    bloco.className = "ws-renew__band";
    bloco.dataset.tom = grupo.tom;
    // Buscando, tudo abre — e a busca vence até o que a pessoa fechou
    // à mão: um resultado escondido atrás de uma faixa fechada é
    // indistinguível de "não encontrei".
    const aberta = busca.trim()
      ? true
      : aberturas.get(grupo.id) ?? grupo.tom !== "neutral";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "ws-renew__band-head";
    head.setAttribute("aria-expanded", String(aberta));
    const seta = document.createElement("span");
    seta.className = "ws-renew__band-caret";
    seta.textContent = aberta ? "▾" : "▸";
    const titulo = document.createElement("h2");
    titulo.textContent = grupo.nome;
    const conta = document.createElement("span");
    conta.className = "ws-renew__band-count";
    conta.textContent = grupo.itens.length;
    head.append(seta, titulo, conta);
    head.addEventListener("click", () => {
      aberturas.set(grupo.id, !aberta);
      render();
    });

    bloco.appendChild(head);
    if (aberta) {
      const grade = document.createElement("div");
      grade.className = "ws-renew__grid";
      for (const item of grupo.itens) grade.appendChild(renderCartao(item));
      bloco.appendChild(grade);
    }
    return bloco;
  }

  function renderCartao({ record, mes, dias }) {
    const card = document.createElement("article");
    card.className = "ws-renew__card";

    const topo = document.createElement("div");
    topo.className = "ws-renew__card-top";
    const nome = document.createElement("h3");
    nome.className = "ws-renew__name";
    nome.textContent = record.title || "Sem nome";
    topo.appendChild(nome);

    const quando = document.createElement("button");
    quando.type = "button";
    quando.className = "ws-chip ws-renew__month";
    quando.dataset.color = corDoPrazo(mes);
    quando.textContent = mes === null ? (record.properties?.stage || "Sem mês") : nomeDoMes(mes);
    quando.title = "Mover para outro mês";
    quando.addEventListener("click", () => {
      openStageMenu(quando, record, pipelines, (pid, sid) =>
        commitMove({ record, pipelines, pipelineId: pid, stageId: sid, repaint: render }));
    });
    topo.appendChild(quando);
    card.appendChild(topo);

    const linhas = document.createElement("dl");
    linhas.className = "ws-renew__meta";
    const contato = record.properties?.contact;
    if (contato) adicionarLinha(linhas, "Contato", contato);
    const responsavel = users.get(record.properties?.assigned);
    if (responsavel) adicionarLinha(linhas, "Responsável", responsavel);
    if (record.properties?.value) {
      adicionarLinha(linhas, "Valor", formatarValor(record.properties.value));
    }
    if (linhas.childElementCount) card.appendChild(linhas);

    card.appendChild(renderParado(dias));

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

  /**
   * O tempo parado é o segundo eixo da tela: dentro da mesma faixa, é
   * ele que decide para quem ligar antes. "Sem registro" é dito, não
   * escondido — o silêncio pareceria "mexeram agora".
   */
  function renderParado(dias) {
    const tag = document.createElement("p");
    tag.className = "ws-renew__idle";
    if (dias === null) {
      tag.textContent = "Sem registro de movimentação";
      tag.dataset.nivel = "desconhecido";
      return tag;
    }
    tag.textContent = dias === 0
      ? "Movida hoje"
      : `Parada há ${dias} ${dias === 1 ? "dia" : "dias"}`;
    // Só um degrau de destaque, na linha dos 90 dias. Um degrau
    // intermediário em 30 pintaria hoje 66 dos 67 cartões — a cor
    // deixaria de dizer qualquer coisa.
    tag.dataset.nivel = dias >= LIMITE_PARADA ? "alto" : "ok";
    return tag;
  }

  function adicionarLinha(dl, rotulo, valor) {
    const dt = document.createElement("dt");
    dt.textContent = rotulo;
    const dd = document.createElement("dd");
    dd.textContent = valor;
    dl.append(dt, dd);
  }

  function formatarValor(v) {
    try {
      return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    } catch {
      return String(v);
    }
  }

  /** Cor do mês pela distância até ele: vermelho agora, cinza lá longe. */
  function corDoPrazo(mes) {
    const falta = mesesAte(mes);
    if (falta === null) return "gray";
    if (falta === 0) return "red";
    if (falta === 1) return "orange";
    if (falta <= 3) return "yellow";
    return "gray";
  }

  async function abrirFicha(contactId, button) {
    const rotulo = button.textContent;
    button.disabled = true;
    button.textContent = "Abrindo…";
    try {
      const { page, created } = await api.crm.openDossier(contactId);
      toast(created ? "Pasta do contato criada." : "Abrindo a pasta.", { tone: "success" });
      onOpenPage?.(page.id);
    } catch (err) {
      toast(err?.code === "contact_not_found"
        ? "Este contato não existe mais na sua conta Spark."
        : "Não foi possível abrir a pasta.", { tone: "danger" });
      button.disabled = false;
      button.textContent = rotulo;
    }
  }

  load();
  return { reload: load };
}
