/**
 * Grupos de campos personalizados.
 *
 * Uma conta com 50 campos personalizados mostra 50 campos em toda ficha
 * e toda tabela. Só que eles não valem todos ao mesmo tempo: os de
 * apólice não dizem nada num caso jurídico, e vice-versa.
 *
 * Algumas contas já resolveram isso no CRM, nomeando os campos com um
 * prefixo — "Seg · Carrier", "Emp · EIN", "MV · Placa". A convenção
 * existe no dado; o app é que a ignorava. Este módulo a lê.
 *
 * NÃO inventa grupo onde não há convenção. Medido: a conta da Daniely
 * tem 115 campos e nenhum prefixo — lá isto devolve zero grupos e todas
 * as telas seguem exatamente como eram. Um agrupamento adivinhado por
 * heurística seria pior que nenhum: separaria campos que andam juntos.
 */

/**
 * O separador tem que ser visualmente deliberado. Aceitamos "·" e ":",
 * que são escolhas de quem organiza; NÃO aceitamos "-", que aparece em
 * nome comum ("Follow-up", "E-mail") e transformaria meia base em grupo.
 */
const RE_PREFIXO = new RegExp("^\\s*([\\p{L}\\p{N}][\\p{L}\\p{N} ]{0,14}?)\\s*[·:]\\s*(.+)$", "u");

/** Abaixo disso, o prefixo é coincidência de nome, não convenção. */
const MINIMO_POR_GRUPO = 2;

/**
 * Quanto da base precisa seguir a convenção para ela contar como
 * convenção. Dois campos prefixados no meio de cem são exceção, não
 * organização — e agrupar por eles daria uma gaveta minúscula ao lado
 * de uma pilha de "outros".
 */
const COBERTURA_MINIMA = 0.25;

function separar(nome) {
  const m = RE_PREFIXO.exec(String(nome || ""));
  if (!m) return null;
  const prefixo = m[1].trim();
  const resto = m[2].trim();
  if (!prefixo || !resto) return null;
  return { prefixo, resto };
}

/**
 * Os grupos de uma lista de campos.
 *
 * Devolve `{ grupos, soltos, usaConvencao }` — `grupos` na ordem em que
 * os prefixos aparecem, cada um `{ id, nome, campos }`; `soltos` são os
 * campos sem prefixo, que continuam existindo e aparecendo.
 */
export function detectarGrupos(campos = []) {
  const porPrefixo = new Map();
  const soltos = [];

  for (const campo of campos) {
    const partido = separar(campo?.name);
    if (!partido) { soltos.push(campo); continue; }
    if (!porPrefixo.has(partido.prefixo)) porPrefixo.set(partido.prefixo, []);
    porPrefixo.get(partido.prefixo).push({ ...campo, curto: partido.resto });
  }

  // Prefixo que aparece uma vez só não é gaveta: é um campo com nome
  // composto. Volta para os soltos com o nome original intacto.
  const grupos = [];
  for (const [prefixo, lista] of porPrefixo) {
    if (lista.length < MINIMO_POR_GRUPO) {
      for (const c of lista) soltos.push(campos.find((o) => o.key === c.key) || c);
      continue;
    }
    grupos.push({ id: prefixo, nome: prefixo, campos: lista });
  }

  const agrupados = grupos.reduce((n, g) => n + g.campos.length, 0);
  const usaConvencao = campos.length > 0
    && grupos.length >= 2
    && agrupados / campos.length >= COBERTURA_MINIMA;

  if (!usaConvencao) return { grupos: [], soltos: [...campos], usaConvencao: false };
  return { grupos, soltos, usaConvencao: true };
}

const RE_DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

const normal = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(RE_DIACRITICOS, "").trim();

/** Tamanho do radical usado na busca por conteúdo. Cinco letras separam
 *  "apólice" de "aposentadoria" e ainda absorvem plural e gênero. */
const RADICAL_MINIMO = 5;

/** As iniciais das palavras: "Motor Vehicle" → "mv". */
function iniciais(frase) {
  return normal(frase).split(/[^a-z0-9]+/).filter(Boolean).map((p) => p[0]).join("");
}

/**
 * Os grupos que pertencem a uma pipeline, pelo nome dela.
 *
 * Casa de dois jeitos, ambos verificados contra a conta real:
 *
 *  - por começo de palavra — "Emp" casa com "Empresas e Fiscal",
 *    "Cons" com "Consulares", "Trad" com "Traduções", "Jur" com
 *    "Jurídicos";
 *  - por iniciais — "MV" casa com "Motor Vehicle".
 *
 * Devolve TODOS os que casam, não o primeiro: a pipeline "Consulares e
 * Traduções" é mesmo duas gavetas, e mostrar só uma esconderia metade
 * do trabalho dela.
 */
export function gruposDaPipeline(nomeDaPipeline, grupos = []) {
  const palavras = normal(nomeDaPipeline).split(/[^a-z0-9]+/).filter(Boolean);
  const sigla = iniciais(nomeDaPipeline);

  const porNome = grupos.filter((g) => {
    const p = normal(g.id);
    if (!p) return false;
    if (palavras.some((w) => w.startsWith(p))) return true;
    // Iniciais só valem com 2+ letras: um prefixo de uma letra casaria
    // com quase toda pipeline.
    return p.length >= 2 && sigla.includes(p);
  });
  if (porNome.length) return porNome;

  // O prefixo nem sempre lembra a pipeline: os campos de "2 · Apólices
  // Ativas" são os "Seg ·", e "Apólices" não começa com "Seg". Aí o elo
  // está DENTRO do grupo — "Seg · Nº da Apólice" fala de apólice.
  //
  // Só vale um radical longo e exclusivo: se duas gavetas mencionam a
  // mesma palavra, ela não distingue nada e a associação seria chute.
  const porConteudo = new Map();
  for (const palavra of palavras) {
    if (palavra.length < RADICAL_MINIMO) continue;
    const radical = palavra.slice(0, RADICAL_MINIMO);
    const candidatos = grupos.filter((g) =>
      g.campos.some((c) => normal(c.curto || c.name).split(/[^a-z0-9]+/)
        .some((w) => w.startsWith(radical))));
    if (candidatos.length === 1) porConteudo.set(candidatos[0].id, candidatos[0]);
  }
  return [...porConteudo.values()];
}

/** As chaves dos campos de um conjunto de grupos, na ordem dos grupos. */
export function chavesDosGrupos(grupos = []) {
  return grupos.flatMap((g) => g.campos.map((c) => c.key));
}
