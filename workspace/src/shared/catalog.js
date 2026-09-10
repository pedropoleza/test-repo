/**
 * Catálogo de serviços.
 *
 * O código de serviço é o contrato entre os dois sistemas. Do lado do
 * GoHighLevel ele amarra a pipeline, a pasta de campos, o campo de
 * vencimento e a tag; do lado do engine, o checklist de documentos e
 * qual acordo o serviço gera. Uma peça, referenciada nos dois lugares —
 * é o que impede o mesmo serviço de virar "passaporte", "Passaporte" e
 * "renovação de passaporte" em três telas diferentes.
 *
 * Duas camadas, de propósito:
 *
 *  - O catálogo (aqui embaixo) é CONTEÚDO DE NEGÓCIO — os serviços dela,
 *    autorados a partir do plano da conta e dos documentos que ela usa.
 *    É conhecimento que não se deriva: qual acordo o PO Box gera, que
 *    documentos um caso consular precisa, que o annual report vence no
 *    mês de abertura da empresa.
 *
 *  - A resolução (`resolverCatalogo`) amarra cada serviço à CONTA VIVA:
 *    qual pipeline o hospeda hoje, que pasta de campos abre, qual campo
 *    de data dispara a renovação. Isso vem do GHL em tempo real, com os
 *    mesmos detectores das colunas por pipeline — então os dois lados
 *    nunca divergem.
 *
 * Serviço não é pipeline. O PO Box é um serviço com contrato, campos e
 * renovação, mas não tem funil próprio — vive nos campos do contato. Por
 * isso o catálogo é uma lista de serviços, não uma leitura das pipelines.
 *
 * Numa conta que não casa com nada disto (a da Daniely), a resolução
 * devolve zero serviços ativos e nenhuma tela muda.
 */
import { detectarGrupos, chavesDosGrupos } from "./field-groups.js";

/**
 * Campos de data cujo NOME indica um vencimento, em qualquer das línguas
 * em que a conta pode estar nomeada.
 *
 * Serve de rede: o padrão específico de cada serviço (abaixo) é escrito
 * a partir do rótulo que a conta usava quando foi medida, e rótulo muda
 * — "MV · Vencimento do Registration" virou "MV · Expiration Date" e o
 * radar emudeceu sem avisar. Quando o padrão específico não acha nada na
 * pasta do serviço, esta rede acha.
 */
const RE_VENCIMENTO = new RegExp(
  "vencimento|validade|vig[êe]ncia|anniversary|expir|renova|renew|due date", "i",
);

/**
 * Os documentos que ela EMITE, ligados aos PDFs reais da Latino USA.
 *
 * `arquivo` é o nome do PDF de origem — o gerador preenche esse arquivo,
 * nunca recria o texto jurídico (o Master diz, em maiúsculas, que ela
 * NÃO é escritório de advocacia; reescrever a linguagem dela seria
 * atravessar essa linha). `idiomas` são as versões que existem.
 */
export const ACORDOS = {
  master: {
    id: "master", nome: "Master Client Service Agreement",
    arquivo: "master", idiomas: ["en"], guardaChuva: true,
  },
  pobox: {
    id: "pobox", nome: "Contrato de PO Box (PMB)",
    arquivo: "pobox", idiomas: ["en"],
  },
  llc: {
    id: "llc", nome: "LLC Formation Service Agreement",
    arquivo: "llc", idiomas: ["en"],
  },
  seguro: {
    id: "seguro", nome: "Insurance Service Client Agreement",
    arquivo: "seguro", idiomas: ["en"],
  },
  divorce: {
    id: "divorce", nome: "Divorce Agreement",
    // Um PDF por idioma, cada um o documento oficial dela naquela língua.
    arquivo: { pt: "divorce-pt", en: "divorce-en", es: "divorce-es" },
    idiomas: ["pt", "en", "es"],
  },
};

/**
 * Os serviços dela. `familia` espelha os grupos da navegação (Seguros /
 * Serviços). `pipeline`/`grupo`/`vencimento` são os padrões que ligam o
 * serviço à conta viva; `null` em `pipeline` é serviço sem funil.
 */
