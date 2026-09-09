/**
 * @menções em texto livre.
 *
 * Um comentário é texto comum onde "@Nome" vira uma menção a um membro do
 * time. Compartilhado entre browser (para destacar e para o autocomplete)
 * e servidor (para guardar quem foi citado). A lista de nomes vem dos
 * usuários do GHL, então a menção casa com gente que existe na conta — e
 * degrada para texto puro numa conta sem usuários.
 *
 * O casamento é pelo nome exato precedido de "@", do nome mais longo para
 * o mais curto (para "@Ana Paula" não ser cortado em "@Ana"), respeitando
 * fronteira de palavra no fim (para "@Ana" não casar dentro de "@Anabela").
 */

const LETRA = /[\p{L}\p{N}_]/u;

/**
 * Quebra o texto em segmentos `{ tipo: "texto"|"mencao", valor }`. Nos de
 * menção, `valor` é o nome citado (sem o @). Serve para renderizar: texto
 * como texto, menção como chip.
 */
export function segmentar(texto = "", nomes = []) {
  const ordenados = [...new Set(nomes.filter(Boolean))].sort((a, b) => b.length - a.length);
  const segs = [];
  let buffer = "";
  const flush = () => { if (buffer) { segs.push({ tipo: "texto", valor: buffer }); buffer = ""; } };

  for (let i = 0; i < texto.length;) {
    if (texto[i] === "@") {
      const resto = texto.slice(i + 1);
      const nome = ordenados.find((n) =>
        resto.startsWith(n) && !LETRA.test(resto[n.length] || ""));
      if (nome) {
        flush();
        segs.push({ tipo: "mencao", valor: nome });
        i += 1 + nome.length;
        continue;
      }
    }
    buffer += texto[i];
    i += 1;
  }
  flush();
  return segs;
}

/**
 * Os usuários citados no texto, na ordem da lista de usuários. Usa a
 * mesma regra de casamento de `segmentar`, então o que fica destacado na
 * tela é exatamente o que se guarda como menção.
 */
export function mencoesEm(texto = "", usuarios = []) {
  const nomes = usuarios.map((u) => u.name).filter(Boolean);
  const citados = new Set(
    segmentar(texto, nomes).filter((s) => s.tipo === "mencao").map((s) => s.valor),
  );
  return usuarios.filter((u) => citados.has(u.name));
}

/**
 * O trecho de menção em digitação: se o cursor está logo depois de um
 * "@algo" (sem espaço), devolve `{ termo, inicio }` para o autocomplete;
 * senão, null. `inicio` é o índice do "@", para substituir ao escolher.
 */
export function mencaoEmDigitacao(texto = "", cursor = texto.length) {
  const antes = texto.slice(0, cursor);
  const at = antes.lastIndexOf("@");
  if (at < 0) return null;
  // Nada de espaço/quebra entre o @ e o cursor, e o @ abre palavra
  // (início do texto ou precedido de espaço).
  const trecho = antes.slice(at + 1);
  if (/\s/.test(trecho)) return null;
  const anterior = antes[at - 1];
  if (anterior && LETRA.test(anterior)) return null;
  return { termo: trecho, inicio: at };
}

/** Os usuários cujo nome começa com `termo` (case-insensitive). Vazio = todos. */
export function sugerir(termo = "", usuarios = [], limite = 6) {
  const t = termo.trim().toLowerCase();
  const base = t
    ? usuarios.filter((u) => (u.name || "").toLowerCase().includes(t))
    : usuarios;
  return base.slice(0, limite);
}
