/**
 * Quadro de database — as colunas do funil.
 *
 * O que precisa valer:
 *
 * 1. Coluna vazia continua na tela: num funil, "0 aqui" é informação, e
 *    é onde se solta o card para chegar lá.
 * 2. A ordem das colunas é a que a pessoa definiu nas opções.
 * 3. Card com valor órfão (a opção foi apagada) não some do quadro.
 * 4. Criar coluna nunca colide id, nem com nome repetido.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  colunasDoQuadro, campoDeColunas, camposPossiveis, podeRegerQuadro,
  novaColuna, semColuna, colunaAlterada, camposDoCartao, SEM_COLUNA,
  tamanhoDoCard, TAMANHOS_DO_CARD,
} from "../src/shared/board-db.js";

const etapas = {
  key: "etapa", name: "Etapas Closer", type: "select",
  config: {
    options: [
      { id: "reuniao", name: "Reunião com a Dani", color: "orange" },
      { id: "sinal",   name: "Sinal Verde",        color: "green" },
      { id: "pre",     name: "Pré-aplicação",      color: "blue" },
    ],
  },
};

const reg = (id, etapa) => ({ id, title: `Lead ${id}`, properties: etapa ? { etapa } : {} });

/* ---------------- colunas ---------------- */

test("as colunas saem na ordem das opções, incluindo as vazias", () => {
  const colunas = colunasDoQuadro([reg("a", "reuniao")], etapas);
  assert.deepEqual(colunas.map((c) => c.nome),
    ["Reunião com a Dani", "Sinal Verde", "Pré-aplicação"]);
  assert.deepEqual(colunas.map((c) => c.records.length), [1, 0, 0]);
});

test("a coluna vazia carrega a cor e o id da própria opção", () => {
  const sinal = colunasDoQuadro([], etapas).find((c) => c.id === "sinal");
  assert.equal(sinal.cor, "green");
  assert.equal(sinal.records.length, 0);
});

test("card sem etapa cai numa coluna 'Sem …' no fim", () => {
  const colunas = colunasDoQuadro([reg("a", "reuniao"), reg("b")], etapas);
  const ultima = colunas[colunas.length - 1];
  assert.equal(ultima.id, SEM_COLUNA);
  assert.equal(ultima.nome, "Sem etapas closer");
  assert.equal(ultima.records.length, 1);
});

test("sem card solto, a coluna 'Sem …' não aparece", () => {
  // Ela é uma pendência, não uma etapa do funil: vazia, é só ruído.
  const colunas = colunasDoQuadro([reg("a", "sinal")], etapas);
  assert.ok(colunas.every((c) => c.id !== SEM_COLUNA));
});

test("card com opção apagada não some do quadro", () => {
  // Regressão: apagar a coluna não pode sumir com o lead que estava
  // nela — ele vira pendência, visível, para ser realocado.
  const colunas = colunasDoQuadro([reg("a", "etapa_que_nao_existe_mais")], etapas);
  const soltos = colunas.find((c) => c.id === SEM_COLUNA);
  assert.equal(soltos.records.length, 1);
});

/* ---------------- qual campo rege ---------------- */

test("só seleção e status podem reger um quadro", () => {
  assert.equal(podeRegerQuadro(etapas), true);
  assert.equal(podeRegerQuadro({ type: "status", config: {} }), true);
  // Multi-seleção duplicaria o card em duas colunas; texto criaria
  // colunas que ninguém recria arrastando.
  assert.equal(podeRegerQuadro({ type: "multi_select" }), false);
  assert.equal(podeRegerQuadro({ type: "text" }), false);
  assert.equal(podeRegerQuadro(null), false);
});

test("o quadro usa o agrupamento da vista quando ele serve", () => {
  const campos = [{ key: "nome", type: "text" }, etapas, { key: "fonte", type: "select", config: {} }];
  assert.equal(campoDeColunas(campos, "fonte").key, "fonte");
  assert.equal(campoDeColunas(campos, "etapa").key, "etapa");
  // Agrupamento que não serve cai no primeiro candidato, em vez de
  // deixar a tela em branco.
  assert.equal(campoDeColunas(campos, "nome").key, "etapa");
  assert.equal(campoDeColunas(campos, null).key, "etapa");
  assert.equal(campoDeColunas([{ key: "nome", type: "text" }]), null);
  assert.deepEqual(camposPossiveis(campos).map((c) => c.key), ["etapa", "fonte"]);
});

/* ---------------- criar, renomear e excluir coluna ---------------- */

test("nova coluna entra no fim com cor própria", () => {
  const { options, option } = novaColuna(etapas, "Aplicação");
  assert.equal(options.length, 4);
  assert.equal(options[3].name, "Aplicação");
  assert.equal(option.id, "aplicacao");
  assert.ok(option.color);
});

test("nome repetido vira coluna própria, com id próprio", () => {
  // Duas colunas com o mesmo nome ainda são duas colunas; colidir o id
  // juntaria os cards das duas em silêncio.
  const { options } = novaColuna(etapas, "Sinal Verde");
  const ids = options.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[3], "sinal_verde");
});

