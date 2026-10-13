/**
 * Espelhar as oportunidades do CRM dentro de um quadro.
 *
 * O funil recém-criado nasce vazio, e um funil vazio não se usa: ninguém
 * digita de novo os leads que já estão no CRM. Este módulo traduz as
 * oportunidades em fichas do quadro — nome, contato e a etapa em que
 * cada uma já está.
 *
 * É CÓPIA, e isso é dito em voz alta na tela: mover o card aqui não
 * mexe no GHL. O contrário (prometer sincronia e entregar cópia) seria
 * pior do que não importar nada, porque ela confiaria num espelho que
 * não reflete.
 *
 * O elo com a origem é `source_external_id` = id da oportunidade. É o
 * que faz a segunda importação não duplicar o que a primeira trouxe.
 */

const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Normaliza um nome de etapa para comparar.
 *
 * Tira o prefixo de ordenação que as contas usam ("1 · ", "2- ",
 * "03. "): ele organiza a lista no CRM e não faz parte do nome. Sem
 * isto, "2- Qualificado" nunca casaria com "Qualificado".
 */
export function normalizarEtapa(nome) {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(/^\s*\d+\s*[.·\-–—)]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A opção do quadro que corresponde a um estágio do CRM.
 *
 * Três tentativas, da mais exigente para a mais frouxa: nome igual,
 * um contendo o outro, e primeira palavra em comum ("no show" casa com
 * "no show / reagendar"). Sem casar, devolve null — e aí o card entra
 * sem etapa, visível em "Sem …", em vez de ser chutado numa coluna
 * errada. Um lead na coluna errada é pior que um lead sem coluna: o
 * primeiro mente, o segundo pede atenção.
 */
export function casarEtapa(nomeDoEstagio, opcoes = []) {
  const alvo = normalizarEtapa(nomeDoEstagio);
  if (!alvo) return null;

  const normalizadas = opcoes.map((o) => ({ id: o.id, n: normalizarEtapa(o.name) }));

  const exata = normalizadas.find((o) => o.n === alvo);
  if (exata) return exata.id;

  const contem = normalizadas.find((o) => o.n && (o.n.includes(alvo) || alvo.includes(o.n)));
  if (contem) return contem.id;

  const primeira = alvo.split(" ")[0];
  if (primeira.length >= 4) {
    const porPalavra = normalizadas.find((o) => o.n.split(" ").includes(primeira));
    if (porPalavra) return porPalavra.id;
  }
  return null;
}

/** Acha um campo do quadro pelo nome, sem ligar para acento nem caixa. */
export function campoPorNome(campos = [], ...nomes) {
  const alvos = nomes.map((n) => normalizarEtapa(n));
  return campos.find((c) => alvos.includes(normalizarEtapa(c.name))) || null;
}

/**
 * As fichas a criar a partir das oportunidades.
 *
 * `oportunidades` vêm de `opportunityToRecord`; `contatos`, de
 * `contactToRecord` — o telefone e o e-mail moram no contato, não na
 * oportunidade, e um card sem telefone não serve para ligar.
 *
 * `jaImportados` são os `source_external_id` que o quadro já tem: a
 * segunda importação traz só o que é novo.
 *
 * Devolve `{ fichas, semEtapa, jaExistiam }`.
 */
export function mapearOportunidades(oportunidades = [], {
  campoEtapa = null, campos = [], contatos = [], jaImportados = [],
} = {}) {
  const opcoes = campoEtapa?.config?.options || [];
  const porContato = new Map(contatos.filter((c) => c?.externalId).map((c) => [c.externalId, c]));
  const existentes = new Set(jaImportados);

  const campoTel    = campoPorNome(campos, "Telefone", "Phone");
  const campoEmail  = campoPorNome(campos, "E-mail", "Email");
  const campoEstado = campoPorNome(campos, "Estado onde mora", "Estado", "State");
  const campoNotas  = campoPorNome(campos, "Notas", "Observações");

  const fichas = [];
  let semEtapa = 0;
  let jaExistiam = 0;

  for (const opp of oportunidades) {
    if (!opp?.externalId) continue;
    if (existentes.has(opp.externalId)) { jaExistiam += 1; continue; }

    const contato = opp.contactId ? porContato.get(opp.contactId) : null;
    const props = {};

    if (campoEtapa) {
      const etapa = casarEtapa(opp.properties?.stage, opcoes);
      if (etapa) props[campoEtapa.key] = etapa;
      else semEtapa += 1;
    }
    if (campoTel && contato?.properties?.phone) props[campoTel.key] = contato.properties.phone;
    if (campoEmail && contato?.properties?.email) props[campoEmail.key] = contato.properties.email;
    if (campoEstado && contato?.properties?.state) props[campoEstado.key] = contato.properties.state;
    // A procedência fica escrita na ficha: de qual pipeline e estágio o
    // card veio, e em que situação estava. Sem isso, daqui a um mês
    // ninguém sabe o que é cópia e o que foi digitado aqui.
    if (campoNotas) {
      const linhas = [
        `Importado do CRM em ${new Date().toISOString().slice(0, 10)}.`,
        opp.properties?.pipeline ? `Pipeline: ${opp.properties.pipeline}` : null,
        opp.properties?.stage ? `Estágio no CRM: ${opp.properties.stage}` : null,
        opp.properties?.status ? `Situação: ${rotuloDoStatus(opp.properties.status)}` : null,
      ].filter(Boolean);
      props[campoNotas.key] = linhas.join("\n");
    }

    fichas.push({
      sourceExternalId: opp.externalId,
      title: contato?.title || opp.title || "Sem nome",
      properties: props,
      pipeline: opp.properties?.pipeline || "",
      estagio: opp.properties?.stage || "",
      status: opp.properties?.status || "",
    });
  }

  return { fichas, semEtapa, jaExistiam };
}

export function rotuloDoStatus(status) {
  return { open: "aberta", won: "ganha", lost: "perdida", abandoned: "abandonada" }[status] || status;
}

/** Quantas oportunidades por pipeline — o resumo mostrado antes de criar. */
export function resumoPorPipeline(fichas = []) {
  const conta = new Map();
  for (const f of fichas) {
    const nome = f.pipeline || "Sem pipeline";
    conta.set(nome, (conta.get(nome) || 0) + 1);
  }
  return [...conta.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}
