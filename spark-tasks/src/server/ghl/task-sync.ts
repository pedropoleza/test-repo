/**
 * GHL native task <-> Spark Tasks sync.
 *
 *  - Inbound (webhook): TaskCreate / TaskComplete / TaskDelete mirror into the
 *    location's DEFAULT board as a card with source='ghl' (badged in the UI),
 *    idempotent on (location_id, external_id).
 *  - Outbound (user actions only): completing/reopening or editing a mirrored
 *    card pushes back to the GHL task. Outbound runs ONLY from tRPC mutations,
 *    never from the webhook handler, so there is no echo loop (GHL has no
 *    "task updated" webhook, and re-applying identical state is a no-op).
 *
 * All DB work runs in an RLS-scoped transaction (SET LOCAL role +
 * app.location_id), same backstop as the rest of the app.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "~/server/db";
import { sendPushToUser } from "~/server/push";
import {
  boards,
  tasks,
  taskAssignees,
  notifications,
  locationSettings,
  DEFAULT_STAGES,
  type Stage,
} from "~/server/db/schema";
import { completeGhlTask, updateGhlTask } from "./api";

export type GhlTaskEvent = {
  type: string;
  locationId: string;
  id: string;
  title?: string;
  body?: string;
  dueDate?: string;
  assignedTo?: string;
  contactId?: string;
  dateAdded?: string;
  // Possible recurrence indicators (GHL field name TBD — we check several).
  isRecurring?: boolean;
  recurring?: unknown;
  recurringTask?: unknown;
  rrule?: string;
  repeat?: unknown;
  repeatInterval?: unknown;
};

/** GHL sends the description as HTML — flatten to plain text. */
function htmlToText(html?: string | null): string | null {
  if (html == null) return null;
  let s = String(html)
    // block/line boundaries -> newlines
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    // strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // decode the common entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length ? s : null;
}

/** Best-effort recurrence detection across possible payload shapes. */
function isRecurring(evt: GhlTaskEvent): boolean {
  return !!(
    evt.isRecurring ||
    evt.recurring ||
    evt.recurringTask ||
    evt.rrule ||
    evt.repeat ||
    evt.repeatInterval
  );
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 10_000];

