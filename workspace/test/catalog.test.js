/**
 * Catálogo de serviços.
 *
 * O que precisa valer:
 *
 * 1. Os serviços dela resolvem contra a conta viva — pipeline, pasta de
 *    campos e campo de vencimento vindos do GHL, não chumbados.
 * 2. Serviço não é pipeline: o PO Box existe sem funil, pelos campos.
 * 3. Numa conta de outro negócio (a da Daniely), NADA resolve — o
 *    catálogo é conteúdo dela, e ativar por engano mostraria o acordo
 *    errado para outra cliente.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGO, ACORDOS, resolverCatalogo, servicoDaPipeline,
  servicosRecorrentes, arquivoDoAcordo,
} from "../src/shared/catalog.js";

/** As pipelines e campos reais da conta da Samantha (medidos). */
function contaSamantha() {
  const pipelines = [
    { id: "p1", name: "1 · Seguro de Vida — Prospects" },
    { id: "p2", name: "2 · Apólices Ativas" },
    { id: "p3", name: "3 · Empresas e Fiscal" },
    { id: "p4", name: "4 · Consulares e Traduções" },
    { id: "p5", name: "5 · Registros e Motor Vehicle" },
    { id: "p6", name: "6 · Casos Jurídicos" },
  ];
  const nomes = [
    "Seg · Carrier", "Seg · Vigência", "Seg · Nº da Apólice",
    "Emp · EIN", "Emp · Nome Legal", "Emp · Vencimento Annual Report", "Emp · Vencimento da Licença",
    "Cons · Nº do Passaporte", "Cons · Validade do Passaporte", "Cons · Tipo de Documento",
    "Trad · Idioma", "Trad · Destino", "Trad · Prazo Prometido",
    "MV · Placa", "MV · Vencimento do Registration", "MV · VIN",
    "Jur · Tipo de Caso", "Jur · Advogado Responsável",
    "POBox · Nº da Caixa", "POBox · Vencimento", "POBox · Valor",
  ];
  const colunas = nomes.map((name, i) => ({ key: `cf_${i}`, name, source: "ghl_custom_field" }));
  return { pipelines, colunas };
}

/* ---------------- resolução contra a conta viva ---------------- */

test("todos os serviços dela resolvem", () => {
  const { pipelines, colunas } = contaSamantha();
  const cat = resolverCatalogo(pipelines, colunas);
  assert.equal(cat.length, CATALOGO.length);
  const codes = cat.map((s) => s.code);
  for (const esperado of ["seguro-vida", "apolice", "abertura-empresa", "pobox",
    "passaporte", "traducao", "registration", "juridico"]) {
    assert.ok(codes.includes(esperado), `faltou ${esperado}`);
  }
});

test("cada serviço aponta para a pipeline real da conta", () => {
  const { pipelines, colunas } = contaSamantha();
  const cat = resolverCatalogo(pipelines, colunas);
  const byCode = Object.fromEntries(cat.map((s) => [s.code, s]));
  assert.equal(byCode.apolice.pipelineId, "p2");
  assert.equal(byCode["abertura-empresa"].pipelineId, "p3");
  assert.equal(byCode.registration.pipelineId, "p5");
  assert.equal(byCode.juridico.pipelineId, "p6");
});

test("PO Box resolve SEM pipeline, pelos campos", () => {
  // É a prova de que serviço não é pipeline. O PO Box existe porque a
  // conta tem os campos POBox, mesmo sem um funil de PO Box.
  const { pipelines, colunas } = contaSamantha();
  const pobox = resolverCatalogo(pipelines, colunas).find((s) => s.code === "pobox");
  assert.ok(pobox, "PO Box não resolveu");
  assert.equal(pobox.pipelineId, null);
  assert.ok(pobox.campos.length > 0, "PO Box tem que ter campos");
  assert.ok(pobox.vencimentos.some((v) => /vencimento/i.test(v.name)));
});

test("os campos de vencimento são detectados na conta", () => {
  const { pipelines, colunas } = contaSamantha();
  const cat = resolverCatalogo(pipelines, colunas);
  const byCode = Object.fromEntries(cat.map((s) => [s.code, s]));
  assert.ok(byCode.registration.vencimentos.some((v) => /registration/i.test(v.name)));
  assert.ok(byCode["annual-report"].vencimentos.some((v) => /annual report/i.test(v.name)));
  assert.ok(byCode.passaporte.vencimentos.some((v) => /passaporte/i.test(v.name)));
});

