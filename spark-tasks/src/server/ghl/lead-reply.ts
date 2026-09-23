/**
 * Inbound: a lead replied to a GHL nurture flow -> create a follow-up task.
 *
 * A GHL workflow ("Customer replied" trigger) POSTs to /api/webhooks/lead-reply
 * with the contact + location. We create a task "Responder lead {name}" in the
 * location's default board, assigned to the contact's owner when provided, so
 * the rep is nudged to reply. No GHL API token is needed — everything comes
 * from the payload + our DB. RLS-scoped like the rest of the app.
 *
 * Idempotent-ish: if the contact already has an OPEN lead-reply task, we don't
 * pile on another one (repeated replies while the first is still pending).
 */
import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { sendPushToUser } from "~/server/push";
import {
  boards,
  tasks,
  taskAssignees,
  notifications,
  DEFAULT_STAGES,
  type Stage,
} from "~/server/db/schema";
import { ghlContactUrl, ghlDashboardUrl } from "~/lib/ghl-app";

export type LeadReplyInput = {
  locationId: string;
  contactId?: string | null;
  name?: string | null;
  assignedTo?: string | null;
  flow?: string | null;
};

// Optional allowlist: when set, the webhook only creates tasks for these
// locations (a leaked URL can't spam tasks into arbitrary subaccounts). Empty
// = allow any location.
const ALLOWED_LOCATIONS = new Set(
  (process.env.LEAD_REPLY_LOCATION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
export function locationAllowed(locationId: string): boolean {
  return ALLOWED_LOCATIONS.size === 0 || ALLOWED_LOCATIONS.has(locationId);
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
function doneStageIds(stages: Stage[]): Set<string> {
  const done = stages.filter((s) => s.isDone).map((s) => s.id);
  return new Set(done.length ? done : [stages[stages.length - 1]?.id ?? "done"]);
}

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

export type LeadReplyResult = {
  created: boolean;
  taskId?: string;
  reason?: string;
};

export async function createLeadReplyTask(
  input: LeadReplyInput,
): Promise<LeadReplyResult> {
  if (!input.locationId) return { created: false, reason: "missing_location" };
  if (!locationAllowed(input.locationId)) {
    return { created: false, reason: "location_not_allowed" };
  }
  const leadName = (input.name ?? "").trim() || "lead";
  const flowLabel = input.flow?.trim();

  const result = await scoped(input.locationId, async (tx) => {
    const board = await defaultBoard(tx, input.locationId);
    const stages = board.stages;
    const status = openStageId(stages);
    const doneSet = doneStageIds(stages);

    // Don't stack duplicates: skip if an OPEN lead-reply task already exists
    // for this contact.
    if (input.contactId) {
      const marker = `leadreply:${input.contactId}`;
      const existing = await tx
        .select({
          id: tasks.id,
          status: tasks.status,
          archivedAt: tasks.archivedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.boardId, board.id), eq(tasks.externalId, marker)));
      const openOne = existing.find(
        (e) => !e.archivedAt && !doneSet.has(e.status),
      );
      if (openOne) {
        return { created: false, taskId: openOne.id, reason: "already_open" };
      }
    }

    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.boardId, board.id), eq(tasks.status, status)))) as [
      { count: number },
    ];

    const title = `Responder lead ${leadName}`;
    const note = flowLabel
      ? `${leadName} respondeu a mensagem do fluxo de nutrição (${flowLabel}). Retornar o contato.`
      : `${leadName} respondeu a mensagem do fluxo de nutrição. Retornar o contato.`;

    const [created] = await tx
      .insert(tasks)
      .values({
        locationId: input.locationId,
        boardId: board.id,
        title,
        note,
        status,
        color: "green",
        priority: "high",
        dueDate: new Date(),
        contactId: input.contactId ?? null,
        position: count,
        createdBy: "flow",
        source: "native",
        externalId: input.contactId ? `leadreply:${input.contactId}` : null,
      })
      .returning({ id: tasks.id });
    if (!created) return { created: false, reason: "insert_failed" };

    if (input.assignedTo) {
      await tx
        .insert(taskAssignees)
        .values({
          taskId: created.id,
          userId: input.assignedTo,
          locationId: input.locationId,
        })
        .onConflictDoNothing();
      await tx.insert(notifications).values({
        locationId: input.locationId,
        userId: input.assignedTo,
        type: "assigned",
        taskId: created.id,
        title: "Lead respondeu — retornar contato",
        body: title,
        actorId: null,
      });
    }
    return { created: true, taskId: created.id };
  });

  // Desktop/push alert to the owner (best-effort, post-commit).
  if (result.created && input.assignedTo) {
    const { locationId } = input;
    const userId = input.assignedTo;
    const cid = input.contactId;
    const url = cid ? ghlContactUrl(locationId, cid) : ghlDashboardUrl(locationId);
    after(() =>
      sendPushToUser(locationId, userId, {
        title: "Lead respondeu — retornar contato",
        body: leadName,
        url,
        tag: `leadreply-${result.taskId}`,
      }),
    );
  }
  return result;
}
