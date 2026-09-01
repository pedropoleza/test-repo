/**
 * Modelos de ficha.
 *
 * Uma ficha em branco pede que a pessoa lembre, toda vez, o que precisa
 * perguntar. Um modelo já traz o roteiro do tipo de negócio: apólice tem
 * beneficiário e renovação, recrutamento tem licenciamento e entrevista,
 * consultoria tem ilustração e decisão. Nenhum deles é o outro.
 *
 * Por que o modelo NÃO é escolhido só pela pipeline: 237 dos 300
 * contatos desta conta não têm nenhuma oportunidade. Amarrar o modelo à
 * pipeline deixaria 4 de cada 5 fichas sem roteiro. Então a pipeline
 * SUGERE — quando existe, a ficha já nasce com o modelo certo — e a
 * pessoa aplica o que quiser, a qualquer momento, em qualquer ficha.
 *
 * Aplicar é sempre acrescentar. Um modelo que apagasse o que já está
 * escrito seria usado uma vez.
 */

const text = (s) => ({ rich: [{ s: String(s) }] });

const h2 = (s) => ({ type: "heading2", content: text(s) });
const h3 = (s) => ({ type: "heading3", content: text(s) });
const p = (s = "") => ({ type: "paragraph", content: text(s) });
const todo = (s) => ({ type: "checklist", content: { checked: false, rich: [{ s }] } });
const item = (s) => ({ type: "bulleted_list", content: text(s) });
const aviso = (s) => ({ type: "callout", content: { emoji: "💡", rich: [{ s }] } });

/**
 * Os modelos.
 *
 * `pipelines` são pedaços de nome, em minúsculas e sem acento; a
 * pipeline "2- Policies" casa com "policies". Vários modelos podem citar
 * a mesma palavra — vence o primeiro da lista, e por isso os mais
 * específicos vêm antes.
 */
