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


/**
 * Estados de um documento no checklist, na ordem em que avançam. Um
 * clique empurra para o próximo; o último volta ao começo (para desfazer
 * um engano). Ausência = pendente.
 */
export const ESTADOS_DOC = [
  { id: "pendente",  nome: "Pendente",  cor: "gray" },
  { id: "recebido",  nome: "Recebido",  cor: "blue" },
  { id: "enviado",   nome: "Enviado",   cor: "orange" },
  { id: "devolvido", nome: "Devolvido", cor: "green" },
];

const ORDEM = ESTADOS_DOC.map((e) => e.id);

export function proximoEstadoDoc(id) {
  const i = ORDEM.indexOf(id);
  return ORDEM[(i + 1) % ORDEM.length];
}

export function estadoDoc(id) {
  return ESTADOS_DOC.find((e) => e.id === id) || ESTADOS_DOC[0];
}

export function estadoDocValido(id) {
  return ORDEM.includes(id);
}
