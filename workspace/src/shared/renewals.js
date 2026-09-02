/**
 * Renovações de apólice.
 *
 * A pipeline de apólices desta conta usa os DOZE MESES como estágios —
 * ela já é um calendário de renovação, só não estava sendo lida como um.
 * Este módulo faz essa leitura: de que mês é a apólice, quanto falta, e
 * há quanto tempo ninguém a toca.
 *
 * Não usamos o campo "Contact Next Policy Anniversary": ele está
 * preenchido em 1 de 300 contatos. O estágio está em 100% delas, porque
 * é onde a apólice precisa estar para existir na pipeline.
 */

const MESES = [
  ["january", "janeiro", "jan"], ["february", "fevereiro", "fev"],
  ["march", "março", "marco", "mar"], ["april", "abril", "abr"],
  ["may", "maio", "mai"], ["june", "junho", "jun"],
  ["july", "julho", "jul"], ["august", "agosto", "ago"],
  ["september", "setembro", "set"], ["october", "outubro", "out"],
  ["november", "novembro", "nov"], ["december", "dezembro", "dez"],
];

const NOME_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const RE_DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

const normal = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(RE_DIACRITICOS, "").trim();

/** O mês (0–11) que o nome do estágio representa, ou null. */
export function mesDoEstagio(nome) {
  const alvo = normal(nome);
  if (!alvo) return null;
  for (let i = 0; i < MESES.length; i += 1) {
    if (MESES[i].some((forma) => alvo === forma || alvo.startsWith(`${forma} `))) return i;
  }
  return null;
}

export function nomeDoMes(indice) {
  return NOME_PT[indice] ?? "";
}

/**
 * Estágios que descrevem o ESTADO da renovação, e a urgência de cada um.
 *
 * A pipeline de apólices nem sempre é um calendário. Uma conta marca o
 * mês em que cada apólice vence; outra marca em que ponto da renovação
 * ela está — "Renovação Próxima", "Em Renovação", "Renovada". As duas
 * respondem à mesma pergunta, e a tela serve as duas.
 *
 * A ordem aqui é a ordem de urgência na tela, não a do funil.
 */
const ESTADOS = [
  { id: "vencendo",  tom: "danger",  match: /pr[oó]xim|vencend|a vencer|expiring|due|upcoming/i },
  { id: "andamento", tom: "warn",    match: /em renova|renovando|in renewal|processing/i },
  { id: "pendencia", tom: "info",    match: /pendent|auditoria|revis|pending|audit|review/i },
  { id: "ativa",     tom: "neutral", match: /ativ|vigente|active|current/i },
  { id: "concluida", tom: "done",    match: /renovad|renewed|conclu[ií]|complete/i },
  { id: "encerrada", tom: "done",    match: /cancel|perdid|lost|churn|encerrad/i },
];

/** O estado que um nome de estágio descreve, ou null. */
export function estadoDoEstagio(nome) {
  const alvo = String(nome || "");
  if (!alvo.trim()) return null;
  return ESTADOS.find((e) => e.match.test(alvo)) || null;
}

/**
 * Como esta pipeline fala de renovação: por mês, por estado, ou nem uma
 * coisa nem outra.
 *
 * Meses primeiro: uma pipeline de doze meses é inequívoca. Estados
 * exigem que a renovação seja mesmo o assunto — pelo menos um estágio
 * falando de renovar, e a maioria deles reconhecível — senão qualquer
 * funil com um "Ativo" e um "Cancelado" viraria tela de renovação.
 */
export function modoDaPipeline(pipeline) {
  const stages = pipeline?.stages || [];
  if (stages.length >= 6) {
    const meses = stages.filter((s) => mesDoEstagio(s.name) !== null).length;
    if (meses >= stages.length * 0.7) return "meses";
  }
  if (stages.length < 3) return null;
  const estados = stages.map((s) => estadoDoEstagio(s.name));
  const reconhecidos = estados.filter(Boolean);
  const falaDeRenovar = estados.some((e) => e && (e.id === "vencendo"
    || e.id === "andamento" || e.id === "concluida"));
  if (falaDeRenovar && reconhecidos.length >= stages.length * 0.7) return "estados";
  return null;
}

/** A pipeline responde "quando cada apólice renova?" de algum jeito. */
export function ehPipelineDeRenovacao(pipeline) {
  return modoDaPipeline(pipeline) !== null;
}

/** Dias desde a última mudança de estágio. Null quando o CRM não informa. */
export function diasParado(opp, agora = new Date()) {
  const quando = opp?.lastStageChangeAt || opp?.updatedAt;
  if (!quando) return null;
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((agora - d) / 86400000));
}

