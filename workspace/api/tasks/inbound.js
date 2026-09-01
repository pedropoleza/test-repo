/**
 * POST /api/tasks/inbound — recebe tarefas do Spark Tasks.
 *
 * O Spark Tasks é a fonte da verdade; aqui guardamos uma réplica para
 * poder listar, filtrar e agrupar como qualquer outra tabela sem
 * depender de uma chamada externa a cada abertura da aba.
 *
 * AUTENTICAÇÃO
 * Não há sessão nem token de usuário: quem chama é um servidor, não um
 * navegador. A prova é a assinatura do corpo:
 *
 *   X-Spark-Signature: sha256=<hmac-sha256 hex do corpo cru>
 *
 * com o segredo de SPARK_TASKS_WEBHOOK_SECRET, o mesmo dos dois lados.
 * A comparação é em tempo constante — comparar strings com === vaza,
 * pelo tempo, quantos bytes iniciais o atacante acertou.
 *
 * REENTREGA
 * Webhook sem confirmação reenvia, então a mesma tarefa chega mais de
 * uma vez e às vezes fora de ordem. Duas defesas:
 *   - upsert por (workspace, source, id) — reentrega atualiza, não duplica
 *   - `source_updated_at` — um evento mais antigo que o guardado é
 *     descartado, em vez de sobrescrever o estado atual
 *
 * É também por isso que não há proteção de replay por timestamp: repetir
 * um evento não muda nada, e o único efeito de um evento antigo repetido
 * é ser descartado pela regra de ordem.
 */
import crypto from "node:crypto";
import { db } from "../../lib/server/db.js";
import { ensureWorkspace } from "../../lib/server/context.js";
import { log } from "../../lib/server/log.js";

/** O corpo precisa chegar cru: reserializar mudaria a assinatura. */
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 256 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.SPARK_TASKS_WEBHOOK_SECRET;
  if (!secret) {
    log.error("tasks.inbound.not_configured", {});
    return res.status(503).json({ error: "webhook_not_configured" });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(err.code === "body_too_large" ? 413 : 400)
      .json({ error: err.code || "unreadable_body" });
  }

  if (!verifySignature(raw, req.headers["x-spark-signature"], secret)) {
    // Sem detalhe: dizer "assinatura errada" e "segredo errado" com
    // mensagens diferentes ajuda quem está adivinhando.
    log.warn("tasks.inbound.bad_signature", { bytes: raw.length });
    return res.status(401).json({ error: "invalid_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const task = normalizeTask(payload);
  if (!task) return res.status(400).json({ error: "missing_id" });

  const tenantId = process.env.WORKSPACE_FIXED_TENANT_ID;
  if (!tenantId) return res.status(503).json({ error: "tenant_not_configured" });

  try {
    const workspace = await ensureWorkspace(tenantId, "spark-tasks");
    const result = await upsertTask(workspace.id, task);
    log.info("tasks.inbound.received", {
      workspaceId: workspace.id, taskId: task.source_external_id, outcome: result,
    });
    return res.status(200).json({ ok: true, id: task.source_external_id, outcome: result });
  } catch (err) {
    log.error("tasks.inbound.failed", { error: err.message });
    return res.status(500).json({ error: "store_failed" });
  }
}

/* ------------------------------------------------------------------ */

/**
 * O corpo cru, do jeito que foi assinado.
 *
 * Em produção a função roda com bodyParser desligado e o corpo chega
 * como stream. Em ambientes que já consumiram e parsearam o corpo, o
 * último recurso é reserializar — funciona quando o remetente manda JSON
 * compacto, que é o caso de JSON.stringify dos dois lados.
 */
async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");

  if (req.readable) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        const err = new Error("body too large");
        err.code = "body_too_large";
        throw err;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return req.body === undefined ? "" : JSON.stringify(req.body);
}

export function verifySignature(raw, header, secret) {
  if (!header || typeof header !== "string") return false;
  const recebida = header.startsWith("sha256=") ? header.slice(7) : header;
  const esperada = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");

  // timingSafeEqual exige o mesmo tamanho; comparar o tamanho antes já
  // vazaria essa informação, então normalizamos com um digest de cada.
  const a = crypto.createHash("sha256").update(recebida).digest();
  const b = crypto.createHash("sha256").update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

const STATUS = new Set(["open", "done"]);

export function normalizeTask(payload = {}) {
  const id = texto(payload.id, 128);
  if (!id) return null;

  return {
    source: "spark_tasks",
    source_external_id: id,
    title: texto(payload.title, 500) || "Sem título",
    status: STATUS.has(payload.status) ? payload.status : "open",
    due_date: data(payload.dueDate),
    assignee: texto(payload.assignee, 200) || null,
    contact_id: texto(payload.contactId, 128) || null,
    url: httpUrl(payload.url),
    // Guardado inteiro: campos que ainda não modelamos continuam à mão
    // sem exigir migration a cada novidade da origem.
    payload: payload && typeof payload === "object" ? payload : {},
    source_updated_at: instante(payload.updatedAt) || new Date().toISOString(),
  };
}

function texto(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, max).trim();
}

function data(value) {
  const iso = instante(value);
  return iso ? iso.slice(0, 10) : null;
}

function instante(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Só http(s): um `javascript:` aqui viraria clique armado na aba. */
function httpUrl(value) {
  const raw = texto(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Grava a tarefa. Devolve 'created', 'updated' ou 'ignored_older'.
 *
 * O evento mais antigo que o guardado é descartado: webhook entrega fora
 * de ordem, e sem isso um "criada" atrasado apagaria o "concluída" que
 * chegou antes.
 */
async function upsertTask(workspaceId, task) {
  const { data: existing } = await db()
    .from("workspace_tasks")
    .select("id,source_updated_at")
    .eq("workspace_id", workspaceId)
    .eq("source", task.source)
    .eq("source_external_id", task.source_external_id)
    .maybeSingle();

  if (!existing) {
    const { error } = await db()
      .from("workspace_tasks")
      .insert({ workspace_id: workspaceId, ...task });
    if (error) throw new Error(error.message);
    return "created";
  }

  if (existing.source_updated_at
      && new Date(task.source_updated_at) < new Date(existing.source_updated_at)) {
    return "ignored_older";
  }

  const { error } = await db()
    .from("workspace_tasks")
    .update(task)
    .eq("id", existing.id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return "updated";
}
