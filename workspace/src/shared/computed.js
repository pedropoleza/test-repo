/**
 * Colunas calculadas (rollup/fórmula, à la Notion).
 *
 * Algumas colunas não vêm do CRM: são deduzidas do que já está lá. "Há
 * quantos dias esta oportunidade não sai do estágio?" é o sinal de
 * abandono da operação; "que idade tem este caso?" ajuda a priorizar.
 * Aqui elas viram colunas de verdade — ordenáveis, filtráveis, agrupáveis
 * — sem pedir nada a mais ao CRM.
 *
 * Puro e testável: `aplicarCalculados` injeta os valores nas properties do
 * registro, e `colunasCalculadas` descreve as colunas para a tabela. São
 * só de leitura — ninguém edita uma fórmula digitando na célula.
 */

/** Dias (de calendário, UTC) desde uma data até agora. Nunca negativo; null se sem data. */
export function diasDesde(iso, agora = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const umDia = 86400000;
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((hoje - alvo) / umDia));
}

function coluna(key, name) {
  return {
    key, name, type: "number",
    is_primary: false, config: {}, source: "computed", readOnly: true,
  };
}

/** As colunas calculadas de cada tipo de tabela. */
export function colunasCalculadas(kind) {
  if (kind === "opportunities") {
    return [coluna("calc_dias_estagio", "Dias no estágio"), coluna("calc_idade", "Idade (dias)")];
  }
  if (kind === "contacts") {
    return [coluna("calc_idade", "Idade (dias)")];
  }
  return [];
}

/**
 * Devolve os registros com os valores calculados nas properties.
 *
 * Não muda o original (cópia rasa das properties). Registro sem a data de
 * base fica com a coluna vazia (null) em vez de zero — "não sei" não é
 * "hoje".
 */
export function aplicarCalculados(records = [], kind, agora = new Date()) {
  if (kind !== "opportunities" && kind !== "contacts") return records;
  return records.map((r) => {
    const extra = {};
    if (kind === "opportunities") {
      extra.calc_dias_estagio = diasDesde(r.lastStageChangeAt, agora);
      extra.calc_idade = diasDesde(r.properties?.created_at, agora);
    } else {
      extra.calc_idade = diasDesde(r.properties?.created_at, agora);
    }
    return { ...r, properties: { ...r.properties, ...extra } };
  });
}