test("os recorrentes são exatamente os que têm campo de vencimento", () => {
  const { pipelines, colunas } = contaSamantha();
  const rec = servicosRecorrentes(resolverCatalogo(pipelines, colunas)).map((s) => s.code).sort();
  assert.deepEqual(rec,
    ["annual-report", "apolice", "licenca-contratista", "passaporte", "pobox", "registration"]);
});

/* ---------------- documentos e acordos ---------------- */

test("cada serviço com acordo aponta para um PDF real", () => {
  const { pipelines, colunas } = contaSamantha();
  const cat = resolverCatalogo(pipelines, colunas);
  for (const s of cat) {
    for (const acordo of s.documentos.acordos) {
      assert.ok(ACORDOS[acordo.id], `acordo ${acordo.id} não existe`);
      // Um PDF de verdade (string) ou por idioma (objeto).
      assert.ok(acordo.arquivo, `${acordo.id} sem arquivo`);
    }
  }
});

test("o acordo de divórcio existe nos três idiomas", () => {
  assert.equal(arquivoDoAcordo(ACORDOS.divorce, "pt"), "Divorce Agreement- Portuguese.pdf");
  assert.equal(arquivoDoAcordo(ACORDOS.divorce, "en"), "DIVORCE AGREEMENT- ENGLISH.pdf");
  assert.equal(arquivoDoAcordo(ACORDOS.divorce, "es"), "Divorce Agreement-Spanish.pdf");
});

test("acordo só em inglês cai no inglês quando pedem outro idioma", () => {
  // O contrato de PO Box só existe em inglês; pedir em português devolve
  // o inglês, não um nulo que quebraria a geração.
  assert.equal(arquivoDoAcordo(ACORDOS.pobox, "pt"), "PO Box Service Agreement.pdf");
  assert.equal(arquivoDoAcordo(ACORDOS.pobox, "en"), "PO Box Service Agreement.pdf");
});

test("a abertura de empresa planta o annual report", () => {
  // O plano dela: abrir a empresa gera a recorrência do annual report.
  const { pipelines, colunas } = contaSamantha();
  const empresa = resolverCatalogo(pipelines, colunas).find((s) => s.code === "abertura-empresa");
  assert.deepEqual(empresa.planta, ["annual-report"]);
});

/* ---------------- ligar pipeline e serviço ---------------- */

test("servicoDaPipeline acha o serviço pela pipeline", () => {
  const { pipelines, colunas } = contaSamantha();
  const cat = resolverCatalogo(pipelines, colunas);
  assert.equal(servicoDaPipeline("2 · Apólices Ativas", cat)?.code, "apolice");
  assert.equal(servicoDaPipeline("6 · Casos Jurídicos", cat)?.code, "juridico");
  assert.equal(servicoDaPipeline("Pipeline Inexistente", cat), null);
});

/* ---------------- degradação numa conta de outro negócio ---------------- */

test("a conta da Daniely (sem convenção) não ativa nenhum serviço", () => {
  // O catálogo é conteúdo do negócio da Samantha. Numa conta de seguros
  // e recrutamento, com 115 campos sem prefixo e pipelines de outro
  // ramo, nada pode resolver — senão o acordo dela vazaria para lá.
  const pipelines = [
    { id: "d1", name: "0. old 1- Prospects leads antigos" },
    { id: "d2", name: "2- Policies" },
    { id: "d3", name: "3- Recruiting" },
    { id: "d4", name: "Aposentadoria" },
  ];
  const colunas = ["Nome completo", "Cidade", "Renda", "Data nasc."].map((n, i) =>
    ({ key: `c${i}`, name: n, source: "ghl_custom_field" }));
  assert.deepEqual(resolverCatalogo(pipelines, colunas), []);
});

test("conta vazia não quebra", () => {
  assert.deepEqual(resolverCatalogo([], []), []);
  assert.deepEqual(resolverCatalogo(), []);
});
