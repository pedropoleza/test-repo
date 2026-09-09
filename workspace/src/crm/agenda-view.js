/**
 * Agenda operacional.
 *
 * O planejador da semana do escritório, juntando o que hoje vive em três
 * telas: renovações que vencem, tarefas com prazo e casos parados no
 * Aguardando. Não é um calendário de agendamentos — é "o que preciso
 * entregar e cobrar esta semana, e o que está travado agora".
 *
 * Três blocos: Atrasados (o que já venceu e continua aberto), Parados
 * agora (casos esperando cliente ou terceiro, sem data) e A semana (os
 * sete dias, com renovação e tarefa em cada dia).
 */
import { api } from "../api.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";
import { vencimentosDosContatos } from "../shared/upcoming.js";
import { organizarAguardando } from "../shared/waiting.js";
import {
  montarAgenda, chaveDia, rotuloSemana, inicioDaSemana,
  semanaAnterior, semanaSeguinte,
} from "../shared/agenda.js";

export function createAgendaView(host, { onOpenPage } = {}) {
  let recorrentes = [];
  let contatos = [];
  let oportunidades = [];
  let tarefas = [];
  let carregou = false;
  let inicio = inicioDaSemana();   // segunda-feira da semana ativa

  async function load() {
    host.replaceChildren(renderLoader("Montando a agenda da semana…"));
    try {
      // Quatro fontes em paralelo: catálogo + contatos dão as renovações,
      // oportunidades dão os parados, e as tarefas dão os prazos. Tarefas
      // pode falhar (conta sem Spark Tasks) sem derrubar a agenda.
      const [cat, cont, opp, tk] = await Promise.all([
        api.crm.catalog(),
        api.crm.contacts(300),
        api.crm.opportunities(300),
        api.tasks.list(300).catch(() => ({ records: [] })),
      ]);
      recorrentes = cat.recorrentes || [];
      contatos = cont.records || [];
      oportunidades = opp.records || [];
      tarefas = tk.records || [];
      carregou = true;
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
      : "Não foi possível montar a agenda";
    const p = document.createElement("p");
    p.textContent = "O serviço de dados não respondeu. Nada foi alterado.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "ws-btn"; retry.textContent = "Tentar de novo";
    retry.addEventListener("click", load);
    box.append(h, p, retry);
    return box;
  }

  /* ---------------- normalização das fontes ---------------- */

  function datados() {
    const out = [];
    for (const v of vencimentosDosContatos(contatos, recorrentes)) {
      out.push({
        tipo: "renovacao",
        iso: chaveDia(v.data),
        titulo: v.nome,
        detalhe: v.servico.nome,
        icone: v.servico.icone,
        contactId: v.contactId,
      });
    }
    for (const t of tarefas) {
      if ((t.properties?.status || "open") !== "open") continue;   // só as abertas
      const iso = chaveDia(t.properties?.due_date);
      if (!iso) continue;                                          // só as com prazo
      out.push({
        tipo: "tarefa",
        iso,
        titulo: t.title,
        detalhe: t.properties?.assignee || "",
        icone: "✓",
        contactId: t.contactId,
        url: t.properties?.url || "",
      });
    }
    return out;
  }

  function parados() {
    const { grupos } = organizarAguardando(oportunidades);
    const out = [];
    for (const g of grupos) {
      for (const it of g.itens) {
        out.push({
          titulo: it.record.properties?.contact || it.record.title || "Sem nome",
          detalhe: g.nome,
          tipo: g.tipo,               // "cliente" | "terceiro"
          dias: it.dias,
          contactId: it.record.contactId,
        });
      }
    }
    return out;
  }

  /* ---------------- render ---------------- */

  function render() {
    host.replaceChildren();
    host.className = "ws-agenda";

    host.appendChild(renderBarra());

    const agenda = montarAgenda({ datados: datados(), parados: parados(), inicioSemana: inicio });

    const nada = !agenda.totalAtrasados && !agenda.totalParados && !agenda.totalSemana;
    if (carregou && nada && !recorrentes.length && !tarefas.length && !oportunidades.length) {
      host.appendChild(vazioGeral());
      return;
    }

    if (agenda.atrasados.length) host.appendChild(blocoAtrasados(agenda.atrasados));
    if (agenda.parados.length) host.appendChild(blocoParados(agenda.parados));
    host.appendChild(blocoSemana(agenda.dias, agenda.totalSemana));
  }

  function vazioGeral() {
    const box = document.createElement("div");
    box.className = "ws-error";
    const h = document.createElement("h2");
    h.textContent = "Nada na agenda ainda";
    const p = document.createElement("p");
    p.textContent = "A agenda junta renovações, tarefas com prazo e casos parados. "
      + "Conforme esses dados entram na conta, eles aparecem aqui.";
    box.append(h, p);
    return box;
  }

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-agenda__bar";

    const nav = document.createElement("div");
    nav.className = "ws-agenda__nav";
    nav.append(
      botaoNav("‹", "Semana anterior", () => { inicio = semanaAnterior(inicio); render(); }),
    );
    const rotulo = document.createElement("h2");
    rotulo.className = "ws-agenda__week";
    rotulo.textContent = rotuloSemana(inicio);
    nav.appendChild(rotulo);
    nav.append(
      botaoNav("›", "Próxima semana", () => { inicio = semanaSeguinte(inicio); render(); }),
    );
    const hoje = document.createElement("button");
    hoje.type = "button";
    hoje.className = "ws-btn ws-btn--ghost ws-agenda__today";
    hoje.textContent = "Esta semana";
    hoje.addEventListener("click", () => { inicio = inicioDaSemana(); render(); });
    nav.appendChild(hoje);
    barra.appendChild(nav);

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
    b.className = "ws-agenda__arrow";
    b.textContent = rotulo;
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------------- blocos ---------------- */

  function bloco(nome, tom, conta) {
    const sec = document.createElement("section");
    sec.className = "ws-agenda__block";
    if (tom) sec.dataset.tom = tom;
    const head = document.createElement("header");
    head.className = "ws-agenda__block-head";
    const h = document.createElement("h3");
    h.textContent = nome;
    const c = document.createElement("span");
    c.className = "ws-agenda__count";
    c.textContent = conta;
    head.append(h, c);
    sec.appendChild(head);
    return sec;
  }

  function blocoAtrasados(itens) {
    const sec = bloco("Atrasados", "danger", itens.length);
    const lista = document.createElement("div");
    lista.className = "ws-agenda__list";
    for (const item of itens) lista.appendChild(linhaDatada(item, "vencido"));
    sec.appendChild(lista);
    return sec;
  }

  function blocoParados(itens) {
    const sec = bloco("Parados agora", "warn", itens.length);
    const nota = document.createElement("p");
    nota.className = "ws-agenda__note ws-muted";
    nota.textContent = "Casos esperando o cliente ou um terceiro. Sem data — ficam aqui até destravar.";
    sec.appendChild(nota);
    const lista = document.createElement("div");
    lista.className = "ws-agenda__list";
    for (const item of itens) lista.appendChild(linhaParada(item));
    sec.appendChild(lista);
    return sec;
  }

  function blocoSemana(dias, total) {
    const sec = bloco("A semana", null, total);
    const grade = document.createElement("div");
    grade.className = "ws-agenda__week-grid";
    for (const dia of dias) grade.appendChild(renderDia(dia));
    sec.appendChild(grade);
    return sec;
  }

  function renderDia(dia) {
    const col = document.createElement("div");
    col.className = "ws-agenda__day";
    col.dataset.fds = dia.fimDeSemana ? "sim" : "nao";
    if (dia.hoje) col.dataset.hoje = "sim";

    const cab = document.createElement("div");
    cab.className = "ws-agenda__day-head";
    cab.textContent = dia.rotulo;
    col.appendChild(cab);

    if (dia.itens.length) {
      const lista = document.createElement("div");
      lista.className = "ws-agenda__day-items";
      for (const item of dia.itens) lista.appendChild(linhaDatada(item, "ok"));
      col.appendChild(lista);
    } else {
      const vazio = document.createElement("span");
      vazio.className = "ws-agenda__day-empty";
      vazio.textContent = "—";
      col.appendChild(vazio);
    }
    return col;
  }

  function linhaDatada(item, tom) {
    const linha = document.createElement("button");
    linha.type = "button";
    linha.className = "ws-agenda__item";
    linha.dataset.tipo = item.tipo;
    linha.dataset.tom = tom;
    linha.title = `${item.detalhe ? item.detalhe + " · " : ""}${item.titulo}`;
    const ic = document.createElement("span");
    ic.className = "ws-agenda__item-ic";
    ic.textContent = item.icone || "•";
    const corpo = document.createElement("span");
    corpo.className = "ws-agenda__item-body";
    const t = document.createElement("span");
    t.className = "ws-agenda__item-title";
    t.textContent = item.titulo;
    corpo.appendChild(t);
    if (item.detalhe) {
      const d = document.createElement("span");
      d.className = "ws-agenda__item-sub";
      d.textContent = item.detalhe;
      corpo.appendChild(d);
    }
    linha.append(ic, corpo);
    if (item.contactId) {
      linha.addEventListener("click", () => abrirFicha(item.contactId, linha));
    } else if (item.url) {
      linha.addEventListener("click", () => window.open(item.url, "_blank", "noopener"));
    } else {
      linha.disabled = true;
    }
    return linha;
  }

  function linhaParada(item) {
    const linha = document.createElement("button");
    linha.type = "button";
    linha.className = "ws-agenda__item";
    linha.dataset.tipo = "parado";
    linha.dataset.espera = item.tipo;   // cliente | terceiro
    const ic = document.createElement("span");
    ic.className = "ws-agenda__item-ic";
    ic.textContent = item.tipo === "terceiro" ? "🏛️" : "📄";
    const corpo = document.createElement("span");
    corpo.className = "ws-agenda__item-body";
    const t = document.createElement("span");
    t.className = "ws-agenda__item-title";
    t.textContent = item.titulo;
    const d = document.createElement("span");
    d.className = "ws-agenda__item-sub";
    d.textContent = item.detalhe;
    corpo.append(t, d);
    const prazo = document.createElement("span");
    prazo.className = "ws-agenda__parado-dias";
    prazo.textContent = textoParado(item.dias);
    linha.append(ic, corpo, prazo);
    if (item.contactId) {
      linha.addEventListener("click", () => abrirFicha(item.contactId, linha));
    } else {
      linha.disabled = true;
    }
    return linha;
  }

  function textoParado(dias) {
    if (dias === null || dias === undefined) return "";
    if (dias <= 0) return "hoje";
    return `${dias} ${dias === 1 ? "dia" : "dias"}`;
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
