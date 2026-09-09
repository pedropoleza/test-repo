/**
 * Painel operacional "Aguardando".
 *
 * O negócio dela trava sempre no mesmo lugar: esperando o cliente trazer
 * um documento, ou esperando um terceiro (consulado, DMV, corte, carrier,
 * advogado) responder. Toda pipeline de serviço tem esses estágios. Aqui
 * eles viram uma tela só — o que está parado agora, e há quanto tempo.
 *
 * Diferente do radar de vencimentos, que olha o futuro: este olha o
 * presente. É "parar de perder caso no meio do caminho", que é como o
 * plano da conta descreve a dor.
 */
import { diasParado } from "./renewals.js";

/**
 * Os estágios de espera e quem trava cada um, na ordem de atenção. A
 * espera pelo cliente vem primeiro: é a que ela consegue destravar com um
 * telefonema; a do terceiro depende de fora.
 */
export const ESPERAS = [
  {
    id: "documentos", tipo: "cliente",
    nome: "Aguardando documentos do cliente",
    match: new RegExp("waiting documents|aguardando documento", "i"),
  },
  {
    id: "retirada", tipo: "cliente",
    nome: "Pronto — aguardando retirada",
    match: new RegExp("ready for delivery|pronto para entrega|aguardando retirada", "i"),
  },
  {
    id: "terceiro", tipo: "terceiro",
    nome: "Aguardando terceiro (consulado, DMV, corte…)",
    match: new RegExp("waiting third party|aguardando terceiro", "i"),
  },
];

/** A espera que um nome de estágio representa, ou null se não é espera. */
export function esperaDoEstagio(nome) {
  const alvo = String(nome || "");
  if (!alvo.trim()) return null;
  return ESPERAS.find((e) => e.match.test(alvo)) || null;
}

/**
 * Organiza os casos parados em faixas de espera.
 *
 * Só entram os que estão num estágio de espera; cada um vira
 * `{ record, espera, dias }`, e dentro da faixa o mais parado vem
 * primeiro — é a ordem em que vale a pena agir. Faixa sem caso não
 * aparece.
 */
export function organizarAguardando(records = [], { agora = new Date() } = {}) {
  const parados = [];
  for (const record of records) {
    const espera = esperaDoEstagio(record.properties?.stage);
    if (!espera) continue;
    parados.push({ record, espera, dias: record.diasParado ?? diasParado(record, agora) });
  }

  const grupos = ESPERAS.map((espera) => ({
    id: espera.id,
    nome: espera.nome,
    tipo: espera.tipo,
    itens: parados
      .filter((p) => p.espera.id === espera.id)
      .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)),
  })).filter((g) => g.itens.length);

  return { grupos, total: parados.length };
}