function parseDue(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function scoped<T>(locationId: string, fn: (tx: typeof db) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
}

function openStageId(stages: Stage[]): string {
  return stages[0]?.id ?? "todo";
}
function doneStageId(stages: Stage[]): string {
  return (stages.find((s) => s.isDone) ?? stages[stages.length - 1])?.id ?? "done";
}

/** Resolve (or lazily create) the location's default board. */
async function defaultBoard(tx: typeof db, locationId: string) {
  const [b] = await tx
    .select({ id: boards.id, stages: boards.stages })
    .from(boards)
    .where(eq(boards.locationId, locationId))
    .orderBy(boards.createdAt)
    .limit(1);
  if (b) return b;
  const [created] = await tx
    .insert(boards)
    .values({ locationId, stages: DEFAULT_STAGES })
    .returning({ id: boards.id, stages: boards.stages });
  return created!;
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export async function ingestTaskEvent(evt: GhlTaskEvent): Promise<void> {
  if (!evt.locationId || !evt.id) return;
  const kind = evt.type;

  await scoped(evt.locationId, async (tx) => {
    // Respect the per-location toggle: if GHL sync is off, do nothing — GHL
    // tasks stay entirely out of the app.
    const [setRow] = await tx
      .select({ e: locationSettings.ghlSyncEnabled })
      .from(locationSettings)
      .where(eq(locationSettings.locationId, evt.locationId))
      .limit(1);
    if (setRow && !setRow.e) return;

    const [existing] = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.locationId, evt.locationId),
          eq(tasks.externalId, evt.id),
        ),
      )
      .limit(1);

    if (kind === "TaskDelete") {
      if (existing) {
        await tx
          .update(tasks)
          .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(tasks.id, existing.id));
      }
      return;
    }

    const board = await defaultBoard(tx, evt.locationId);
    const stages = board.stages;

    if (!existing) {
      // New mirror card.
      const status =
        kind === "TaskComplete" ? doneStageId(stages) : openStageId(stages);
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.boardId, board.id), eq(tasks.status, status)))) as [
        { count: number },
      ];
      const [created] = await tx
        .insert(tasks)
        .values({
          locationId: evt.locationId,
          boardId: board.id,
          title: evt.title?.trim() || "(untitled task)",
          note: htmlToText(evt.body),
          status,
          color: "blue",
          dueDate: parseDue(evt.dueDate),
          contactId: evt.contactId ?? null,
          position: count,
          createdBy: evt.assignedTo || "ghl",
          source: "ghl",
          externalId: evt.id,
          recurring: isRecurring(evt),
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      if (created && evt.assignedTo) {
        await tx
          .insert(taskAssignees)
          .values({
            taskId: created.id,
            userId: evt.assignedTo,
            locationId: evt.locationId,
          })
          .onConflictDoNothing();
        await tx.insert(notifications).values({
          locationId: evt.locationId,
          userId: evt.assignedTo,
          type: "assigned",
          taskId: created.id,
          title: "New task assigned to you",
          body: evt.title ?? null,
          actorId: null,
        });
        // Desktop alert even with the module closed (no-op until VAPID set).
        const url = evt.contactId
          ? `https://app.gohighlevel.com/v2/location/${evt.locationId}/contacts/detail/${evt.contactId}`
          : `https://app.gohighlevel.com/v2/location/${evt.locationId}/dashboard`;
        const { locationId } = evt;
        const userId = evt.assignedTo;
        const title = evt.title ?? "Task";
        after(() =>
          sendPushToUser(locationId, userId, {
            title: "New task assigned to you",
            body: title,
            url,
            tag: `task-${created.id}`,
          }),
        );
      }
      return;
    }

    // Existing mirror — update mapped fields; completion moves the stage.
    const set: Record<string, unknown> = {
      title: evt.title?.trim() || existing.title,
      note: htmlToText(evt.body) ?? existing.note,
      dueDate: parseDue(evt.dueDate) ?? existing.dueDate,
      contactId: evt.contactId ?? existing.contactId,
      recurring: isRecurring(evt) || existing.recurring,
      updatedAt: sql`now()`,
    };
    if (kind === "TaskComplete") set.status = doneStageId(stages);
    await tx.update(tasks).set(set).where(eq(tasks.id, existing.id));

    if (evt.assignedTo) {
      await tx
        .insert(taskAssignees)
        .values({
          taskId: existing.id,
          userId: evt.assignedTo,
          locationId: evt.locationId,
        })
        .onConflictDoNothing();
    }
  });
}

// ---------------------------------------------------------------------------
// Outbound (called from tRPC mutations via after())
// ---------------------------------------------------------------------------

async function withRetry(label: string, fn: () => Promise<void>) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(`[task-sync] ${label} attempt ${i + 1} failed: ${msg}`);
      if (i < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    }
  }
  console.error(`[task-sync] ${label} exhausted retries`);
}

/** Push completion/reopen of a mirrored card back to its GHL task. */
export async function pushTaskCompletion(
  taskId: string,
  locationId: string,
  completed: boolean,
) {
  const task = await scoped(locationId, (tx) =>
    tx
      .select({
        externalId: tasks.externalId,
        contactId: tasks.contactId,
        source: tasks.source,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
      .then((r) => r[0] ?? null),
  );
  if (!task || task.source !== "ghl" || !task.externalId || !task.contactId) return;
  await withRetry(`complete ${taskId}`, () =>
    completeGhlTask(locationId, task.contactId!, task.externalId!, completed),
  );
}

/** Push field/assignee edits of a mirrored card back to its GHL task. */
export async function pushTaskFields(taskId: string, locationId: string) {
  const data = await scoped(locationId, async (tx) => {
    const [t] = await tx
      .select({
        externalId: tasks.externalId,
        contactId: tasks.contactId,
        source: tasks.source,
        title: tasks.title,
        note: tasks.note,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!t) return null;
    const [a] = await tx
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
      .limit(1);
    return { ...t, assignedTo: a?.userId ?? null };
  });
  if (!data || data.source !== "ghl" || !data.externalId || !data.contactId) return;
  await withRetry(`update ${taskId}`, () =>
    updateGhlTask(locationId, data.contactId!, data.externalId!, {
      title: data.title,
      body: data.note,
      dueDate: data.dueDate ? data.dueDate.toISOString() : null,
      assignedTo: data.assignedTo,
    }),
  );
}
