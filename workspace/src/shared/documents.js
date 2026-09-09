/**
 * Categorias de documento na ficha do contato (F2).
 *
 * A dor dela é achar o documento de um cliente no meio de pastas
 * espalhadas. Quatro gavetas cobrem o que ela guarda: o que o cliente
 * mandou, o que o escritório emitiu, os contratos assinados e os recibos.
 * Poucas e claras de propósito — uma taxonomia grande vira campo que
 * ninguém preenche igual.
 */
export const CATEGORIAS = [
  { id: "recebido", nome: "Recebidos do cliente", icone: "📥" },
  { id: "emitido",  nome: "Emitidos pelo escritório", icone: "📤" },
  { id: "contrato", nome: "Contratos assinados", icone: "✍️" },
  { id: "recibo",   nome: "Recibos", icone: "🧾" },
];

const IDS = new Set(CATEGORIAS.map((c) => c.id));

/** Devolve a categoria válida, ou "recebido" como padrão seguro. */
export function normalizarCategoria(id) {
  return IDS.has(id) ? id : "recebido";
}

export function nomeDaCategoria(id) {
  return CATEGORIAS.find((c) => c.id === id)?.nome || "Documento";
}
