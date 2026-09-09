/**
 * Os textos do ⓘ de cada módulo.
 *
 * Ficam num arquivo só para serem fáceis de revisar e ajustar sem mexer
 * na tela. Cada entrada é `{ titulo, paragrafos }` — o que o módulo é, de
 * onde vêm os dados, e como usar.
 */
export const DETALHES_MODULO = {
  contacts: {
    titulo: "Leads",
    paragrafos: [
      "Todos os contatos da sua conta, ao vivo do CRM. Cada linha é uma pessoa; "
        + "clique no nome para abrir a pasta dela.",
      "Os campos são editáveis direto na tabela — o que você muda aqui grava no "
        + "contato no CRM. Dá para filtrar, ordenar e escolher quais colunas ver.",
    ],
  },
  opportunities: {
    titulo: "Oportunidades",
    paragrafos: [
      "Os casos em andamento — cada oportunidade é um serviço de um cliente, na "
        + "pipeline do departamento. Vêm ao vivo do CRM.",
      "Dá para mover de estágio pela própria célula e abrir a pasta do contato "
        + "ligado ao caso. As abas por serviço, na navegação, são recortes disto.",
    ],
  },
  renewals: {
    titulo: "Renovações",
    paragrafos: [
      "As apólices e serviços que precisam renovar, agrupados por urgência. Lê a "
        + "pipeline de apólices — por mês ou por estado, conforme a conta marca.",
      "Dentro de cada faixa, primeiro o que está parado há mais tempo: é a ordem "
        + "em que vale a pena ligar.",
    ],
  },
  vencimentos: {
    titulo: "Vencimentos",
    paragrafos: [
      "O radar dos serviços recorrentes — PO Box, registration, annual report, "
        + "licença, passaporte. Lê a data de vencimento de cada contato e mostra o "
        + "que está para vencer.",
      "É a ferramenta de retenção: avisa antes de o serviço vencer, para o cliente "
        + "voltar em vez de sumir. Vencido vem primeiro; depois 30, 60 e 90 dias.",
    ],
  },
  aguardando: {
    titulo: "Aguardando",
    paragrafos: [
      "O que está parado agora: casos esperando o cliente trazer um documento, "
        + "ou esperando um terceiro (consulado, DMV, corte, advogado) responder.",
      "Ordenado por tempo parado, para você agir primeiro em quem espera há mais "
        + "tempo. É o painel de “não perder caso no meio do caminho”.",
    ],
  },
  tasks: {
    titulo: "Tarefas",
    paragrafos: [
      "As tarefas recebidas do Spark Tasks, replicadas aqui para você filtrar e "
        + "agrupar junto do resto. Para alterar uma tarefa, use o Spark Tasks.",
    ],
  },
  listas: {
    titulo: "Lista salva",
    paragrafos: [
      "Um recorte de uma pipeline: todo mundo que está nela, agora. A lista não "
        + "guarda os registros — consulta o CRM a cada abertura, então nunca "
        + "envelhece.",
      "Cada lista mostra as colunas do serviço dela e tem filtros e ordenação "
        + "próprios.",
    ],
  },
};
