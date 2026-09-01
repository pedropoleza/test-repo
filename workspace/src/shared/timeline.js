/**
 * Linha do tempo do contato.
 *
 * A pergunta que ninguém consegue responder hoje é "o que aconteceu com
 * essa pessoa?". A resposta está espalhada: a data de entrada está no
 * contato, o histórico comercial está nas oportunidades, o que foi dito
 * está nas notas, e o que NÓS mexemos está nas revisões da ficha. Quatro
 * lugares, nenhuma ordem comum.
 *
 * Este módulo junta as quatro fontes numa lista só, do mais recente para
 * o mais antigo.
 *
 * Duas decisões vieram de medir os dados desta conta:
 *
 * 1. Notas existem em 2 de 40 contatos e tarefas do CRM em nenhum. Uma
 *    linha do tempo só de notas estaria vazia para 95% das fichas — por
 *    isso a espinha dorsal são as datas do contato e das oportunidades,
 *    que estão em 100%.
 *
 * 2. Numa oportunidade recém-criada, `createdAt`, `lastStageChangeAt` e
 *    `lastStatusChangeAt` são o MESMO instante. Emitir os três daria
 *    "criada / mudou de estágio / mudou de status" no mesmo segundo, que
 *    não é história, é ruído. Só sai o que aconteceu depois da criação.
 */

/** Diferença abaixo da qual duas datas são "o mesmo momento". */
const MESMO_MOMENTO_MS = 60 * 1000;

function ts(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function depoisDe(quando, referencia) {
  const a = ts(quando);
  const b = ts(referencia);
  if (a === null) return false;
  if (b === null) return true;
  return a - b > MESMO_MOMENTO_MS;
}

/** Nome do usuário quando conhecido; nunca o id cru na tela. */
function autor(users, id) {
  if (!id) return "";
  return users?.get?.(id) || users?.[id] || "";
}

/**
 * O texto da nota sem HTML.
 *
 * O CRM devolve `bodyText` já limpo na maioria das notas, mas nem
 * sempre; quando falta, o `body` vem com parágrafos e spans inteiros de
 * estilo. Cortar as tags aqui — e não na tela — é o que garante que o
 * PDF e a ficha mostrem a mesma coisa.
 */
export function textoDaNota(nota) {
  const bruto = nota?.bodyText || nota?.body || "";
  return String(bruto)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function resumir(texto, limite = 180) {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite - 1).trimEnd()}…`;
}

/** O que cada operação de revisão significa em português. */
const OPERACOES = {
  create: "Bloco criado na ficha",
  update: "Bloco editado na ficha",
  delete: "Bloco removido da ficha",
  move: "Bloco movido na ficha",
  page_update: "Ficha alterada",
  page_create: "Ficha criada",
  cover: "Capa trocada",
  icon: "Ícone trocado",
};

/**
 * Monta a linha do tempo.
 *
 * Cada evento é `{ at, tipo, titulo, detalhe, ator }` — `at` em ISO para
 * a tela e o PDF formatarem do jeito de cada um.
 */
export function buildTimeline({
  contact = null,
  opportunities = [],
  notes = [],
  tasks = [],
  revisions = [],
  users = null,
  limit = 60,
} = {}) {
  const eventos = [];
  const add = (at, tipo, titulo, detalhe = "", ator = "") => {
    if (ts(at)) eventos.push({ at: new Date(at).toISOString(), tipo, titulo, detalhe, ator });
  };

  if (contact) {
    add(contact.dateAdded, "contato", "Entrou na base",
      contact.source ? `Origem: ${contact.source}` : "");
    // Só quando é notícia: em contato recém-criado as duas datas são o
    // mesmo instante, e "atualizado" logo abaixo de "entrou" não informa.
    if (depoisDe(contact.dateUpdated, contact.dateAdded)) {
      add(contact.dateUpdated, "contato", "Dados atualizados");
    }
  }

  for (const opp of opportunities) {
    const nome = opp.name || opp.title || "Oportunidade";
    add(opp.createdAt, "oportunidade", `Oportunidade criada: ${nome}`,
      opp.stage ? `Em ${opp.stage}` : "", autor(users, opp.assignedTo));
    if (depoisDe(opp.lastStageChangeAt, opp.createdAt)) {
      add(opp.lastStageChangeAt, "estagio", `Mudou de estágio: ${nome}`,
        opp.stage ? `Agora em ${opp.stage}` : "", autor(users, opp.assignedTo));
    }
    if (depoisDe(opp.lastStatusChangeAt, opp.createdAt)) {
      add(opp.lastStatusChangeAt, "status", `Mudou de status: ${nome}`,
        opp.status ? `Agora ${opp.status}` : "", autor(users, opp.assignedTo));
    }
  }

  for (const nota of notes) {
    add(nota.dateAdded || nota.createdAt, "nota", "Nota",
      resumir(textoDaNota(nota)), autor(users, nota.userId));
  }

  for (const tarefa of tasks) {
    const titulo = tarefa.title || tarefa.name || "Tarefa";
    add(tarefa.dateAdded || tarefa.createdAt, "tarefa", `Tarefa: ${titulo}`,
      tarefa.completed ? "Concluída" : (tarefa.dueDate ? `Vence ${tarefa.dueDate}` : ""),
      autor(users, tarefa.assignedTo));
  }

  for (const rev of revisions) {
    // O `actor` da revisão é a chave interna da sessão — em conta fixa,
    // algo como "fixed:loc_ABC". Só sai na tela se der para traduzir em
    // nome de gente; id cru nunca aparece para o usuário.
    add(rev.created_at, "ficha", OPERACOES[rev.operation] || "Ficha alterada",
      "", autor(users, rev.actor));
  }

  // Do mais recente para o mais antigo: a pergunta é quase sempre "o que
  // aconteceu por último".
  eventos.sort((a, b) => new Date(b.at) - new Date(a.at));
  return eventos.slice(0, limit);
}

/**
 * Junta eventos por dia, para a tela não repetir a data em cada linha.
 * Devolve `[{ dia: "2026-09-01", eventos: [...] }]`, na mesma ordem.
 */
export function agruparPorDia(eventos = []) {
  const grupos = [];
  for (const ev of eventos) {
    const dia = ev.at.slice(0, 10);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.eventos.push(ev);
    else grupos.push({ dia, eventos: [ev] });
  }
  return grupos;
}
