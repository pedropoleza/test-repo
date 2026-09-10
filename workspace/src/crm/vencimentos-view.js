/**
 * Radar de vencimentos.
 *
 * O motor da receita recorrente: registration, annual report, licença,
 * PO Box, apólice — cada um com um campo de data no contato. A tela lê
 * essas datas de toda a base e mostra o que vence, por urgência, antes
 * que dependa de alguém lembrar.
 *
 * A leitura vem antes da lista. Antes de ler nome por nome, ela precisa
 * ver quanto está vermelho e qual serviço está puxando o vermelho — por
 * isso o topo é a régua de urgência (que também é o filtro) e, embaixo
 * dela, a distribuição por serviço. Só depois vêm os cartões, cada um
 * com a barra do prazo desenhada.
 *
 * Cruza duas fontes: os contatos (com seus campos) e o catálogo (que diz
 * quais serviços são recorrentes e onde está a data de cada um). Numa
 * conta sem serviço recorrente, a tela explica isso em vez de ficar vazia.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import {
  organizarVencimentos, vencimentosDosContatos, resumoVencimentos,
  progressoDoPrazo, JANELA_RADAR,
} from "../shared/upcoming.js";

export function createVencimentosView(host, { onOpenPage } = {}) {
  let recorrentes = [];
  let contatos = [];
  let busca = "";
  let servicoFiltro = null;   // code do serviço, ou null = todos
  let faixaFiltro = null;     // id da faixa de urgência, ou null = todas

  async function load() {
    host.replaceChildren(renderLoader("Buscando os vencimentos…"));
    try {
      const [cat, dados] = await Promise.all([
        api.crm.catalog(),
        api.crm.contacts(300),
      ]);
      recorrentes = cat.recorrentes || [];
      contatos = dados.records || [];
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
      : "Não foi possível carregar os vencimentos";
    const p = document.createElement("p");
    p.textContent = "O serviço de dados não respondeu. Nada foi alterado.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "ws-btn"; retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  /**
   * Duas listas de propósito. A régua e a distribuição descrevem TUDO
   * que casa com o serviço e a busca, para os números não se apagarem
   * quando ela clica numa faixa; só os cartões obedecem à faixa. Uma
   * régua que zera as outras faixas ao ser clicada esconde justamente
   * a informação que faz alguém querer clicar na próxima.
   */
  function itensBase() {
    const termo = busca.trim().toLowerCase();
    return vencimentosDosContatos(contatos, recorrentes).filter((i) => {
      if (servicoFiltro && i.servico.code !== servicoFiltro) return false;
      if (termo && !i.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }

  function itensVisiveis(base) {
    if (!faixaFiltro) return base;
    return organizarVencimentos(base).grupos
      .filter((g) => g.id === faixaFiltro)
      .flatMap((g) => g.itens);
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-radar";

    if (!recorrentes.length) {
      host.appendChild(semRecorrentes());
      return;
    }

    host.appendChild(renderBarra());

    const base = itensBase();
    const resumo = resumoVencimentos(base);

    if (!resumo.total) {
      host.appendChild(vazio());
      return;
    }

    host.appendChild(renderRegua(resumo));
    const distrib = renderDistribuicao(resumo);
    if (distrib) host.appendChild(distrib);

    const { grupos, total } = organizarVencimentos(itensVisiveis(base));
    if (!total) {
      const nada = document.createElement("div");
      nada.className = "ws-db__empty";
      nada.textContent = "Nenhum vencimento nesta faixa com os filtros atuais.";
      host.appendChild(nada);
      return;
    }

    for (const grupo of grupos) host.appendChild(renderFaixa(grupo));

    const rodape = document.createElement("p");
    rodape.className = "ws-radar__foot ws-muted";
    rodape.textContent = faixaFiltro
      ? `${total} de ${resumo.total} ${resumo.total === 1 ? "vencimento" : "vencimentos"}.`
      : `${total} ${total === 1 ? "vencimento" : "vencimentos"}.`;
    host.appendChild(rodape);
  }

  function vazio() {
    const box = document.createElement("div");
    box.className = "ws-db__empty";
    box.textContent = busca || servicoFiltro
      ? "Nenhum vencimento com esse filtro."
      : "Nenhuma data de vencimento preenchida ainda. Conforme os serviços "
        + "recorrentes recebem a data, eles aparecem aqui.";
    return box;
  }

  function semRecorrentes() {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = "Nenhum serviço recorrente nesta conta";
    const p = document.createElement("p");
    p.textContent = "O radar acompanha serviços que renovam por uma data — PO Box, "
      + "registration, annual report, licença. Esta conta não tem nenhum configurado.";
    box.append(h, p);
    return box;
  }

  /* ---------------- régua de urgência ---------------- */

  /**
   * As cinco faixas como pastilhas grandes e clicáveis, e embaixo uma
   * barra única com a proporção entre elas. A pastilha é o filtro: ver
   * "18 vencidos" e querer só eles é o mesmo gesto.
   */
  function renderRegua(resumo) {
    const bloco = document.createElement("section");
    bloco.className = "ws-radar__resumo";

    const grade = document.createElement("div");
    grade.className = "ws-radar__tiles";
    grade.setAttribute("role", "group");
    grade.setAttribute("aria-label", "Filtrar por urgência");

    for (const faixa of resumo.faixas) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "ws-radar__tile";
      tile.dataset.tom = faixa.tom;
      tile.dataset.faixa = faixa.id;
      tile.dataset.ativo = faixaFiltro === faixa.id ? "sim" : "nao";
      tile.dataset.zero = faixa.total ? "nao" : "sim";
      tile.setAttribute("aria-pressed", String(faixaFiltro === faixa.id));

      const n = document.createElement("span");
      n.className = "ws-radar__tile-num";
      n.textContent = faixa.total;
      const rot = document.createElement("span");
      rot.className = "ws-radar__tile-lbl";
      rot.textContent = faixa.nome;
      tile.append(n, rot);

      tile.addEventListener("click", () => {
        faixaFiltro = faixaFiltro === faixa.id ? null : faixa.id;
        render();
      });
      grade.appendChild(tile);
    }
    bloco.appendChild(grade);

    // A proporção entre as faixas, numa barra só. É o "quão ruim está".
    const barra = document.createElement("div");
    barra.className = "ws-radar__stack";
    barra.setAttribute("role", "img");
    barra.setAttribute("aria-label", resumo.faixas
      .filter((f) => f.total)
      .map((f) => `${f.nome}: ${f.total}`)
      .join("; "));
    for (const faixa of resumo.faixas) {
      if (!faixa.total) continue;
      const parte = document.createElement("span");
      parte.className = "ws-radar__stack-part";
      parte.dataset.tom = faixa.tom;
      parte.dataset.faixa = faixa.id;
      parte.style.width = `${faixa.pct}%`;
      parte.title = `${faixa.nome}: ${faixa.total}`;
      barra.appendChild(parte);
    }
    bloco.appendChild(barra);

    if (faixaFiltro) {
      const limpar = document.createElement("button");
      limpar.type = "button";
      limpar.className = "ws-btn ws-btn--ghost ws-radar__limpar";
      limpar.textContent = "Ver todas as faixas";
      limpar.addEventListener("click", () => { faixaFiltro = null; render(); });
      bloco.appendChild(limpar);
    }
    return bloco;
  }

  /* ---------------- distribuição por serviço ---------------- */

  /**
   * Uma linha por serviço, com a barra quebrada por urgência. Responde
   * "qual serviço está puxando o vermelho" sem contar cartão. Com um
   * serviço só, some — uma barra sozinha não compara nada.
   */
  function renderDistribuicao(resumo) {
    if (resumo.servicos.length < 2) return null;
    const maior = Math.max(...resumo.servicos.map((s) => s.total));

    const bloco = document.createElement("section");
    bloco.className = "ws-radar__dist";

    const titulo = document.createElement("h2");
    titulo.className = "ws-radar__dist-title";
    titulo.textContent = "Por serviço";
    bloco.appendChild(titulo);

    for (const svc of resumo.servicos) {
      const linha = document.createElement("button");
      linha.type = "button";
      linha.className = "ws-radar__dist-row";
      linha.dataset.ativo = servicoFiltro === svc.code ? "sim" : "nao";
      linha.setAttribute("aria-pressed", String(servicoFiltro === svc.code));

      const nome = document.createElement("span");
      nome.className = "ws-radar__dist-name";
      nome.textContent = `${svc.icone} ${svc.nome}`.trim();

      const trilho = document.createElement("span");
      trilho.className = "ws-radar__dist-track";
      // A largura do trilho é o volume relativo ao maior serviço; os
      // pedaços dentro dele são a urgência. Dois eixos, uma linha.
      const barra = document.createElement("span");
      barra.className = "ws-radar__dist-bar";
      barra.style.width = `${maior ? (svc.total / maior) * 100 : 0}%`;
      for (const faixa of resumo.faixas) {
        const n = svc.faixas[faixa.id] || 0;
        if (!n) continue;
        const parte = document.createElement("span");
        parte.className = "ws-radar__stack-part";
        parte.dataset.tom = faixa.tom;
        parte.dataset.faixa = faixa.id;
        parte.style.width = `${(n / svc.total) * 100}%`;
        parte.title = `${faixa.nome}: ${n}`;
        barra.appendChild(parte);
      }
      trilho.appendChild(barra);

      // Os dois números empilhados, nunca lado a lado: "5" ao lado de
      // "2 vencidos" se lê como "52".
      const total = document.createElement("span");
      total.className = "ws-radar__dist-num";
      const n = document.createElement("b");
      n.textContent = svc.total;
      total.appendChild(n);
      if (svc.vencidos) {
        const venc = document.createElement("small");
        venc.className = "ws-radar__dist-venc";
        venc.textContent = `${svc.vencidos} vencido${svc.vencidos === 1 ? "" : "s"}`;
        total.appendChild(venc);
      }

      linha.append(nome, trilho, total);
      linha.addEventListener("click", () => {
        servicoFiltro = servicoFiltro === svc.code ? null : svc.code;
        render();
      });
      bloco.appendChild(linha);
    }
    return bloco;
  }

  /* ---------------- barra de filtros ---------------- */

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-radar__bar";

    // Filtro por serviço: só os recorrentes, mais "Todos".
    const sel = document.createElement("select");
    sel.className = "ws-select";
    sel.setAttribute("aria-label", "Serviço");
    const todos = document.createElement("option");
    todos.value = ""; todos.textContent = "Todos os serviços";
    sel.appendChild(todos);
    for (const s of recorrentes) {
      const opt = document.createElement("option");
      opt.value = s.code;
      opt.textContent = `${s.icone} ${s.nome}`;
      opt.selected = s.code === servicoFiltro;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { servicoFiltro = sel.value || null; render(); });
    barra.appendChild(sel);

    const campo = document.createElement("input");
    campo.type = "search";
    campo.className = "ws-input ws-radar__search";
    campo.placeholder = "Buscar por contato";
    campo.value = busca;
    campo.addEventListener("input", () => {
      busca = campo.value;
      const foco = document.activeElement === campo;
      render();
      if (foco) {
        const novo = host.querySelector(".ws-radar__search");
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

  /* ---------------- faixas e cartões ---------------- */

  function renderFaixa(grupo) {
    const bloco = document.createElement("section");
    bloco.className = "ws-radar__band";
    bloco.dataset.tom = grupo.tom;
    bloco.dataset.faixa = grupo.id;

    const head = document.createElement("header");
    head.className = "ws-radar__band-head";
    const titulo = document.createElement("h2");
    titulo.textContent = grupo.nome;
    const conta = document.createElement("span");
    conta.className = "ws-radar__band-count";
    conta.textContent = grupo.itens.length;
    head.append(titulo, conta);

    const grade = document.createElement("div");
    grade.className = "ws-radar__grid";
    for (const item of grupo.itens) grade.appendChild(renderCartao(item));

    bloco.append(head, grade);
    return bloco;
  }

  function renderCartao(item) {
    const card = document.createElement("article");
    card.className = "ws-radar__card";
    card.dataset.tom = tomDosDias(item.dias);
    card.dataset.faixa = item.faixa || "";

    const topo = document.createElement("div");
    topo.className = "ws-radar__card-top";

    const nome = document.createElement("h3");
    nome.className = "ws-radar__name";
    nome.textContent = item.nome;

    // O contador é o dado principal do cartão: -12 / hoje / 34. Para
    // quem ouve a tela ele é ruído — o parágrafo do prazo, embaixo, já
    // diz a mesma coisa por extenso.
    const contador = document.createElement("span");
    contador.className = "ws-radar__count";
    contador.setAttribute("aria-hidden", "true");
    const num = document.createElement("b");
    num.textContent = item.dias === 0 ? "hoje" : Math.abs(item.dias);
    const un = document.createElement("small");
    un.textContent = item.dias === 0 ? ""
      : (item.dias < 0 ? "dias atrás" : "dias");
    contador.append(num, un);

    topo.append(nome, contador);
    card.appendChild(topo);

    const svc = document.createElement("p");
    svc.className = "ws-radar__svc";
    svc.textContent = `${item.servico.icone} ${item.servico.nome}`.trim();
    card.appendChild(svc);

    // A barra do prazo: quanto do caminho até vencer já foi andado.
    const trilho = document.createElement("div");
    trilho.className = "ws-radar__prazo";
    trilho.setAttribute("role", "img");
    trilho.setAttribute("aria-label", textoDoPrazo(item.dias, item.data));
    const preenche = document.createElement("span");
    preenche.className = "ws-radar__prazo-fill";
    preenche.style.width = `${Math.round(progressoDoPrazo(item.dias) * 100)}%`;
    trilho.appendChild(preenche);
    card.appendChild(trilho);

    const quando = document.createElement("p");
    quando.className = "ws-radar__quando";
    quando.textContent = textoDoPrazo(item.dias, item.data);
    card.appendChild(quando);

    if (item.contactId) {
      const abrir = document.createElement("button");
      abrir.type = "button";
      abrir.className = "ws-btn ws-btn--ghost ws-radar__open";
      abrir.textContent = "Abrir pasta";
      abrir.addEventListener("click", () => abrirFicha(item.contactId, abrir));
      card.appendChild(abrir);
    }
    return card;
  }

  function textoDoPrazo(dias, data) {
    const quando = formatarData(data);
    if (dias < 0) return `Venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"} · ${quando}`;
    if (dias === 0) return `Vence hoje · ${quando}`;
    if (dias > JANELA_RADAR) return `Vence em ${dias} dias · ${quando}`;
    return `Vence em ${dias} ${dias === 1 ? "dia" : "dias"} · ${quando}`;
  }

  function formatarData(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }

  function tomDosDias(dias) {
    if (dias < 0) return "danger";
    if (dias <= 30) return "danger";
    if (dias <= 60) return "warn";
    if (dias <= 90) return "info";
    return "neutral";
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
