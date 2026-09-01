/**
 * GET /api/tasks — tarefas replicadas do Spark Tasks.
 *
 * A escrita não passa por aqui: quem grava é o webhook em
 * /api/tasks/inbound, autenticado por assinatura. Esta rota é a leitura
 * para a interface, com a mesma autenticação das demais.
 *
 * Devolve colunas + registros no mesmo formato das outras tabelas, para
 * a aba de Tarefas reusar filtro, ordenação e agrupamento sem código
 * próprio.
 */
import { resolveContext, sendError } from "../lib/server/context.js";
import { db } from "../lib/server/db.js";
import { TASK_FIELDS, taskToRecord } from "../src/shared/tasks.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let ctx;
  try {
    ctx = await resolveContext(req);
  } catch (err) {
    return sendError(res, err);
  }

  const limit = Math.min(Number(req.query?.limit) || 300, 1000);
  const { data, error } = await db()
    .from("workspace_tasks")
    .select("source_external_id,title,status,due_date,assignee,contact_id,url,source_updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: "db_error" });

  const rows = data || [];
  return res.status(200).json({
    source: "spark_tasks",
    columns: TASK_FIELDS,
    records: rows.map(taskToRecord),
    total: rows.length,
    truncated: rows.length >= limit,
    // Sem nenhuma tarefa ainda, a aba precisa dizer o que falta ligar em
    // vez de parecer que a conta não tem tarefa nenhuma.
    connected: rows.length > 0 || !!process.env.SPARK_TASKS_WEBHOOK_SECRET,
  });
}
