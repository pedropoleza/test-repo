/**
 * Mirror tasks to the separate Spark Workspace project.
 *
 * For configured locations, every task creation / status change / field edit is
 * POSTed to the Workspace's inbound webhook so it can keep a read-only replica
 * (listing/filtering/grouping alongside CRM data). Editing a task stays here in
 * Spark Tasks — the Workspace never writes back.
 *
 * Contract (see Workspace runbook):
 *   POST $WORKSPACE_WEBHOOK_URL
 *   X-Spark-Signature: sha256=<HMAC-SHA256 hex of the raw body>
 *   body: { id, title, status:"open"|"done", dueDate?, assignee?, contactId?,
 *           url?, updatedAt }
 * The upsert is keyed on `id`; `updatedAt` orders out-of-order deliveries.
 *
 * Best-effort: runs post-response via after(), retries with backoff, and never
 * throws into the request path.
 */
import crypto from "crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { tasks, boards, taskAssignees, type Stage } from "~/server/db/schema";
import { ghlContactUrl } from "~/lib/ghl-app";

const MIRROR_LOCATIONS = new Set(
  (process.env.WORKSPACE_MIRROR_LOCATION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function shouldMirror(locationId: string): boolean {
  return MIRROR_LOCATIONS.has(locationId);
}

export function mirrorLocations(): string[] {
  return [...MIRROR_LOCATIONS];
}

function webhookConfig(): { url: string; secret: string } | null {
  const url = process.env.WORKSPACE_WEBHOOK_URL;
  const secret = process.env.WORKSPACE_WEBHOOK_SECRET;
  if (!url || !secret) return null;
  return { url, secret };
}

async function scoped<T>(locationId: string, fn: (tx: typeof db) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
}

type TaskRow = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  contactId: string | null;
  updatedAt: Date | null;
};

function buildPayload(
  locationId: string,
  t: TaskRow,
  stages: Stage[],
  assignee: string | undefined,
): Record<string, unknown> {
  const isDone = !!stages.find((s) => s.id === t.status)?.isDone;
  const payload: Record<string, unknown> = {
    id: t.id,
    title: t.title,
    status: isDone ? "done" : "open",
    updatedAt: (t.updatedAt ?? new Date()).toISOString(),
  };
  if (t.dueDate) payload.dueDate = t.dueDate.toISOString().slice(0, 10);
  if (assignee) payload.assignee = assignee;
  if (t.contactId) {
    payload.contactId = t.contactId;
    payload.url = ghlContactUrl(locationId, t.contactId);
  }
  return payload;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2_000, 6_000];

async function sendToWorkspace(
  url: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const sig =
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Spark-Signature": sig,
        },
        body,
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) {
        console.error(
          `[workspace-mirror] ${res.status} for task ${String(payload.id)}: ${(await res.text()).slice(0, 120)}`,
        );
        return false;
      }
      throw new Error(`status ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(
        `[workspace-mirror] attempt ${i + 1} failed (${String(payload.id)}): ${msg}`,
      );
      if (i < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    }
  }
  return false;
}

/** Load one task's current state and push it to the Workspace webhook. */
export async function mirrorTaskToWorkspace(
  locationId: string,
  taskId: string,
): Promise<void> {
  if (!shouldMirror(locationId)) return;
  const cfg = webhookConfig();
  if (!cfg) return;

  const data = await scoped(locationId, async (tx) => {
    const [t] = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        boardId: tasks.boardId,
        dueDate: tasks.dueDate,
        contactId: tasks.contactId,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!t) return null;
    const [b] = await tx
      .select({ stages: boards.stages })
      .from(boards)
      .where(eq(boards.id, t.boardId))
      .limit(1);
    const [a] = await tx
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
      .limit(1);
    return { t, stages: (b?.stages ?? []) as Stage[], assignee: a?.userId };
  });
  if (!data) return;
  await sendToWorkspace(
    cfg.url,
    cfg.secret,
    buildPayload(locationId, data.t, data.stages, data.assignee),
  );
}

/**
 * One-time backfill: push EVERY active (non-archived) task of a location to the
 * Workspace. Efficient bulk load (a few queries) + bounded-concurrency POSTs.
 */
export async function backfillWorkspace(
  locationId: string,
): Promise<{ total: number; sent: number; failed: number }> {
  const cfg = webhookConfig();
  if (!cfg) return { total: 0, sent: 0, failed: 0 };

  const { rows, stagesByBoard, assigneeByTask } = await scoped(
    locationId,
    async (tx) => {
      const rows = (await tx
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          boardId: tasks.boardId,
          dueDate: tasks.dueDate,
          contactId: tasks.contactId,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.locationId, locationId), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.updatedAt))) as Array<TaskRow & { boardId: string }>;

      const boardRows = await tx
        .select({ id: boards.id, stages: boards.stages })
        .from(boards)
        .where(eq(boards.locationId, locationId));
      const stagesByBoard = new Map<string, Stage[]>(
        boardRows.map((b) => [b.id, b.stages as Stage[]]),
      );

      const ids = rows.map((r) => r.id);
      const assigneeByTask = new Map<string, string>();
      if (ids.length) {
        const aRows = await tx
          .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(inArray(taskAssignees.taskId, ids));
        for (const a of aRows) {
          if (!assigneeByTask.has(a.taskId)) assigneeByTask.set(a.taskId, a.userId);
        }
      }
      return { rows, stagesByBoard, assigneeByTask };
    },
  );

  let sent = 0;
  let failed = 0;
  const CONCURRENCY = 10;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((r) =>
        sendToWorkspace(
          cfg.url,
          cfg.secret,
          buildPayload(
            locationId,
            r,
            stagesByBoard.get(r.boardId) ?? [],
            assigneeByTask.get(r.id),
          ),
        ),
      ),
    );
    for (const ok of results) ok ? sent++ : failed++;
  }
  return { total: rows.length, sent, failed };
}
