/**
 * Radar de vencimentos.
 *
 * Os serviços recorrentes são "o motor da receita": registration, annual
 * report, licença, PO Box, apólice — cada um renova todo ano e hoje
 * depende de alguém lembrar. Cada um tem um campo de DATA no contato; o
 * radar lê essas datas e diz o que vence, por urgência.
 *
 * A régua é o tempo até o vencimento, não o mês: "vence em 12 dias"
 * pesa mais que "vence em maio". O que já venceu vem primeiro de todos —
 * é dinheiro na mesa ou cliente prestes a ficar irregular.
 */

/** Dias do hoje até a data. Negativo = já venceu. Null = sem data. */
export function diasAte(dataISO, agora = new Date()) {
  if (!dataISO) return null;
  const d = new Date(dataISO);
  if (Number.isNaN(d.getTime())) return null;
  // Compara em dias de calendário (UTC), sem a hora atrapalhar.
  const umDia = 86400000;
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((alvo - hoje) / umDia);
}

/**
 * As faixas de urgência, na ordem em que aparecem na tela. A janela de
 * atenção dela é ~60 dias (é quando a tag de renovação entra); 90 fecha
 * o trimestre, e o resto fica recolhido.
 */
export const FAIXAS = [
  { id: "vencido",  nome: "Vencido",              tom: "danger" },
  { id: "mes",      nome: "Vence em 30 dias",     tom: "danger" },
  { id: "sessenta", nome: "31 a 60 dias",         tom: "warn" },
  { id: "noventa",  nome: "61 a 90 dias",         tom: "info" },
  { id: "depois",   nome: "Mais adiante",         tom: "neutral" },
];

export function faixaVencimento(dias) {
  if (dias === null || dias === undefined) return null;
  if (dias < 0) return "vencido";
  if (dias <= 30) return "mes";
  if (dias <= 60) return "sessenta";
  if (dias <= 90) return "noventa";
  return "depois";
}

/**
 * Organiza os vencimentos em faixas.
 *
 * `itens` é `{ ...qualquer, dias }` — cada um já com os dias calculados.
 * Dentro da faixa, o mais próximo de vencer primeiro (e, entre vencidos,
 * o que venceu há mais tempo). Faixa sem item não aparece.
 */
export function organizarVencimentos(itens = []) {
  const comFaixa = itens
    .map((it) => ({ ...it, faixa: faixaVencimento(it.dias) }))
    .filter((it) => it.faixa !== null);

  const grupos = FAIXAS.map((faixa) => ({
    ...faixa,
    itens: comFaixa
      .filter((it) => it.faixa === faixa.id)
      .sort((a, b) => a.dias - b.dias),
  })).filter((g) => g.itens.length);

  return { grupos, total: comFaixa.length };
}

/**
 * Extrai os vencimentos de uma lista de contatos, cruzando com os
 * serviços recorrentes do catálogo.
 *
 * Para cada contato, cada serviço recorrente e cada campo de vencimento
 * dele com data preenchida, sai um item `{ contactId, nome, servico,
 * campo, data, dias }`. Um contato pode ter vários (PO Box e apólice, por
 * exemplo) — cada um é uma renovação própria.
 */
export function vencimentosDosContatos(contatos = [], recorrentes = [], agora = new Date()) {
  const itens = [];
  for (const contato of contatos) {
    const props = contato.properties || {};
    for (const servico of recorrentes) {
      for (const campo of servico.vencimentos || []) {
        const data = props[campo.key];
        const dias = diasAte(data, agora);
        if (dias === null) continue;
        itens.push({
          contactId: contato.externalId,
          nome: contato.title || "Sem nome",
          servico: { code: servico.code, nome: servico.nome, icone: servico.icone },
          campo: campo.name,
          data,
          dias,
        });
      }
    }
  }
  return itens;
}

/**
 * O retrato do radar: quanto tem em cada faixa, e como cada serviço
 * contribui.
 *
 * A tela precisava ser lida antes de ser lida item a item — "quão ruim
 * está a semana" é uma pergunta de proporção, não de lista. Daqui saem
 * as duas leituras: o total por faixa de urgência (a régua do topo) e o
 * total por serviço, já quebrado por faixa (qual serviço está puxando o
 * vermelho). O PO Box vencido e o registration vencido são problemas
 * diferentes e cobram de gente diferente.
 *
 * Devolve `{ total, faixas, servicos }`. `faixas` traz TODAS as faixas,
 * inclusive as zeradas — a régua do topo tem que manter as mesmas
 * cinco posições enquanto o filtro muda, senão ela dança embaixo do
 * cursor. `servicos` só traz quem tem item, ordenado pelo mais urgente
 * (vencidos primeiro, depois volume).
 */
export function resumoVencimentos(itens = []) {
  const comFaixa = itens
    .map((it) => ({ ...it, faixa: faixaVencimento(it.dias) }))
    .filter((it) => it.faixa !== null);
  const total = comFaixa.length;

  const faixas = FAIXAS.map((faixa) => {
    const n = comFaixa.filter((it) => it.faixa === faixa.id).length;
    return { ...faixa, total: n, pct: total ? (n / total) * 100 : 0 };
  });

  const porCodigo = new Map();
  for (const it of comFaixa) {
    const code = it.servico?.code || "__sem__";
    if (!porCodigo.has(code)) {
      porCodigo.set(code, {
        code,
        nome: it.servico?.nome || "Sem serviço",
        icone: it.servico?.icone || "",
        total: 0,
        vencidos: 0,
        faixas: Object.fromEntries(FAIXAS.map((f) => [f.id, 0])),
      });
    }
    const linha = porCodigo.get(code);
    linha.total += 1;
    linha.faixas[it.faixa] += 1;
    if (it.faixa === "vencido") linha.vencidos += 1;
  }

  const servicos = [...porCodigo.values()].sort((a, b) =>
    b.vencidos - a.vencidos || b.total - a.total || a.nome.localeCompare(b.nome));

  return { total, faixas, servicos };
}

/**
 * Quanto do caminho até o vencimento já foi andado, de 0 a 1, numa
 * janela de 90 dias.
 *
 * É o que a barrinha do cartão desenha. A janela é 90 porque é o
 * horizonte que o radar cobre: além disso a barra ficaria sempre vazia
 * e não diria nada. Vencido é 1 — a barra cheia, e a cor conta o resto.
 */
export const JANELA_RADAR = 90;

export function progressoDoPrazo(dias, janela = JANELA_RADAR) {
  if (dias === null || dias === undefined) return 0;
  if (dias < 0) return 1;
  if (dias >= janela) return 0;
  return (janela - dias) / janela;
}
