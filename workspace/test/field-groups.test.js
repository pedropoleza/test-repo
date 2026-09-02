/**
 * Grupos de campos personalizados.
 *
 * Duas regras seguram tudo:
 *
 * 1. Onde HÁ convenção de prefixo, ela é lida — é o que transforma 50
 *    campos numa parede única em sete gavetas com sentido.
 * 2. Onde NÃO há, nada muda. Medido: a conta da Daniely tem 115 campos e
 *    nenhum prefixo. Um agrupamento adivinhado ali separaria campos que
 *    andam juntos, e seria pior que a parede.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectarGrupos, gruposDaPipeline, chavesDosGrupos,
} from "../src/shared/field-groups.js";

const campo = (name, key = name) => ({ key, name });

/* ---------------- detectar a convenção ---------------- */

test("lê os prefixos de uma conta que os usa", () => {
  const { grupos, soltos, usaConvencao } = detectarGrupos([
    campo("Seg · Carrier"), campo("Seg · Prêmio"), campo("Seg · Vigência"),
    campo("Emp · EIN"), campo("Emp · Nome Legal"),
    campo("Monthly Premium"),
  ]);
  assert.equal(usaConvencao, true);
  assert.deepEqual(grupos.map((g) => g.nome), ["Seg", "Emp"]);
  assert.deepEqual(grupos[0].campos.map((c) => c.curto), ["Carrier", "Prêmio", "Vigência"]);
  assert.deepEqual(soltos.map((c) => c.name), ["Monthly Premium"]);
});

test("o nome curto some o prefixo, mas o campo original fica intacto", () => {
  // A tabela mostra "Carrier" dentro da gaveta "Seg"; o CRM continua
  // chamando o campo de "Seg · Carrier", e é por esse nome que gravamos.
  const { grupos } = detectarGrupos([
    campo("Seg · Carrier", "cf_1"), campo("Seg · Prêmio", "cf_2"),
    campo("Emp · EIN", "cf_3"), campo("Emp · Nome Legal", "cf_4"),
  ]);
  const c = grupos[0].campos[0];
  assert.equal(c.curto, "Carrier");
  assert.equal(c.name, "Seg · Carrier");
  assert.equal(c.key, "cf_1");
});

test("dois-pontos também é convenção", () => {
  const { grupos, usaConvencao } = detectarGrupos([
    campo("Seg: Carrier"), campo("Seg: Prêmio"),
    campo("Emp: EIN"), campo("Emp: Nome Legal"),
  ]);
  assert.equal(usaConvencao, true);
  assert.equal(grupos.length, 2);
});

test("hífen NÃO é convenção", () => {
  // "Follow-up" e "E-mail" viveriam como gaveta "Follow" e gaveta "E".
  const { grupos, usaConvencao } = detectarGrupos([
    campo("Follow-up date"), campo("Follow-up owner"),
    campo("E-mail secundário"), campo("E-mail do cônjuge"),
  ]);
  assert.equal(usaConvencao, false);
  assert.equal(grupos.length, 0);
});

test("prefixo que aparece uma vez só não vira gaveta", () => {
  const { grupos, soltos } = detectarGrupos([
    campo("Seg · Carrier"), campo("Seg · Prêmio"), campo("Seg · Vigência"),
    campo("Emp · EIN"), campo("Emp · Nome Legal"),
    campo("Único · Coisa"),
  ]);
  assert.deepEqual(grupos.map((g) => g.nome), ["Seg", "Emp"]);
  // E volta com o nome ORIGINAL: cortar o prefixo de um campo que não
  // está em gaveta nenhuma o deixaria sem contexto.
  assert.ok(soltos.some((c) => c.name === "Único · Coisa"));
});

test("uma gaveta só não é convenção", () => {
  const { usaConvencao, soltos } = detectarGrupos([
    campo("Seg · Carrier"), campo("Seg · Prêmio"),
    campo("Nome"), campo("Idade"), campo("Cidade"),
  ]);
  assert.equal(usaConvencao, false);
  assert.equal(soltos.length, 5, "todos voltam intactos");
});

test("convenção rala no meio de uma base grande não conta", () => {
  // Quatro campos prefixados em cem é exceção, não organização: daria
  // duas gavetas minúsculas ao lado de uma pilha de 96 "outros".
  const muitos = Array.from({ length: 96 }, (_, i) => campo(`Campo ${i}`, `k${i}`));
  const { usaConvencao } = detectarGrupos([
    ...muitos,
    campo("Seg · A"), campo("Seg · B"), campo("Emp · C"), campo("Emp · D"),
  ]);
  assert.equal(usaConvencao, false);
});

