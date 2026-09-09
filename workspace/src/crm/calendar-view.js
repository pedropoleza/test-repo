/**
 * Calendário de vencimentos.
 *
 * A mesma fonte do radar de vencimentos, plotada no mês. Onde o radar
 * ordena por urgência ("o que vem primeiro"), aqui o olho pousa no mês
 * inteiro e vê a forma: a semana pesada, o dia com três renovações
 * juntas, o começo do mês vazio. É a visão de calendário do Notion, sobre
 * os dados que a conta já tem.
 *
 * Cruza contatos (com as datas de vencimento) e catálogo (quais serviços
 * são recorrentes, e onde está a data de cada um). Numa conta sem serviço
 * recorrente, explica isso em vez de mostrar uma grade vazia.
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import { vencimentosDosContatos } from "../shared/upcoming.js";
import {
  matrizDoMes, agruparPorDia, rotuloMes, DIAS_SEMANA, chaveDia,
  mesAnterior, mesSeguinte, mesDeHoje,
} from "../shared/calendar.js";

export function createCalendarView(host, { onOpenPage } = {}) {
  let recorrentes = [];
  let contatos = [];
  let servicoFiltro = null;          // code do serviço, ou null = todos
  let mesAtivo = mesDeHoje();        // { ano, mes }

  async function load() {
    host.replaceChildren(renderLoader("Montando o calendário…"));
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
      : "Não foi possível carregar o calendário";
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
    return servicoFiltro ? todos.filter((i) => i.servico.code === servicoFiltro) : todos;
  }

  function render() {
    host.replaceChildren();
    host.className = "ws-cal";

    if (!recorrentes.length) {
      host.appendChild(semRecorrentes());
      return;
    }

    host.appendChild(renderBarra());

    const porDia = agruparPorDia(itens());
    host.appendChild(renderCabecalhoSemana());
    host.appendChild(renderGrade(porDia));

    const total = [...porDia.values()].reduce((n, l) => n + l.length, 0);
    const rodape = document.createElement("p");
    rodape.className = "ws-cal__foot ws-muted";
    rodape.textContent = total
      ? `${total} ${total === 1 ? "vencimento" : "vencimentos"} no total da base.`
      : "Nenhuma data de vencimento preenchida ainda.";
    host.appendChild(rodape);
  }

  function semRecorrentes() {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = "Nenhum serviço recorrente nesta conta";
    const p = document.createElement("p");
    p.textContent = "O calendário plota os serviços que renovam por uma data — PO Box, "
      + "registration, annual report, licença. Esta conta não tem nenhum configurado.";
    box.append(h, p);
    return box;
  }

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-cal__bar";

    const nav = document.createElement("div");
    nav.className = "ws-cal__nav";

    const anterior = botaoNav("‹", "Mês anterior", () => { mesAtivo = mesAnterior(mesAtivo); render(); });
    const rotulo = document.createElement("h2");
    rotulo.className = "ws-cal__month";
    rotulo.textContent = rotuloMes(mesAtivo);
    const seguinte = botaoNav("›", "Próximo mês", () => { mesAtivo = mesSeguinte(mesAtivo); render(); });

    const hoje = document.createElement("button");
    hoje.type = "button";
    hoje.className = "ws-btn ws-btn--ghost ws-cal__today";
    hoje.textContent = "Hoje";
    hoje.addEventListener("click", () => { mesAtivo = mesDeHoje(); render(); });

    nav.append(anterior, rotulo, seguinte, hoje);
    barra.appendChild(nav);

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

    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "ws-btn ws-btn--ghost";
    atualizar.textContent = "Atualizar";
    atualizar.addEventListener("click", load);
    barra.appendChild(atualizar);

    return barra;
  }

  function botaoNav(rotulo, aria, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ws-cal__arrow";
    b.textContent = rotulo;
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
  }

  function renderCabecalhoSemana() {
    const linha = document.createElement("div");
    linha.className = "ws-cal__week-head";
    for (const nome of DIAS_SEMANA) {
      const c = document.createElement("span");
      c.className = "ws-cal__week-day";
      c.textContent = nome;
      linha.appendChild(c);
    }
    return linha;
  }

  function renderGrade(porDia) {
    const grade = document.createElement("div");
    grade.className = "ws-cal__grid";
    const hojeIso = chaveDia(new Date());
    for (const semana of matrizDoMes(mesAtivo)) {
      for (const cel of semana) {
        grade.appendChild(renderDia(cel, porDia.get(cel.iso) || [], hojeIso));
      }
    }
    return grade;
  }

  function renderDia(cel, itensDoDia, hojeIso) {
    const cell = document.createElement("div");
    cell.className = "ws-cal__day";
    cell.dataset.fora = cel.mesAtual ? "nao" : "sim";
    if (cel.iso === hojeIso) cell.dataset.hoje = "sim";

    const numero = document.createElement("span");
    numero.className = "ws-cal__day-num";
    numero.textContent = cel.dia;
    cell.appendChild(numero);

    if (itensDoDia.length) {
      const lista = document.createElement("div");
      lista.className = "ws-cal__events";
      // Até 3 na célula; o resto vira "+N", para o dia cheio não estourar
      // a altura da linha. O radar continua sendo o lugar da lista longa.
      const visiveis = itensDoDia.slice(0, 3);
      for (const item of visiveis) lista.appendChild(renderEvento(item, cel.iso, hojeIso));
      if (itensDoDia.length > visiveis.length) {
        const mais = document.createElement("span");
        mais.className = "ws-cal__more";
        mais.textContent = `+${itensDoDia.length - visiveis.length}`;
        lista.appendChild(mais);
      }
      cell.appendChild(lista);
    }
    return cell;
  }

  function renderEvento(item, iso, hojeIso) {
    const ev = document.createElement("button");
    ev.type = "button";
    ev.className = "ws-cal__event";
    // Passado que não é hoje = já venceu: pinta de vermelho, como no radar.
    ev.dataset.tom = iso < hojeIso ? "vencido" : "ok";
    ev.title = `${item.servico.nome} · ${item.nome}`;
    const ic = document.createElement("span");
    ic.className = "ws-cal__event-ic";
    ic.textContent = item.servico.icone;
    const txt = document.createElement("span");
    txt.className = "ws-cal__event-txt";
    txt.textContent = item.nome;
    ev.append(ic, txt);
    if (item.contactId) {
      ev.addEventListener("click", () => abrirFicha(item.contactId, ev));
    } else {
      ev.disabled = true;
    }
    return ev;
  }

  async function abrirFicha(contactId, botao) {
    botao.disabled = true;
    try {
      const { page, created } = await api.crm.openDossier(contactId);
      toast(created ? "Pasta do contato criada." : "Abrindo a pasta.", { tone: "success" });
      onOpenPage?.(page.id);
    } catch (err) {
      toast(err?.code === "contact_not_found"
        ? "Este contato não existe mais na conta." : "Não foi possível abrir a pasta.",
        { tone: "danger" });
      botao.disabled = false;
    }
  }

  load();
  return { reload: load };
}
