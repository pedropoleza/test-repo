/**
 * D7 — contact write-back on task completion.
 *
 * When a task linked to a contact transitions to `done`, add a note
 * ("Tarefa concluída: {title}") and a configurable tag to that contact.
 *
 * Properties required by the plan: idempotent, retries on failure, never
 * blocks the UI. It runs via Next `after()` (post-response) today; once the
 * team provisions TRIGGER_SECRET_KEY this same function becomes the body of a
 * Trigger.dev task — the call sites don't change.
 *
 * Idempotency: `tasks.completed_writeback_at` is the flag. The job re-reads
 * the task, skips if the flag is set or the task is no longer an eligible
 * `done`+contact task, and sets the flag only after the GHL calls succeed
 * (at-least-once semantics — a crash between note and flag may duplicate the
 * note on retry, never the tag, and never corrupts task data).
 */
import { eq, sql, and, isNull } from "drizzle-orm";
import { db } from "~/server/db";
import { tasks } from "~/server/db/schema";
import { env } from "~/env";
import { createContactNote, addContactTags } from "./api";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 10_000];

export async function runContactWriteback(
  taskId: string,
  locationId: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await attemptWriteback(taskId, locationId);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(
        `[writeback] task=${taskId} attempt=${attempt + 1}/${MAX_ATTEMPTS} failed: ${msg}`,
      );
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
  }
  // Flag stays unset, so a future done-transition (or manual retry) picks it
  // back up. Never throws into the request path.
  console.error(`[writeback] task=${taskId} exhausted retries`);
}

async function attemptWriteback(
  taskId: string,
  locationId: string,
): Promise<void> {
  // System job: scope the tx to the task's tenant so FORCED RLS applies
  // cleanly. locationId comes from the server-side session that enqueued us.
  const task = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    const [row] = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        contactId: tasks.contactId,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.completedWritebackAt)))
      .limit(1);
    return row ?? null;
  });

  // Already written back, task gone, reopened, or contact unlinked → no-op.
  if (!task || task.status !== "done" || !task.contactId) return;

  await createContactNote(
    locationId,
    task.contactId,
    `Tarefa concluída: ${task.title}`,
  );
  await addContactTags(locationId, task.contactId, [
    env.GHL_WRITEBACK_TAG ?? "tarefa-concluida",
  ]);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    await tx
      .update(tasks)
      .set({ completedWritebackAt: sql`now()` })
      .where(eq(tasks.id, taskId));
  });
  console.info(`[writeback] task=${taskId} done`);
}
