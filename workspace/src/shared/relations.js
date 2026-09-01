/**
 * Parentescos e associações entre contatos.
 *
 * Compartilhado entre browser e servidor: a lista de rótulos e a regra de
 * inversão precisam ser as mesmas nos dois lados, senão a ficha do filho
 * mostraria um parentesco e a do pai, outro.
 *
 * Cada relação tem seu INVERSO. Marcar "João é filho de Maria" grava
 * também "Maria é mãe de João" — nenhuma das duas fichas pode esquecer a
 * outra, e a consulta vira uma leitura direta por contato.
 */

export const RELATIONS = [
  { id: "conjuge",   nome: "Cônjuge",      inverso: "conjuge" },
  { id: "filho",     nome: "Filho(a)",     inverso: "pai_mae" },
  { id: "pai_mae",   nome: "Pai/Mãe",      inverso: "filho" },
  { id: "irmao",     nome: "Irmão(ã)",     inverso: "irmao" },
  { id: "avo",       nome: "Avô/Avó",      inverso: "neto" },
  { id: "neto",      nome: "Neto(a)",      inverso: "avo" },
  { id: "sobrinho",  nome: "Sobrinho(a)",  inverso: "tio" },
  { id: "tio",       nome: "Tio(a)",       inverso: "sobrinho" },
  { id: "primo",     nome: "Primo(a)",     inverso: "primo" },
  { id: "responsavel", nome: "Responsável legal", inverso: "dependente" },
  { id: "dependente",  nome: "Dependente",       inverso: "responsavel" },
  { id: "socio",     nome: "Sócio(a)",     inverso: "socio" },
  { id: "indicou",   nome: "Indicou",      inverso: "indicado_por" },
  { id: "indicado_por", nome: "Indicado(a) por", inverso: "indicou" },
  { id: "outro",     nome: "Outro vínculo", inverso: "outro" },
];

const PORID = new Map(RELATIONS.map((r) => [r.id, r]));

export function isRelation(id) {
  return PORID.has(id);
}

export function relationName(id) {
  return PORID.get(id)?.nome || "Vínculo";
}

/**
 * O rótulo do outro lado. "João é FILHO de Maria" implica "Maria é
 * PAI/MÃE de João" — sem isso a ficha de Maria mostraria o filho como
 * filho dela mesma.
 */
export function inverseRelation(id) {
  return PORID.get(id)?.inverso || "outro";
}

/** Agrupa por parentesco, na ordem em que RELATIONS os declara. */
export function groupRelations(lista = []) {
  const grupos = new Map();
  for (const rel of RELATIONS) {
    const doTipo = lista.filter((l) => l.relation === rel.id);
    if (doTipo.length) grupos.set(rel.id, { relation: rel.id, nome: rel.nome, itens: doTipo });
  }
  // Rótulo desconhecido (gravado por uma versão futura) não pode sumir da
  // tela: entra num grupo próprio em vez de ser descartado.
  const conhecidos = new Set(RELATIONS.map((r) => r.id));
  const orfaos = lista.filter((l) => !conhecidos.has(l.relation));
  if (orfaos.length) grupos.set("__outros__", { relation: "outro", nome: "Outros", itens: orfaos });
  return [...grupos.values()];
}