test("conta sem convenção nenhuma passa inteira, sem perder campo", () => {
  const campos = ["Monthly Premium", "Underwriting Status", "Next Follow-up"].map((n) => campo(n));
  const { grupos, soltos, usaConvencao } = detectarGrupos(campos);
  assert.equal(usaConvencao, false);
  assert.equal(grupos.length, 0);
  assert.deepEqual(soltos.map((c) => c.name), campos.map((c) => c.name));
});

test("lista vazia não quebra", () => {
  assert.deepEqual(detectarGrupos([]), { grupos: [], soltos: [], usaConvencao: false });
  assert.deepEqual(detectarGrupos(), { grupos: [], soltos: [], usaConvencao: false });
});

/* ---------------- ligar grupo e pipeline ---------------- */

/** As sete gavetas e as seis pipelines da conta real. */
function contaReal() {
  const nomes = [
    "Seg · Carrier", "Seg · Prêmio", "Seg · Nº da Apólice", "Seg · Vigência",
    "Seg · Tipo", "Seg · Data da Última Auditoria",
    "Emp · EIN", "Emp · Nome Legal", "Emp · Data de Abertura", "Emp · Tipo",
    "Cons · Nº do Passaporte", "Cons · Data do Protocolo", "Cons · Data de Envio",
    "Trad · Idioma", "Trad · Destino", "Trad · Prazo Prometido",
    "MV · Placa", "MV · VIN", "MV · Marca/Modelo/Ano", "MV · Vencimento do Registration",
    "Jur · Tipo de Caso", "Jur · Advogado Responsável", "Jur · Comissão Prevista",
    "POBox · Nº da Caixa", "POBox · Valor", "POBox · Vencimento",
    "Monthly Premium", "Underwriting Status", "Next Policy Anniversary",
  ];
  return detectarGrupos(nomes.map((n, i) => campo(n, `cf_${i}`)));
}

test("as seis pipelines da conta real encontram as gavetas certas", () => {
  const { grupos } = contaReal();
  const esperado = {
    "1 · Seguro de Vida — Prospects": ["Seg"],
    "2 · Apólices Ativas": ["Seg"],
    "3 · Empresas e Fiscal": ["Emp"],
    "4 · Consulares e Traduções": ["Cons", "Trad"],
    "5 · Registros e Motor Vehicle": ["MV"],
    "6 · Casos Jurídicos": ["Jur"],
  };
  for (const [pipeline, ids] of Object.entries(esperado)) {
    assert.deepEqual(gruposDaPipeline(pipeline, grupos).map((g) => g.id), ids, pipeline);
  }
});

test("uma pipeline pode ter duas gavetas", () => {
  // "Consulares e Traduções" é mesmo duas frentes de trabalho. Devolver
  // só a primeira esconderia metade do serviço dela.
  const { grupos } = contaReal();
  assert.equal(gruposDaPipeline("4 · Consulares e Traduções", grupos).length, 2);
});

test("iniciais casam onde o prefixo não é pedaço de palavra", () => {
  const { grupos } = contaReal();
  assert.deepEqual(gruposDaPipeline("Motor Vehicle", grupos).map((g) => g.id), ["MV"]);
});

test("quando o prefixo não lembra a pipeline, o conteúdo da gaveta liga", () => {
  // "Apólices Ativas" não começa com "Seg" — o elo é "Seg · Nº da
  // Apólice", que fala de apólice.
  const { grupos } = contaReal();
  assert.deepEqual(gruposDaPipeline("2 · Apólices Ativas", grupos).map((g) => g.id), ["Seg"]);
});

test("palavra genérica não liga gaveta nenhuma", () => {
  // "Data" e "Tipo" aparecem em quase toda gaveta: ligar por elas
  // colocaria todos os campos em todas as tabelas.
  const { grupos } = contaReal();
  assert.deepEqual(gruposDaPipeline("Tipos e Datas", grupos), []);
});

test("pipeline sem relação com nada devolve vazio", () => {
  const { grupos } = contaReal();
  for (const nome of ["Marketing", "", null, "0. old Prospects"]) {
    assert.deepEqual(gruposDaPipeline(nome, grupos), [], `"${nome}"`);
  }
});

test("sem gavetas, nenhuma pipeline recebe coluna extra", () => {
  // É o caso da conta sem convenção: as tabelas seguem como eram.
  assert.deepEqual(gruposDaPipeline("2- Policies", []), []);
});

test("chavesDosGrupos devolve as chaves na ordem das gavetas", () => {
  const { grupos } = contaReal();
  const dois = gruposDaPipeline("4 · Consulares e Traduções", grupos);
  const chaves = chavesDosGrupos(dois);
  assert.equal(chaves.length, dois[0].campos.length + dois[1].campos.length);
  assert.ok(chaves.every((k) => k.startsWith("cf_")));
  assert.deepEqual(chavesDosGrupos([]), []);
});