test("nome vazio ainda cria uma coluna utilizável", () => {
  const { option } = novaColuna(etapas, "   ");
  assert.equal(option.name, "Nova coluna");
});

test("excluir e renomear coluna mexem só na opção certa", () => {
  assert.deepEqual(semColuna(etapas, "sinal").map((o) => o.id), ["reuniao", "pre"]);
  const alterado = colunaAlterada(etapas, "sinal", { name: "Sinal verde ✅", color: "purple" });
  assert.equal(alterado[1].name, "Sinal verde ✅");
  assert.equal(alterado[1].color, "purple");
  assert.equal(alterado[0].name, "Reunião com a Dani");
});

/* ---------------- a definição da etapa ---------------- */

test("a coluna carrega a definição da etapa", () => {
  // "Em decisão" não diz nada sozinho; "cliente disse vou pensar" diz.
  const campo = { key: "e", name: "Etapa", type: "select", config: { options: [
    { id: "d", name: "Em decisão", color: "yellow",
      description: "Cliente disse “vou pensar” ou precisa falar com o cônjuge." },
    { id: "x", name: "Sem nota", color: "gray" },
  ] } };
  const [decisao, sem] = colunasDoQuadro([], campo);
  assert.match(decisao.descricao, /vou pensar/);
  assert.equal(sem.descricao, null);
});

test("renomear e recolorir não apagam a definição", () => {
  const campo = { key: "e", name: "Etapa", type: "select", config: { options: [
    { id: "d", name: "Em decisão", color: "yellow", description: "Vai pensar." },
  ] } };
  const [o] = colunaAlterada(campo, "d", { name: "Em análise", color: "orange" });
  assert.equal(o.description, "Vai pensar.");
  assert.equal(o.name, "Em análise");
});

test("definição em branco apaga a nota, em vez de guardar vazio", () => {
  const campo = { key: "e", name: "Etapa", type: "select", config: { options: [
    { id: "d", name: "Em decisão", color: "yellow", description: "Vai pensar." },
  ] } };
  const [o] = colunaAlterada(campo, "d", { description: "   " });
  assert.equal("description" in o, false);
});

test("coluna nova pode já nascer com a definição", () => {
  const campo = { key: "e", name: "Etapa", type: "select", config: { options: [] } };
  const { option } = novaColuna(campo, "Underwriting", "A seguradora está analisando.");
  assert.equal(option.description, "A seguradora está analisando.");
  assert.equal(novaColuna(campo, "Sem nota").option.description, undefined);
});

/* ---------------- a frente do card ---------------- */

test("por padrão o card mostra TODOS os campos, não os quatro primeiros", () => {
  // O que foi escrito na ficha tem que aparecer no card. Um teto fixo
  // escondia o estado e a objeção e obrigava a abrir ficha por ficha
  // para lembrar quem era cada lead — o quadro deixava de servir.
  const campos = [
    { key: "nome", type: "text", is_primary: true },
    etapas,
    ...["tel", "estado", "valor", "interesse", "perfil", "objecoes"]
      .map((key) => ({ key, type: "text" })),
  ];
  assert.deepEqual(
    camposDoCartao(campos, { campoDeColuna: etapas }).map((c) => c.key),
    ["tel", "estado", "valor", "interesse", "perfil", "objecoes"]);
});

test("os três tamanhos de card", () => {
  assert.equal(tamanhoDoCard(null).id, "completo", "o padrão mostra tudo");
  assert.equal(tamanhoDoCard({ cardSize: "compacto" }).max, 0);
  assert.equal(tamanhoDoCard({ cardSize: "medio" }).max, 3);
  assert.equal(tamanhoDoCard({ cardSize: "completo" }).max, Infinity);
  // Valor desconhecido (vista antiga, dedo errado) não quebra a tela.
  assert.equal(tamanhoDoCard({ cardSize: "gigante" }).id, "completo");
  assert.equal(Object.keys(TAMANHOS_DO_CARD).length, 3);
});

test("tamanho compacto deixa o card só com o nome", () => {
  const campos = [{ key: "nome", type: "text", is_primary: true }, { key: "tel", type: "phone" }];
  assert.deepEqual(camposDoCartao(campos, { max: 0 }), []);
});

test("o card não repete o título nem a coluna, e tem teto", () => {
  const campos = [
    { key: "nome", type: "text", is_primary: true },
    etapas,
    { key: "tel", type: "phone" }, { key: "estado", type: "text" },
    { key: "valor", type: "number" }, { key: "interesse", type: "text" },
    { key: "perfil", type: "text" },
  ];
  const mostrados = camposDoCartao(campos, { campoDeColuna: etapas, max: 4 });
  assert.deepEqual(mostrados.map((c) => c.key), ["tel", "estado", "valor", "interesse"]);
});

test("o card respeita as colunas visíveis da vista", () => {
  const campos = [
    { key: "nome", type: "text", is_primary: true },
    { key: "tel", type: "phone" }, { key: "estado", type: "text" },
  ];
  assert.deepEqual(
    camposDoCartao(campos, { visiveis: ["estado"] }).map((c) => c.key), ["estado"]);
});
