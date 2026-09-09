/**
 * Relatórios por serviço.
 *
 * O retrato da operação em números: por serviço, quanto entrou, quantos
 * casos estão abertos, quantos fecharam, o ticket médio e há quanto tempo
 * os abertos estão parados. Uma leitura de gestão sobre as mesmas
 * oportunidades que a tabela e o quadro mostram caso a caso.
 */
import { api } from "../api.js";
import { renderLoader } from "../ui/loader.js";
import { agregarPorServico } from "../shared/reports.js";

export function createReportsView(host) {
  let registros = [];
  let pipelines = [];

  async function load() {
    host.replaceChildren(renderLoader("Somando os números…"));
    try {
      const dados = await api.crm.opportunities(300);
      registros = dados.records || [];
      pipelines = dados.pipelines || [];
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
      : "Não foi possível montar os relatórios";
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
    host.className = "ws-reports";

    const { linhas, totais } = agregarPorServico(registros, pipelines);

    if (!totais.total) {
      const vazio = document.createElement("div");
      vazio.className = "ws-db__empty";
      vazio.textContent = "Nenhuma oportunidade para relatar ainda.";
      host.appendChild(vazio);
      return;
    }

    host.appendChild(renderBarra());
    host.appendChild(renderResumo(totais));
    host.appendChild(renderTabela(linhas));

    const rodape = document.createElement("p");
    rodape.className = "ws-muted ws-reports__foot";
    rodape.textContent = `${totais.total} oportunidades em ${linhas.length} `
      + `${linhas.length === 1 ? "serviço" : "serviços"}.`;
    host.appendChild(rodape);
  }

  function renderBarra() {
    const barra = document.createElement("div");
    barra.className = "ws-reports__bar";
    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.className = "ws-btn ws-btn--ghost";
    atualizar.textContent = "Atualizar";
    atualizar.addEventListener("click", load);
    barra.appendChild(atualizar);
    return barra;
  }

  function renderResumo(t) {
    const grade = document.createElement("div");
    grade.className = "ws-reports__kpis";
    grade.append(
      kpi("Faturamento", dinheiro(t.faturamento), "É a soma do valor das oportunidades ganhas."),
      kpi("Casos abertos", String(t.abertos)),
      kpi("Ganhos", String(t.ganhos)),
      kpi("Taxa de ganho", t.taxaGanho == null ? "—" : `${t.taxaGanho}%`,
        "Ganhos sobre o que já foi decidido (ganhos + perdidos)."),
    );
    return grade;
  }

  function kpi(rotulo, valor, dica) {
    const box = document.createElement("div");
    box.className = "ws-reports__kpi";
    if (dica) box.title = dica;
    const v = document.createElement("div");
    v.className = "ws-reports__kpi-val";
    v.textContent = valor;
    const r = document.createElement("div");
    r.className = "ws-reports__kpi-lbl";
    r.textContent = rotulo;
    box.append(v, r);
    return box;
  }

  function renderTabela(linhas) {
    const tabela = document.createElement("table");
    tabela.className = "ws-reports__table";
    const cab = ["Serviço", "Abertos", "Ganhos", "Perdidos", "Faturamento", "Ticket médio", "Tempo médio aberto", "Taxa ganho"];
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    cab.forEach((c, i) => {
      const th = document.createElement("th");
      th.textContent = c;
      if (i > 0) th.className = "num";
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tabela.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const l of linhas) {
      const tr = document.createElement("tr");
      const nome = document.createElement("td");
      nome.className = "ws-reports__svc";
      nome.textContent = l.nome;
      tr.appendChild(nome);
      cel(tr, l.abertos);
      cel(tr, l.ganhos);
      cel(tr, l.perdidos);
      cel(tr, dinheiro(l.faturamento));
      cel(tr, l.ticketMedio ? dinheiro(l.ticketMedio) : "—");
      cel(tr, l.abertos ? `${l.tempoMedioAberto} d` : "—");
      cel(tr, l.taxaGanho == null ? "—" : `${l.taxaGanho}%`);
      tbody.appendChild(tr);
    }
    tabela.appendChild(tbody);

    const scroll = document.createElement("div");
    scroll.className = "ws-reports__scroll";
    scroll.appendChild(tabela);
    return scroll;
  }

  function cel(tr, texto) {
    const td = document.createElement("td");
    td.className = "num";
    td.textContent = texto;
    tr.appendChild(td);
  }

  function dinheiro(n) {
    return (Number(n) || 0).toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
  }

  load();
  return { reload: load };
}
