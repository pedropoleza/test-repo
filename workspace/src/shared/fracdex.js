/**
 * Fractional indexing — ordenação de irmãos sem reescrever a lista.
 *
 * Uma chave é uma string base62 cuja ordem LEXICOGRÁFICA é a ordem de
 * exibição. Para inserir entre A e B basta gerar uma chave entre as duas;
 * nenhum outro registro é tocado. É isso que permite reordenar blocos e
 * páginas com um único UPDATE (§11).
 *
 * O alfabeto está em ordem ASCII crescente (0-9, A-Z, a-z), então
 * comparação de string em JS e em Postgres (collation C) concordam com a
 * ordem numérica dos dígitos.
 *
 * Compartilhado entre browser e servidor: o editor precisa da MESMA chave
 * para renderizar de forma otimista antes da resposta da API.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 62

function digitAt(s, i) {
  const idx = DIGITS.indexOf(s[i]);
  if (idx < 0) throw new Error(`invalid position key: ${JSON.stringify(s)}`);
  return idx;
}

/**
 * Gera uma chave estritamente entre `lower` e `upper`.
 * `lower`/`upper` podem ser null/'' para indicar "sem limite".
 */
export function keyBetween(lower, upper) {
  const lo = lower || "";
  const hi = upper || "";
  if (lo && hi && lo >= hi) {
    throw new Error(`keyBetween: out of order (${lo} >= ${hi})`);
  }

  let out = "";
  let bounded = hi.length > 0;
  let i = 0;

  for (;;) {
    const dLo = i < lo.length ? digitAt(lo, i) : 0;
    const dHi = bounded ? (i < hi.length ? digitAt(hi, i) : 0) : BASE;

    if (dLo === dHi) {
      // Prefixo comum: copia o dígito e desce um nível.
      out += DIGITS[dLo];
      i += 1;
      continue;
    }

    const mid = Math.floor((dLo + dHi) / 2);
    if (mid > dLo) return out + DIGITS[mid];

    // dHi === dLo + 1: não há dígito no meio. Fixa o dígito de `lo`, o que
    // já torna o resultado menor que `hi`, e segue sem limite superior.
    out += DIGITS[dLo];
    i += 1;
    bounded = false;
  }
}

/** Chave para o primeiro item de uma lista vazia. */
export function firstKey() {
  return keyBetween(null, null);
}

/**
 * Gera `count` chaves consecutivas entre lower e upper.
 * Usado em import/duplicação, onde inserimos vários irmãos de uma vez.
 */
export function keysBetween(lower, upper, count) {
  const out = [];
  let prev = lower || null;
  for (let i = 0; i < count; i += 1) {
    prev = keyBetween(prev, upper || null);
    out.push(prev);
  }
  return out;
}

/** Ordena uma lista de registros pelo campo `position`. */
export function byPosition(a, b) {
  if (a.position === b.position) return a.id < b.id ? -1 : 1;
  return a.position < b.position ? -1 : 1;
}

export const POSITION_ALPHABET = DIGITS;
