/**
 * O molde de um funil novo.
 *
 * Criar um funil à mão são quinze passos: página, tabela, campo de
 * etapas, uma opção por etapa, campos da ficha, vista de quadro,
 * agrupamento, bloco na página. Ninguém faz isso duas vezes — e um funil
 * que custa quinze passos não nasce, e o trabalho volta para a planilha.
 *
 * Aqui mora o que um funil PRECISA ter para já funcionar no primeiro
 * minuto. O servidor monta; este módulo decide o que montar.
 */
import { OPTION_COLORS } from "./fields.js";

/**
 * As etapas sugeridas quando a pessoa não escreve as suas.
 *
 * Genéricas de propósito: um funil é um funil, e renomear coluna já é um
 * clique. Sugerir as etapas de seguros aqui empurraria o negócio de uma
 * conta para dentro de outra.
 */
export const ETAPAS_SUGERIDAS = [
  "Novo", "Em contato", "Qualificado", "Proposta", "Ganhou", "Perdeu",
];

/**
 * Os campos da ficha que todo funil ganha.
 *
 * O suficiente para ligar para alguém e saber o que fazer depois: quem
 * é, como falar, de onde veio e qual o próximo passo. O resto a pessoa
 * acrescenta — inclusive importando os campos personalizados do CRM.
 */
export const CAMPOS_BASE = [
  { name: "Telefone", type: "phone" },
  { name: "E-mail", type: "email" },
  { name: "Origem do lead", type: "select", options: [
    "Indicação", "Instagram", "Facebook ADS", "Anúncio", "Lista", "Evento", "Outro",
  ] },
  { name: "Próxima ação", type: "text" },
  { name: "Notas", type: "long_text" },
];

/**
 * Nome do campo que vira as colunas.
 *
 * Só "Etapas". Repetir o nome do funil aqui dava "Etapas · CRM → SDR
 * [seguros]" — um rótulo que não cabe na ficha e que não desambigua
 * nada, porque cada funil é a sua própria tabela. Quem renomeia, renomeia.
 */
export const NOME_DO_CAMPO_DE_ETAPAS = "Etapas";

export function nomeDoCampoDeEtapas() {
  return NOME_DO_CAMPO_DE_ETAPAS;
}

/**
 * Lê as etapas escritas pela pessoa: uma por linha.
 *
 * Aceita o que sai de um copiar-colar — numeração ("1. Novo"), setas
 * ("Novo → Em contato") e vírgulas — porque é assim que um funil chega:
 * de uma mensagem, não de um formulário.
 */
export function lerEtapas(texto) {
  const bruto = String(texto || "")
    .split(/[\n\r]+|→|->|→/)
    .flatMap((linha) => (linha.includes(",") && !linha.includes("/") ? linha.split(",") : [linha]));

  const vistos = new Set();
  const etapas = [];
  for (const parte of bruto) {
    const nome = parte
      .replace(/^\s*[-•*]\s*/, "")
      .replace(/^\s*\d+\s*[.·\-–—)]\s*/, "")
      .trim();
    if (!nome) continue;
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    etapas.push(nome.slice(0, 120));
  }
  return etapas.slice(0, 40);
}

/** Gera um id de opção estável a partir do nome. */
export function idDeEtapa(nome, tomados = []) {
  const base = String(nome || "etapa")
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 40) || "etapa";
  let id = base;
  let n = 2;
  while (tomados.includes(id)) id = `${base}_${n++}`;
  return id;
}

/**
 * O molde completo, pronto para o servidor executar.
 *
 * `etapas` vazio cai nas sugeridas: um quadro sem coluna nenhuma não
 * abre, e deixar a pessoa diante de uma tela vazia é o oposto do que
 * este atalho existe para fazer.
 */
export function montarFunil({ nome, etapas = [], campos = CAMPOS_BASE } = {}) {
  const titulo = String(nome || "").trim() || "Novo funil";
  const lista = etapas.length ? etapas : ETAPAS_SUGERIDAS;

  const tomados = [];
  const opcoes = lista.map((etapa, i) => {
    const id = idDeEtapa(etapa, tomados);
    tomados.push(id);
    return { id, name: etapa, color: OPTION_COLORS[i % OPTION_COLORS.length] };
  });

  return {
    titulo,
    campoDeEtapas: {
      name: nomeDoCampoDeEtapas(),
      type: "select",
      config: { options: opcoes },
    },
    campos: campos.map((c) => ({
      name: c.name,
      type: c.type,
      config: c.options
        ? { options: c.options.map((o, i) => ({
          id: idDeEtapa(o), name: o, color: OPTION_COLORS[i % OPTION_COLORS.length],
        })) }
        : {},
    })),
  };
}