export const CATALOGO = [
  {
    code: "seguro-vida", nome: "Seguro de Vida", icone: "🌱", familia: "Seguros",
    // "seguro de vida" e não "prospect": a pipeline dela é "Seguro de
    // Vida — Prospects", mas "prospect" sozinho casaria com o funil de
    // prospecção de qualquer outra conta.
    pipeline: /seguro de vida/i, grupo: /^seg/i,
    recorrencia: "unica",
    documentos: {
      recebidos: ["Identificação com foto", "Comprovante de endereço"],
      acordos: ["seguro", "master"],
    },
  },
  {
    code: "apolice", nome: "Apólice", icone: "🛡", familia: "Seguros",
    pipeline: /ap[oó]lice/i, grupo: /^seg/i, vencimento: /vig[êe]ncia|anniversary/i,
    recorrencia: "anual",
    documentos: { recebidos: [], acordos: ["seguro"] },
  },
  {
    code: "abertura-empresa", nome: "Abertura de Empresa (LLC)", icone: "🏢",
    familia: "Serviços", pipeline: /empresa|fiscal/i, grupo: /^emp/i,
    recorrencia: "unica",
    documentos: {
      recebidos: ["Identificação do sócio", "Comprovante de endereço", "SSN ou ITIN"],
      acordos: ["llc", "master"],
      // Planta uma recorrente: o annual report nasce quando a empresa abre.
      planta: ["annual-report"],
    },
  },
  {
    code: "annual-report", nome: "Annual Report", icone: "📅", familia: "Serviços",
    pipeline: /empresa|fiscal/i, grupo: /^emp/i, vencimento: /annual report/i,
    recorrencia: "anual",
    documentos: { recebidos: [], acordos: [] },
  },
  {
    code: "licenca-contratista", nome: "Licença de Contratista", icone: "🪪",
    familia: "Serviços", pipeline: /empresa|fiscal/i, grupo: /^emp/i,
    vencimento: /licen[çc]a/i, recorrencia: "anual",
    documentos: { recebidos: [], acordos: [] },
  },
  {
    code: "passaporte", nome: "Passaporte / Consular", icone: "🛂", familia: "Serviços",
    pipeline: /consular|tradu/i, grupo: /^cons/i, vencimento: /validade do passaporte/i,
    recorrencia: "sazonal",
    documentos: {
      recebidos: ["Passaporte atual", "Foto no padrão", "Comprovante de endereço"],
      acordos: ["master"],
    },
  },
  {
    code: "procuracao", nome: "Procuração", icone: "✍️", familia: "Serviços",
    pipeline: /consular|tradu/i, grupo: /^cons/i, recorrencia: "unica",
    documentos: { recebidos: ["Identificação das partes"], acordos: ["master"] },
  },
  {
    code: "traducao", nome: "Tradução", icone: "🌐", familia: "Serviços",
    pipeline: /consular|tradu/i, grupo: /^trad/i, recorrencia: "unica",
    documentos: {
      recebidos: ["Documento original a traduzir"],
      acordos: ["master"],
    },
  },
  {
    code: "registration", nome: "Emplacamento / Registration", icone: "🚗",
    familia: "Serviços", pipeline: /registro|vehicle|motor/i, grupo: /^mv/i,
    // A conta nomeia este campo ora em português ("Vencimento do
    // Registration"), ora em inglês ("Expiration Date") — os dois valem.
    vencimento: /registration|expira|expiration|vencimento|validade/i,
    recorrencia: "anual",
    documentos: {
      recebidos: ["Título do veículo", "Identificação do proprietário"],
      acordos: ["master"],
    },
  },
  {
    code: "juridico", nome: "Caso Jurídico", icone: "⚖️", familia: "Serviços",
    pipeline: /jur[íi]dic|legal|caso/i, grupo: /^jur/i, recorrencia: "unica",
    documentos: {
      recebidos: ["Documentos do caso", "Identificação das partes"],
      // Divórcio é o caso mais comum e o único com acordo pronto (trilíngue).
      acordos: ["divorce", "master"],
    },
  },
  {
    code: "pobox", nome: "PO Box", icone: "📬", familia: "Serviços",
    // Serviço sem pipeline: vive nos campos POBox do contato.
    pipeline: null, grupo: /^pobox|po box|caixa postal|mailbox/i,
    vencimento: /vencimento/i, recorrencia: "anual", cobranca: "dezembro",
    documentos: {
      recebidos: ["Identificação com foto", "Comprovante de endereço residencial", "USPS Form 1583"],
      acordos: ["pobox", "master"],
    },
  },
];

