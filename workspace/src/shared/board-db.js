/**
 * Quadro (board) de uma database — o funil em colunas.
 *
 * A tabela responde "quais registros existem" em linhas; o quadro põe a
 * mesma base em colunas e deixa arrastar de uma para a outra. A diferença
 * para o quadro do CRM (shared/board.js, sobre as oportunidades do GHL) é
 * de quem manda nas colunas: lá são os estágios da pipeline, que só o CRM
 * cria; aqui são as OPÇÕES de um campo de seleção, que nascem e morrem
 * dentro do próprio quadro. É o que torna possível criar uma coluna nova
 * sem sair da tela — e por isso um funil que precisa de colunas próprias
 * mora numa database, não numa pipeline.
 *
 * Este módulo é só a lógica: quais colunas existem, o que cai em cada
 * uma, e como nasce uma opção nova. Quem desenha é database/board-body.js.
 */
import { OPTION_COLORS, readValue, isEmptyValue } from "./fields.js";

/**
 * Só seleção e status podem reger um quadro.
 *
 * Multi-seleção faria o mesmo card aparecer em duas colunas, e arrastar
 * ficaria ambíguo (move, ou acrescenta?). Texto livre criaria colunas que
 * ninguém consegue recriar ao arrastar. Os dois tipos que sobram têm uma
 * lista fechada de opções — que é exatamente o que uma coluna é.
 */
export const TIPOS_DE_COLUNA = ["select", "status"];

export function podeRegerQuadro(campo) {
  return !!campo && TIPOS_DE_COLUNA.includes(campo.type);
}

/** Os campos que serviriam de colunas, para oferecer na escolha. */
export function camposPossiveis(campos = []) {
  return campos.filter(podeRegerQuadro);
}

/**
 * O campo que rege o quadro: o agrupamento da vista, se ele puder; senão
 * o primeiro candidato. Um quadro sem campo de coluna não é um quadro —
 * aí a tela pede para escolher um em vez de desenhar nada.
 */
export function campoDeColunas(campos = [], groupBy = null) {
  const escolhido = groupBy ? campos.find((c) => c.key === groupBy) : null;
  if (podeRegerQuadro(escolhido)) return escolhido;
  return camposPossiveis(campos)[0] || null;
}

/** A chave da coluna "sem valor". Não é um id de opção — é a ausência. */
export const SEM_COLUNA = "__sem__";

/**
 * As colunas do quadro, na ordem em que a pessoa organizou as opções.
 *
 * Ao contrário de `groupRecords`, uma coluna VAZIA continua aparecendo:
 * num funil, "Sinal Verde: 0" é informação — é o estágio onde ninguém
 * chegou esta semana. Esconder a coluna vazia também tiraria o lugar
 * onde se solta o card para chegar lá.
 *
 * A coluna "sem valor" é a exceção: só aparece quando tem card. Ela não é
 * uma etapa do funil, é uma pendência — e uma pendência vazia é ruído.
 */
export function colunasDoQuadro(records = [], campo = null) {
  if (!podeRegerQuadro(campo)) return [];
  const opcoes = campo.config?.options || [];

  const porOpcao = new Map(opcoes.map((o) => [o.id, []]));
  const soltos = [];
  for (const record of records) {
    const valor = readValue(campo, record);
    if (isEmptyValue(valor)) { soltos.push(record); continue; }
    const id = String(valor);
    if (porOpcao.has(id)) porOpcao.get(id).push(record);
    // Valor que não é mais opção (a opção foi apagada): conta como solto,
    // senão o card desapareceria do quadro sem ter sido excluído.
    else soltos.push(record);
  }

  const colunas = opcoes.map((o) => ({
    id: o.id,
    nome: o.name,
    cor: o.color || "gray",
    opcao: true,
    records: porOpcao.get(o.id),
  }));
  if (soltos.length) {
    colunas.push({
      id: SEM_COLUNA,
      nome: `Sem ${(campo.name || "valor").toLowerCase()}`,
      cor: "gray",
      opcao: false,
      records: soltos,
    });
  }
  return colunas;
}

/** Gera um id de opção estável e único dentro do campo. */
function idDeOpcao(nome, tomados = []) {
  const base = String(nome || "opcao")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "opcao";
  let id = base;
  let n = 2;
  while (tomados.includes(id)) id = `${base}_${n++}`;
  return id;
}

/**
 * A lista de opções com uma coluna nova no fim.
 *
 * Devolve `{ options, option }` — `options` é o que vai no config do
 * campo, `option` é a recém-criada (para já abrir o card nela). Nome
 * vazio vira "Nova coluna"; nome repetido ganha id próprio, porque duas
 * colunas com o mesmo nome ainda são duas colunas.
 */
export function novaColuna(campo, nome) {
  const options = (campo?.config?.options || []).map((o) => ({ ...o }));
  const limpo = String(nome || "").trim() || "Nova coluna";
  const option = {
    id: idDeOpcao(limpo, options.map((o) => o.id)),
    name: limpo,
    color: OPTION_COLORS[options.length % OPTION_COLORS.length],
  };
  options.push(option);
  return { options, option };
}

/** As opções sem a coluna `id` — para excluir uma coluna. */
export function semColuna(campo, id) {
  return (campo?.config?.options || []).filter((o) => o.id !== id).map((o) => ({ ...o }));
}

/** As opções com `id` renomeada ou recolorida. */
export function colunaAlterada(campo, id, patch = {}) {
  return (campo?.config?.options || []).map((o) => (
    o.id === id
      ? { ...o, ...(patch.name ? { name: String(patch.name).trim() || o.name } : {}),
          ...(patch.color ? { color: patch.color } : {}) }
      : { ...o }
  ));
}

/**
 * Os campos que aparecem na frente do card.
 *
 * O card não é a ficha: é a lombada dela. Mostra o que identifica e o que
 * decide — nunca o campo de colunas (a coluna já diz), nunca o principal
 * (é o título do card), e no máximo `max`, porque um card com dez linhas
 * deixa de caber na coluna e o quadro perde a leitura de funil. O resto
 * está a um clique, na ficha.
 */
export function camposDoCartao(campos = [], { campoDeColuna = null, visiveis = null, max = 4 } = {}) {
  const permitidos = visiveis ? new Set(visiveis) : null;
  return campos
    .filter((c) => !c.is_primary)
    .filter((c) => c.key !== campoDeColuna?.key)
    .filter((c) => (permitidos ? permitidos.has(c.key) : true))
    .slice(0, max);
}
