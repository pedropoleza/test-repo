/**
 * Relatórios por serviço.
 *
 * Cruza as oportunidades (cada uma é um caso de um serviço) por pipeline
 * e resume o que importa para a gestão: quanto entrou, quantos casos
 * estão abertos, quantos fecharam, o ticket médio e há quanto tempo os
 * abertos estão parados. Tudo deduzido do que o CRM já tem — nada de
 * relatório que pede um segundo cadastro.
 *
 * Puro e testável: recebe registros e pipelines, devolve linhas + totais.
 */
import { diasDesde } from "./computed.js";

/**
 * Agrega as oportunidades por serviço (pipeline).
 *
 * Devolve `{ linhas, totais }`. Cada linha traz abertos/ganhos/perdidos,
 * faturamento (soma dos ganhos), ticket médio, taxa de ganho e o tempo
 * médio que os casos abertos estão de pé. Ordenado por faturamento.
 */
export function agregarPorServico(records = [], pipelines = [], agora = new Date()) {
  const nomeDe = new Map(pipelines.map((p) => [p.id, p.name]));
  const mapa = new Map();

  for (const r of records) {
    const pid = r.pipelineId || "__sem__";
    if (!mapa.has(pid)) {
      mapa.set(pid, {
        pipelineId: pid,
        nome: nomeDe.get(pid) || r.properties?.pipeline || "Sem pipeline",
        total: 0, abertos: 0, ganhos: 0, perdidos: 0, faturamento: 0, somaIdade: 0,
      });
    }
    const a = mapa.get(pid);
    a.total += 1;
    const status = r.properties?.status || "open";
    const valor = Number(r.properties?.value) || 0;
    if (status === "won") {
      a.ganhos += 1;
      a.faturamento += valor;
    } else if (status === "lost" || status === "abandoned") {
      a.perdidos += 1;
    } else {
      a.abertos += 1;
      const d = diasDesde(r.properties?.created_at, agora);
      if (d != null) a.somaIdade += d;
    }
  }

  const linhas = [...mapa.values()].map((a) => ({
    pipelineId: a.pipelineId,
    nome: a.nome,
    total: a.total,
    abertos: a.abertos,
    ganhos: a.ganhos,
    perdidos: a.perdidos,
    faturamento: a.faturamento,
    ticketMedio: a.ganhos ? Math.round(a.faturamento / a.ganhos) : 0,
    tempoMedioAberto: a.abertos ? Math.round(a.somaIdade / a.abertos) : 0,
    // Taxa de ganho só sobre o que foi decidido (ganho+perdido); null
    // enquanto nada fechou, para não mostrar 0% que assusta sem razão.
    taxaGanho: (a.ganhos + a.perdidos) ? Math.round((100 * a.ganhos) / (a.ganhos + a.perdidos)) : null,
  })).sort((x, y) => y.faturamento - x.faturamento || y.total - x.total);

  const totais = linhas.reduce((t, l) => ({
    total: t.total + l.total,
    abertos: t.abertos + l.abertos,
    ganhos: t.ganhos + l.ganhos,
    perdidos: t.perdidos + l.perdidos,
    faturamento: t.faturamento + l.faturamento,
  }), { total: 0, abertos: 0, ganhos: 0, perdidos: 0, faturamento: 0 });
  totais.taxaGanho = (totais.ganhos + totais.perdidos)
    ? Math.round((100 * totais.ganhos) / (totais.ganhos + totais.perdidos))
    : null;

  return { linhas, totais };
}