const normal = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "").trim();

/**
 * Amarra o catálogo à conta viva.
 *
 * Devolve um serviço resolvido por entrada que casa com algo na conta —
 * com a pipeline real, a pasta de campos, e os campos de vencimento
 * detectados. Uma entrada que não encontra nem pipeline nem pasta é
 * deixada de fora: não existe naquela conta.
 */
export function resolverCatalogo(pipelines = [], colunas = [], { catalogo = CATALOGO } = {}) {
  const { grupos } = detectarGrupos(colunas);

  // Quantos serviços que renovam dividem cada pasta. A rede genérica
  // (RE_VENCIMENTO) só pode ser usada onde o serviço é o único que
  // renova naquela pasta — em "Emp ·" moram o annual report E a
  // licença, e deixar os dois pescarem qualquer data faria cada
  // vencimento aparecer duas vezes, com o nome errado numa delas.
  const donosDaPasta = new Map();
  for (const s of catalogo) {
    if (s.recorrencia === "unica" || !s.grupo) continue;
    const chave = s.grupo.source;
    donosDaPasta.set(chave, (donosDaPasta.get(chave) || 0) + 1);
  }

  const resolvido = [];
  for (const servico of catalogo) {
    const pipeline = servico.pipeline
      ? pipelines.find((p) => servico.pipeline.test(p.name || ""))
      : null;

    // A pasta de campos: por padrão de nome do grupo, casada com o
    // prefixo. Sem grupos (conta sem convenção), fica vazia.
    const grupo = servico.grupo
      ? grupos.find((g) => servico.grupo.test(g.id))
      : null;
    const campos = grupo ? grupo.campos : [];

    // Serviço não é pipeline: qualquer um dos dois sinais basta. O PO
    // Box existe só pelos campos (nunca teve funil), e o Motor Vehicle
    // precisa existir mesmo numa conta que trabalha os registros pelos
    // campos do contato, sem funil próprio. Sem nenhum dos dois, o
    // serviço não existe naquela conta e fica de fora.
    const existe = !!pipeline || !!grupo;
    if (!existe) continue;

    const achar = (re) => campos.filter((c) => re.test(c.name || c.curto || ""))
      .map((c) => ({ key: c.key, name: c.name }));

    let vencimentos = servico.vencimento ? achar(servico.vencimento) : [];
    // Rede: o rótulo mudou (ou está noutra língua) e o padrão específico
    // não achou nada. Vale só onde este é o único serviço que renova na
    // pasta — aí não há a quem confundir.
    if (servico.vencimento && !vencimentos.length
        && donosDaPasta.get(servico.grupo?.source) === 1) {
      vencimentos = achar(RE_VENCIMENTO);
    }

    resolvido.push({
      code: servico.code,
      nome: servico.nome,
      icone: servico.icone,
      familia: servico.familia,
      recorrencia: servico.recorrencia,
      cobranca: servico.cobranca || null,
      pipelineId: pipeline?.id || null,
      pipelineName: pipeline?.name || null,
      grupoId: grupo?.id || null,
      campos: grupo ? chavesDosGrupos([grupo]) : [],
      vencimentos,
      recorrente: servico.recorrencia !== "unica" && vencimentos.length > 0,
      documentos: {
        recebidos: servico.documentos?.recebidos || [],
        acordos: (servico.documentos?.acordos || []).map((id) => ACORDOS[id]).filter(Boolean),
      },
      planta: servico.documentos?.planta || [],
    });
  }
  return resolvido;
}

/** O serviço que uma pipeline hospeda, se o catálogo conhecer. */
export function servicoDaPipeline(pipelineName, resolvido = []) {
  const alvo = normal(pipelineName);
  if (!alvo) return null;
  return resolvido.find((s) => s.pipelineName && normal(s.pipelineName) === alvo) || null;
}

/** Os serviços recorrentes resolvidos — os que renovam por campo de data. */
export function servicosRecorrentes(resolvido = []) {
  return resolvido.filter((s) => s.recorrente);
}

/** O acordo pelo id, no idioma pedido (cai no inglês quando só há ele). */
export function arquivoDoAcordo(acordo, idioma = "en") {
  if (!acordo) return null;
  const arq = acordo.arquivo;
  if (typeof arq === "string") return arq;
  return arq[idioma] || arq.en || Object.values(arq)[0] || null;
}
