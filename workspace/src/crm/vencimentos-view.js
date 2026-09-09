/**
 * Radar de vencimentos.
 *
 * O motor da receita recorrente: registration, annual report, licença,
 * PO Box, apólice — cada um com um campo de data no contato. A tela lê
 * essas datas de toda a base e mostra o que vence, por urgência, antes
 * que dependa de alguém lembrar.
 *
 * Cruza duas fontes: os contatos (com seus campos) e o catálogo (que diz
 * quais serviços são recorrentes e onde está a data de cada um). Numa
 * conta sem serviço recorrente, a tela explica isso em vez de ficar vazia.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import { organizarVencimentos, vencimentosDosContatos } from "../shared/upcoming.js";

export function createVencimentosView(host, { onOpenPage } = {}) {
  let recorrentes = [];
  let contatos = [];
  let busca = "";
  let servicoFiltro = null;   // code do serviço, ou null = todos

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

  function itens() {
    const todos = vencimentosDosContatos(contatos, recorrentes);
    const termo = busca.trim().toLowerCase();
    return todos.filter((i) => {
      if (servicoFiltro && i.servico.code !== servicoFiltro) return false;
      if (termo && !i.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-renew";

    if (!recorrentes.length) {
      host.appendChild(semRecorrentes());
      return;
    }

    host.appendChild(renderBarra());

    const { grupos, total } = organizarVencimentos(itens());
    if (!total) {
      const vazio = document.createElement("div");
      vazio.className = "ws-db__empty";
      vazio.textContent = busca || servicoFiltro
        ? "Nenhum vencimento com esse filtro."
        : "Nenhuma data de vencimento preenchida ainda. Conforme os serviços "
          + "recorrentes recebem a data, eles aparecem aqui.";
      host.appendChild(vazio);
      return;
    }

    for (const grupo of grupos) host.appendChild(renderFaixa(grupo));

    const rodape = document.createElement("p");
    rodape.className = "ws-renew__foot ws-muted";
    rodape.textContent = `${total} ${total === 1 ? "vencimento" : "vencimentos"}.`;
    host.appendChild(rodape);
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

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-renew__bar";

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
    campo.className = "ws-input ws-renew__search";
    campo.placeholder = "Buscar por contato";
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

  function renderFaixa(grupo) {
    const bloco = document.createElement("section");
    bloco.className = "ws-renew__band";
    bloco.dataset.tom = grupo.tom;

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

  function renderCartao(item) {
    const card = document.createElement("article");
    card.className = "ws-renew__card";

    const topo = document.createElement("div");
    topo.className = "ws-renew__card-top";
    const nome = document.createElement("h3");
    nome.className = "ws-renew__name";
    nome.textContent = item.nome;
    const chip = document.createElement("span");
    chip.className = "ws-chip ws-renew__month";
    chip.dataset.color = corDosDias(item.dias);
    chip.style.cursor = "default";
    chip.textContent = `${item.servico.icone} ${item.servico.nome}`;
    topo.append(nome, chip);
    card.appendChild(topo);

    const quando = document.createElement("p");
    quando.className = "ws-renew__idle";
    quando.dataset.nivel = item.dias < 0 ? "alto" : "ok";
    quando.textContent = textoDoPrazo(item.dias, item.data);
    card.appendChild(quando);

    if (item.contactId) {
      const abrir = document.createElement("button");
      abrir.type = "button";
      abrir.className = "ws-btn ws-btn--ghost ws-renew__open";
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
    return `Vence em ${dias} ${dias === 1 ? "dia" : "dias"} · ${quando}`;
  }

  function formatarData(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }

  function corDosDias(dias) {
    if (dias < 0) return "red";
    if (dias <= 30) return "orange";
    if (dias <= 60) return "yellow";
    return "gray";
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
