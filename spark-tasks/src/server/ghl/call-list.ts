/**
 * Daily "call list" generator.
 *
 * For a configured location, pull the leads sitting in a pipeline stage (e.g.
 * VENDAS → "LIGAÇÕES LUCIANA") and create one call task per lead — assigned to
 * a named user (e.g. Luciana), due today, capped per run. Idempotent per day
 * and per lead: a lead that already has an OPEN call task is skipped, and a
 * second run on the same day never duplicates.
 *
 * Reading stage membership needs the GHL `opportunities.readonly` scope. Until
 * the location reauthorizes with it, `getPipelines` fails and we surface a
 * clear, actionable error instead of silently doing nothing.
 *
 * All DB work runs in an RLS-scoped transaction (SET LOCAL app.location_id),
 * the same tenant backstop as the rest of the app.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
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
import {
  getLocationUsers,
  getPipelines,
  searchOpportunities,
} from "./api";
import type { CallListConfig } from "~/server/config";

export type CallListResult = {
  locationId: string;
  ok: boolean;
  created: number;
  skipped: number;
  leadsInStage: number;
  assignee?: string;
  pipeline?: string;
  stage?: string;
  error?: string;
  dryRun?: boolean;
};

const TZ = "America/Sao_Paulo";

/** YYYY-MM-DD in the configured timezone (en-CA renders ISO-like). */
function localDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** End of the local day (Brazil is UTC-3 year-round, no DST). */
function endOfLocalDay(dayKey: string): Date {
  return new Date(`${dayKey}T23:59:00-03:00`);
}

