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
      "O radar dos serviços recorrentes — PO Box, registration (o Expiration Date "
        + "do Motor Vehicle), annual report, licença, apólice, passaporte. Lê a "
        + "data de vencimento de cada contato e mostra o que está para vencer.",
      "É a ferramenta de retenção: avisa antes de o serviço vencer, para o cliente "
        + "voltar em vez de sumir. Vencido vem primeiro; depois 30, 60 e 90 dias.",
      "Leia de cima para baixo: a régua mostra quanto tem em cada urgência (e "
        + "clicar numa faixa filtra por ela), a barra “Por serviço” mostra quem "
        + "está puxando o vermelho, e cada cartão traz a barra do prazo e quantos "
        + "dias faltam. Clique num serviço da barra para ver só ele.",
    ],
  },
  agenda: {
    titulo: "Agenda operacional",
    paragrafos: [
      "O plano da semana num lugar só. Junta três coisas que hoje vivem em "
        + "telas separadas: as renovações que vencem, as tarefas com prazo e os "
        + "casos parados no Aguardando. Não é o calendário de agendamentos do CRM "
        + "— é “o que preciso entregar e cobrar esta semana”.",
      "Atrasados no topo (o que já venceu e segue aberto), depois Parados agora "
        + "(casos esperando cliente ou terceiro, sem data) e A semana, com os sete "
        + "dias. Use ‹ e › para trocar de semana e clique num item para abrir a "
        + "pasta do contato.",
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
  documentos: {
    titulo: "Documentos para assinar",
    paragrafos: [
      "A fila de documentos que foram mandados para os clientes assinarem pelo "
        + "link. Cada um mostra em que pé está: enviado e ainda não aberto, aberto "
        + "mas sem assinar, ou já assinado.",
      "O bloco “aberto pelo cliente, sem assinar” é o que mais merece atenção — "
        + "é quem se interessou e parou no meio. Para mandar um documento novo, "
        + "use a ficha do contato.",
    ],
  },
  relatorios: {
    titulo: "Relatórios por serviço",
    paragrafos: [
      "O retrato da operação em números, por serviço (pipeline): quanto entrou "
        + "(faturamento dos casos ganhos), quantos casos estão abertos, quantos "
        + "ganharam ou perderam, o ticket médio e há quanto tempo os abertos estão "
        + "de pé.",
      "Tudo deduzido das mesmas oportunidades que a tabela e o quadro mostram caso "
        + "a caso — nenhum cadastro a mais. A taxa de ganho é sobre o que já foi "
        + "decidido (ganhos + perdidos).",
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
