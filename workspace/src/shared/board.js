/**
 * Vista de quadro (Kanban) das oportunidades.
 *
 * A tabela responde "quem está em cada estágio" em linhas; o quadro
 * responde a mesma coisa em colunas, e deixa arrastar de uma para a
 * outra — que é como se pensa um funil. É a "board view" do Notion sobre
 * as oportunidades do CRM.
 *
 * Um quadro é de UMA pipeline: as colunas são os estágios dela, na ordem.
 * Misturar pipelines faria uma coluna "Ganhou" pertencer a duas, e soltar
 * um card nela seria ambíguo. Por isso o quadro escolhe uma pipeline (a
 * com mais oportunidades, por padrão) e a tela oferece as outras.
 */

/** Quantas oportunidades cada pipeline tem, da maior para a menor. */
export function contagemPorPipeline(records = [], pipelines = []) {
  const conta = new Map();
  for (const r of records) {
    if (!r.pipelineId) continue;
    conta.set(r.pipelineId, (conta.get(r.pipelineId) || 0) + 1);
  }
  return pipelines
    .map((p) => ({ id: p.id, name: p.name, total: conta.get(p.id) || 0 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * A pipeline que o quadro mostra: a escolhida (se ainda existe e tem
 * card), senão a de mais oportunidades, senão a primeira. Null se não há
 * pipeline nenhuma.
 */
export function pipelineDoQuadro(records = [], pipelines = [], escolhidaId = null) {
  if (!pipelines.length) return null;
  if (escolhidaId) {
    const p = pipelines.find((x) => x.id === escolhidaId);
    if (p) return p;
  }
  const [maior] = contagemPorPipeline(records, pipelines);
  if (maior?.total) return pipelines.find((p) => p.id === maior.id) || pipelines[0];
  return pipelines[0];
}

/**
 * As colunas do quadro para uma pipeline: um estágio por coluna, na ordem
 * da pipeline, cada uma com os cards (as oportunidades) que estão nela.
 *
 * Só entram cards DAQUELA pipeline. Card da pipeline sem estágio casado
 * (estágio removido, por exemplo) cai numa coluna final "Sem estágio",
 * para não sumir da tela — mas ela só aparece se tiver alguém.
 */
export function colunasDoQuadro(pipeline, records = []) {
  if (!pipeline) return [];
  const daPipeline = records.filter((r) => r.pipelineId === pipeline.id);
  const stages = pipeline.stages || [];
  const conhecidos = new Set(stages.map((s) => s.id));

  const colunas = stages.map((s) => ({
    stageId: s.id,
    nome: s.name,
    cards: daPipeline.filter((r) => r.stageId === s.id),
  }));

  const orfaos = daPipeline.filter((r) => !conhecidos.has(r.stageId));
  if (orfaos.length) {
    colunas.push({ stageId: null, nome: "Sem estágio", cards: orfaos, orfa: true });
  }
  return colunas;
}

/** Soma dos valores (monetaryValue) dos cards de uma coluna. */
export function totalDaColuna(cards = []) {
  return cards.reduce((soma, r) => soma + (Number(r.properties?.value) || 0), 0);
}
