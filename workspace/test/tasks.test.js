/**
 * Webhook do Spark Tasks: assinatura, normalização e reentrega.
 *
 * A reentrega fora de ordem é o caso que mais importa aqui — é o que
 * faria um evento antigo apagar o estado atual da tarefa.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifySignature, normalizeTask } from "../api/tasks/inbound.js";
import { taskToRecord, TASK_FIELDS } from "../src/shared/tasks.js";

const SEGREDO = "segredo-de-teste";
const assinar = (corpo, segredo = SEGREDO) =>
  "sha256=" + crypto.createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");

/* ---------------- assinatura ---------------- */

test("assinatura correta é aceita, com e sem o prefixo sha256=", () => {
  const corpo = JSON.stringify({ id: "t1", title: "Ligar" });
  const cabecalho = assinar(corpo);
  assert.equal(verifySignature(corpo, cabecalho, SEGREDO), true);
  assert.equal(verifySignature(corpo, cabecalho.slice(7), SEGREDO), true);
});

test("corpo alterado invalida a assinatura", () => {
  const corpo = JSON.stringify({ id: "t1", title: "Ligar" });
  const cabecalho = assinar(corpo);
  const adulterado = JSON.stringify({ id: "t1", title: "Ligar para outro" });
  assert.equal(verifySignature(adulterado, cabecalho, SEGREDO), false);
});

test("segredo errado não passa", () => {
  const corpo = JSON.stringify({ id: "t1" });
  assert.equal(verifySignature(corpo, assinar(corpo, "outro"), SEGREDO), false);
});

test("assinatura ausente ou malformada não passa", () => {
  const corpo = JSON.stringify({ id: "t1" });
  for (const header of [undefined, null, "", "sha256=", "lixo", 123]) {
    assert.equal(verifySignature(corpo, header, SEGREDO), false, String(header));
  }
});

/* ---------------- normalização ---------------- */

test("tarefa sem id é recusada: é a chave de idempotência", () => {
  assert.equal(normalizeTask({ title: "sem id" }), null);
  assert.equal(normalizeTask({}), null);
});

test("payload do contrato vira linha da tabela", () => {
  const t = normalizeTask({
    id: "tk_1", title: "Ligar para a Maria", status: "done",
    dueDate: "2026-09-10", assignee: "Daniely",
    contactId: "c1", url: "https://tasks.spark.app/t/1",
    updatedAt: "2026-09-01T10:00:00Z",
  });
  assert.equal(t.source_external_id, "tk_1");
  assert.equal(t.status, "done");
  assert.equal(t.due_date, "2026-09-10");
  assert.equal(t.contact_id, "c1");
  assert.equal(t.source_updated_at, "2026-09-01T10:00:00.000Z");
});

test("status desconhecido cai para aberta, em vez de quebrar a linha", () => {
  assert.equal(normalizeTask({ id: "t", status: "arquivada" }).status, "open");
  assert.equal(normalizeTask({ id: "t" }).status, "open");
});

test("url que não é http é descartada", () => {
  assert.equal(normalizeTask({ id: "t", url: "javascript:alert(1)" }).url, null);
  assert.equal(normalizeTask({ id: "t", url: "não é url" }).url, null);
  assert.equal(normalizeTask({ id: "t", url: "https://ok.com/1" }).url, "https://ok.com/1");
});

test("data inválida vira vazio, não uma linha quebrada", () => {
  assert.equal(normalizeTask({ id: "t", dueDate: "amanhã" }).due_date, null);
  assert.equal(normalizeTask({ id: "t" }).due_date, null);
});

test("sem updatedAt, o instante da chegada serve de ordem", () => {
  const t = normalizeTask({ id: "t" });
  assert.ok(t.source_updated_at, "precisa de um instante para ordenar reentregas");
  assert.ok(Math.abs(Date.now() - new Date(t.source_updated_at).getTime()) < 5000);
});

test("campos que ainda não modelamos ficam guardados no payload", () => {
  const t = normalizeTask({ id: "t", prioridade: "alta", etiquetas: ["x"] });
  assert.equal(t.payload.prioridade, "alta");
  assert.deepEqual(t.payload.etiquetas, ["x"]);
});

/* ---------------- formato de tabela ---------------- */

test("a tarefa vira registro no formato das outras tabelas", () => {
  const record = taskToRecord({
    source_external_id: "tk_1", title: "Ligar", status: "done",
    due_date: "2026-09-10", assignee: "Daniely", contact_id: "c1",
    url: "https://x.com", source_updated_at: "2026-09-01T10:00:00Z",
  });
  assert.equal(record.title, "Ligar");
  assert.equal(record.contactId, "c1", "o elo com a pasta fica fora de properties");
  assert.equal(record.properties.status, "done");
  assert.equal(record.properties.updated_at, "2026-09-01");
});

test("a coluna de status conhece os dois estados", () => {
  const status = TASK_FIELDS.find((f) => f.key === "status");
  assert.deepEqual(status.options.map((o) => o.id), ["open", "done"]);
});