export const TEMPLATES = [
  {
    id: "apolice",
    nome: "Apólice",
    icone: "🛡",
    descricao: "Cobertura, beneficiários e a renovação do ano que vem.",
    pipelines: ["policies", "apolice", "apolices"],
    blocos: () => [
      h2("Apólice"),
      h3("Cobertura"),
      item("Produto:"),
      item("Seguradora:"),
      item("Valor segurado:"),
      item("Prêmio mensal:"),
      item("Início de vigência:"),
      h3("Beneficiários"),
      item("Principal (nome, parentesco, %):"),
      item("Contingente:"),
      aviso("Confirmar os beneficiários uma vez por ano — é o dado que "
        + "mais muda de vida sem ninguém avisar a corretora."),
      h3("Renovação"),
      todo("Confirmar mês de aniversário da apólice"),
      todo("Revisar cobertura frente à situação atual"),
      todo("Falar com o cliente antes do vencimento"),
      h3("Pagamento"),
      item("Forma:"),
      item("Dia do débito:"),
      item("Pendências:"),
      p(),
    ],
  },
  {
    id: "recrutamento",
    nome: "Recrutamento",
    icone: "🎯",
    descricao: "Perfil, entrevistas, licenciamento e onboarding.",
    pipelines: ["recruiting", "recrutamento", "carreira"],
    blocos: () => [
      h2("Recrutamento"),
      h3("Perfil"),
      item("Ocupação atual:"),
      item("Experiência em vendas/seguros:"),
      item("Disponibilidade (horas/semana):"),
      item("Motivação:"),
      h3("Processo"),
      todo("Primeira conversa"),
      todo("Entrevista agendada"),
      todo("Entrevista realizada"),
      todo("Contrato enviado"),
      h3("Licenciamento"),
      todo("Pré-requisitos verificados"),
      todo("Curso iniciado"),
      todo("Exame agendado"),
      todo("Licença emitida"),
      item("Estado da licença:"),
      item("Número da licença:"),
      h3("Onboarding"),
      todo("Acesso aos sistemas"),
      todo("Primeira reunião de equipe"),
      todo("Primeiro cliente"),
      p(),
    ],
  },
  {
    id: "consultoria",
    nome: "Consultoria",
    icone: "📊",
    descricao: "Situação, objetivo, ilustração e decisão — o roteiro das "
      + "pipelines de Aposentadoria, Benefício em Vida e Blindagem.",
    pipelines: ["aposentadoria", "beneficio em vida", "blindagem"],
    blocos: () => [
      h2("Consultoria"),
      h3("Situação hoje"),
      item("Renda:"),
      item("Dependentes:"),
      item("O que já tem contratado:"),
      item("Dívidas relevantes:"),
      h3("Objetivo"),
      item("O que a pessoa quer resolver:"),
      item("Prazo:"),
      item("Quanto pode guardar por mês:"),
      h3("Ilustração"),
      todo("Ilustração montada"),
      todo("Ilustração apresentada"),
      item("Produto proposto:"),
      item("Valor proposto:"),
      h3("Decisão"),
      item("Quem decide:"),
      item("Objeções levantadas:"),
      item("Próximo passo combinado:"),
      todo("Follow-up agendado"),
      p(),
    ],
  },
  {
    id: "prospeccao",
    nome: "Prospecção",
    icone: "📞",
    descricao: "Qualificação, objeções e o próximo contato.",
    pipelines: ["prospect", "prospects", "leads"],
    blocos: () => [
      h2("Prospecção"),
      h3("Qualificação"),
      item("Como chegou:"),
      item("Precisa de quê:"),
      item("Tem urgência?"),
      item("Consegue pagar?"),
      item("Decide sozinho?"),
      h3("Contatos"),
      todo("Primeira tentativa"),
      todo("Segunda tentativa"),
      todo("Terceira tentativa"),
      aviso("Três tentativas sem resposta: mover para nutrição em vez de "
        + "manter no funil ativo."),
      h3("Objeções"),
      item("O que ouviu:"),
      item("Como respondeu:"),
      h3("Próximo passo"),
      item("O que ficou combinado:"),
      item("Quando:"),
      p(),
    ],
  },
  {
    id: "agencia",
    nome: "Agência",
    icone: "🏢",
    descricao: "Contrato, metas e equipe de quem já é agente.",
    pipelines: ["agency", "agencia"],
    blocos: () => [
      h2("Agência"),
      h3("Contrato"),
      item("Nível atual:"),
      item("Percentual:"),
      item("Data do último avanço:"),
      h3("Metas"),
      item("Meta do trimestre:"),
      item("Produção até agora:"),
      h3("Equipe"),
      item("Recrutados diretos:"),
      item("Em licenciamento:"),
      h3("Desenvolvimento"),
      todo("Reunião de acompanhamento do mês"),
      todo("Próximo nível: requisitos revisados"),
      p(),
    ],
  },
];

const RE_DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

const normal = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(RE_DIACRITICOS, "").trim();

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

/**
 * O modelo que a pipeline sugere, ou null.
 *
 * Só sugere: quem abre a ficha pode trocar, e um contato sem pipeline
 * nenhuma — a maioria, nesta conta — abre sem modelo em vez de abrir com
 * o modelo errado.
 */
export function templateParaPipeline(nomeDaPipeline) {
  const alvo = normal(nomeDaPipeline);
  if (!alvo) return null;
  for (const t of TEMPLATES) {
    if (t.pipelines.some((chave) => alvo.includes(chave))) return t;
  }
  return null;
}

/**
 * O modelo sugerido para um contato, a partir das oportunidades dele.
 * A mais recente manda: é o negócio em andamento.
 */
export function templateParaContato(opportunities = []) {
  const ordenadas = [...opportunities].sort((a, b) =>
    new Date(b.createdAt || b.properties?.created_at || 0)
    - new Date(a.createdAt || a.properties?.created_at || 0));
  for (const opp of ordenadas) {
    const t = templateParaPipeline(opp.pipeline || opp.properties?.pipeline);
    if (t) return t;
  }
  return null;
}

/** Os blocos do modelo, prontos para inserir. Sempre uma cópia nova. */
export function blocosDoModelo(id) {
  return getTemplate(id)?.blocos() || [];
}