/**
 * Quantos meses faltam para o aniversário, de 0 (este mês) a 11.
 *
 * Sempre para a FRENTE: uma apólice de março, vista em setembro, renova
 * em março do ano que vem — faltam 6 meses, não passaram 6. O que já
 * passou neste ano volta como "vence daqui a muito", e é por isso que a
 * régua de atraso é o tempo parado, não o mês.
 */
export function mesesAte(mesDaApolice, agora = new Date()) {
  if (mesDaApolice === null || mesDaApolice === undefined) return null;
  return (mesDaApolice - agora.getMonth() + 12) % 12;
}

export const FAIXAS = [
  { id: "mes", nome: "Renova este mês", tom: "danger" },
  { id: "proximo", nome: "Próximo mês", tom: "warn" },
  { id: "trimestre", nome: "Nos próximos 3 meses", tom: "info" },
  { id: "parada", nome: "Parada há muito tempo", tom: "warn" },
  { id: "depois", nome: "Mais adiante", tom: "neutral" },
];

/** Dias no estágio a partir dos quais a apólice conta como esquecida. */
export const LIMITE_PARADA = 90;

/**
 * A faixa de urgência de uma apólice.
 *
 * "Parada" vem antes de "mais adiante" de propósito: uma apólice de
 * dezembro vista em janeiro tem 11 meses pela frente, mas se ninguém a
 * toca há quatro meses, o problema é agora — o mês diz quando renova, o
 * tempo parado diz se alguém está cuidando.
 */
export function faixaDaApolice({ mes, dias }, agora = new Date()) {
  const falta = mesesAte(mes, agora);
  if (falta === 0) return "mes";
  if (falta === 1) return "proximo";
  if (falta !== null && falta <= 3) return "trimestre";
  if (dias !== null && dias >= LIMITE_PARADA) return "parada";
  return "depois";
}

/**
 * Organiza as apólices em faixas, na ordem de urgência.
 * Cada uma é `{ record, mes, dias, faixa }` — o registro entra inteiro
 * para a tela não ter que cruzar listas.
 */
export function organizarRenovacoes(records = [], { agora = new Date() } = {}) {
  const analisadas = records.map((record) => {
    const mes = mesDoEstagio(record.properties?.stage);
    // `dias` pode vir pronto (o servidor já calculou) ou sair da data
    // que o CRM manda junto do registro. Sem nenhuma das duas, é null e
    // a apólice cai na faixa pelo mês, sem inventar atraso.
    const dias = record.diasParado ?? diasParado(record, agora);
    return { record, mes, dias, faixa: faixaDaApolice({ mes, dias }, agora) };
  });

  const grupos = FAIXAS.map((faixa) => ({
    ...faixa,
    itens: analisadas
      .filter((a) => a.faixa === faixa.id)
      // Dentro da faixa, primeiro o que está parado há mais tempo: é a
      // ordem em que vale a pena ligar.
      .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)),
  })).filter((g) => g.itens.length);

  return { grupos, total: analisadas.length };
}


/**
 * Organiza as apólices de uma pipeline de ESTADO.
 *
 * Aqui a faixa é o próprio estágio — ele já diz o que falta fazer. O que
 * a tela acrescenta é a ordem entre eles (o que vence antes do que está
 * só ativo) e, dentro de cada um, quem está parado há mais tempo. Numa
 * pipeline de estado o tempo parado é o sinal mais forte que existe:
 * "Em Renovação há 45 dias" é uma renovação que travou.
 */
export function organizarPorEstado(records = [], pipeline = null, { agora = new Date() } = {}) {
  const ordemDoEstagio = new Map(
    (pipeline?.stages || []).map((s, i) => [s.name, i]),
  );

  const analisadas = records.map((record) => {
    const estagio = record.properties?.stage || "";
    return {
      record,
      mes: null,
      estagio,
      estado: estadoDoEstagio(estagio),
      dias: record.diasParado ?? diasParado(record, agora),
    };
  });

  // Um grupo por estágio existente, na ordem de urgência do estado; entre
  // estágios do mesmo estado, a ordem da própria pipeline.
  const porEstagio = new Map();
  for (const a of analisadas) {
    if (!porEstagio.has(a.estagio)) porEstagio.set(a.estagio, []);
    porEstagio.get(a.estagio).push(a);
  }

  const grupos = [...porEstagio.entries()]
    .map(([estagio, itens]) => {
      const estado = estadoDoEstagio(estagio);
      return {
        id: `estagio:${estagio}`,
        nome: estagio || "Sem estágio",
        tom: estado?.tom || "neutral",
        urgencia: estado ? ESTADOS.findIndex((e) => e.id === estado.id) : ESTADOS.length,
        ordem: ordemDoEstagio.get(estagio) ?? Number.MAX_SAFE_INTEGER,
        itens: itens.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)),
      };
    })
    .sort((a, b) => a.urgencia - b.urgencia || a.ordem - b.ordem);

  return { grupos, total: analisadas.length };
}