function ci(s: string): string {
  return s.trim().toLowerCase();
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

/** How many leads to consider per run (oldest first). Bounded API paging. */
const SCAN_WINDOW = 200;

export async function runCallList(
  cfg: CallListConfig,
  opts: { dryRun?: boolean; maxOverride?: number } = {},
): Promise<CallListResult> {
  const dryRun = !!opts.dryRun;
  // A manual override (e.g. ?max=1 for a production smoke test) wins, bounded
  // by a hard ceiling; otherwise the configured daily cap applies.
  const cap =
    opts.maxOverride != null && opts.maxOverride > 0
      ? Math.min(opts.maxOverride, 200)
      : cfg.maxTasks;
  const base: CallListResult = {
    locationId: cfg.locationId,
    ok: false,
    created: 0,
    skipped: 0,
    leadsInStage: 0,
    dryRun,
  };

  // 1. Resolve pipeline + stage by name (needs opportunities.readonly).
  let pipelineId: string;
  let stageId: string;
  try {
    const pipelines = await getPipelines(cfg.locationId);
    const pipeline = pipelines.find((p) => ci(p.name) === ci(cfg.pipelineName));
    if (!pipeline) {
      return {
        ...base,
        error: `pipeline_not_found: "${cfg.pipelineName}" (available: ${pipelines
          .map((p) => p.name)
          .join(", ")})`,
      };
    }
    const stage = pipeline.stages.find((s) => ci(s.name) === ci(cfg.stageName));
    if (!stage) {
      return {
        ...base,
        pipeline: pipeline.name,
        error: `stage_not_found: "${cfg.stageName}" in "${pipeline.name}" (available: ${pipeline.stages
          .map((s) => s.name)
          .join(", ")})`,
      };
    }
    pipelineId = pipeline.id;
    stageId = stage.id;
    base.pipeline = pipeline.name;
    base.stage = stage.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 401/403 here almost always means the opportunities scope is missing or
    // the location hasn't reauthorized.
    return {
      ...base,
      error: `opportunities_read_failed (needs opportunities.readonly + reconnect): ${msg}`,
    };
  }

  // 2. Resolve the assignee by name.
  let assigneeId: string;
  let assigneeName: string;
  try {
    const users = await getLocationUsers(cfg.locationId);
    const match =
      users.find((u) => ci(u.name) === ci(cfg.assigneeName)) ??
      users.find((u) => ci(u.name).includes(ci(cfg.assigneeName)));
    if (!match) {
      return {
        ...base,
        error: `assignee_not_found: "${cfg.assigneeName}"`,
      };
    }
    assigneeId = match.id;
    assigneeName = match.name;
    base.assignee = match.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ...base, error: `users_read_failed: ${msg}` };
  }

  // 3. Pull the leads in the stage (oldest first).
  const leads = await searchOpportunities(cfg.locationId, {
    pipelineId,
    stageId,
    limit: SCAN_WINDOW,
  });
  base.leadsInStage = leads.length;
  const withContact = leads.filter((l) => !!l.contactId);
  if (withContact.length === 0) {
    return { ...base, ok: true };
  }

  const dayKey = localDayKey();
  const due = endOfLocalDay(dayKey);
  const pushJobs: Array<{ userId: string; title: string; url: string; tag: string }> = [];

  const result = await scoped(cfg.locationId, async (tx) => {
    const board = await defaultBoard(tx, cfg.locationId);
    const stages = board.stages;
    const status = openStageId(stages);
    const doneSet = doneStageIds(stages);

    const candidateIds = withContact.map((l) => l.contactId!) as string[];

    // Existing auto call tasks for these contacts (externalId marker "call:").
    const existing = await tx
      .select({
        contactId: tasks.contactId,
        externalId: tasks.externalId,
        status: tasks.status,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.boardId, board.id),
          like(tasks.externalId, "call:%"),
          inArray(tasks.contactId, candidateIds),
        ),
      );

    // A contact is "covered" if it already has an OPEN call task (not archived,
    // not in a done stage) or one already created today (idempotency).
    const covered = new Set<string>();
    for (const t of existing) {
      if (!t.contactId) continue;
      const openTask = !t.archivedAt && !doneSet.has(t.status);
      const createdToday = t.externalId === `call:${t.contactId}:${dayKey}`;
      if (openTask || createdToday) covered.add(t.contactId);
    }

    // Next position in the open stage.
    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.boardId, board.id), eq(tasks.status, status)))) as [
      { count: number },
    ];
    let position = count;

    let created = 0;
    let skipped = 0;

    for (const lead of withContact) {
      if (created >= cap) break;
      const contactId = lead.contactId!;
      if (covered.has(contactId)) {
        skipped += 1;
        continue;
      }
      covered.add(contactId); // guard against duplicate leads in the window

      if (dryRun) {
        created += 1; // "would create"
        continue;
      }

      const who = lead.name || "cliente";
      const [row] = await tx
        .insert(tasks)
        .values({
          locationId: cfg.locationId,
          boardId: board.id,
          title: `Ligar para ${who}`,
          note: null,
          status,
          color: "blue",
          dueDate: due,
          contactId,
          position: position++,
          createdBy: "system",
          priority: "high",
          source: "native",
          externalId: `call:${contactId}:${dayKey}`,
          opportunityId: lead.id,
          labels: cfg.label ? [cfg.label] : [],
        })
        .returning({ id: tasks.id });

      if (!row) {
        skipped += 1;
        continue;
      }

      await tx
        .insert(taskAssignees)
        .values({
          taskId: row.id,
          userId: assigneeId,
          locationId: cfg.locationId,
        })
        .onConflictDoNothing();

      await tx.insert(notifications).values({
        locationId: cfg.locationId,
        userId: assigneeId,
        type: "assigned",
        taskId: row.id,
        title: "Nova ligação para hoje",
        body: `Ligar para ${who}`,
        actorId: null,
      });

      pushJobs.push({
        userId: assigneeId,
        title: "Nova ligação para hoje",
        url: `https://app.gohighlevel.com/v2/location/${cfg.locationId}/contacts/detail/${contactId}`,
        tag: `call-${row.id}`,
      });

      created += 1;
    }

    return { created, skipped };
  });

  // Desktop/push alerts after the tx commits (best-effort).
  for (const job of pushJobs) {
    await sendPushToUser(cfg.locationId, job.userId, {
      title: job.title,
      body: assigneeName ? `Lista de ${assigneeName}` : undefined,
      url: job.url,
      tag: job.tag,
    });
  }

  return { ...base, ok: true, created: result.created, skipped: result.skipped };
}

/** Run every configured call list; returns one result per location. */
export async function runAllCallLists(
  configs: CallListConfig[],
  opts: { dryRun?: boolean; maxOverride?: number } = {},
): Promise<CallListResult[]> {
  const results: CallListResult[] = [];
  for (const cfg of configs) {
    try {
      results.push(await runCallList(cfg, opts));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      results.push({
        locationId: cfg.locationId,
        ok: false,
        created: 0,
        skipped: 0,
        leadsInStage: 0,
        error: `unhandled: ${msg}`,
      });
    }
  }
  return results;
}
