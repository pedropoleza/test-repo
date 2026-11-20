/**
 * Inbound: an opportunity entered the quoting stage -> create a Cotação task.
 *
 * In Sabrina's account, when an opportunity lands in pipeline "1- Prospects" at
 * the stage "Informações de Cotações - Soraya para Julia", a GHL workflow POSTs
 * to /api/webhooks/opportunity-cotacao. We create a ready-to-fill "Proposta de
 * cotação" task for that contact (title "Proposta de cotação: {nome}", note =
 * the proposal template) so the rep just fills it in and exports the PDF.
 *
 * Scoped to an allowlist (defaults to Sabrina's location). Idempotent: one open
 * proposal task per opportunity (falls back to per-contact) — repeated stage
 * webhooks won't pile up duplicates. RLS-scoped like the rest of the app.
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
import { seedTitleForType, PROPOSAL_TASK_TYPE } from "~/lib/task-types";
import { ensureCotacaoStage } from "~/server/cotacao-stage";
import { routedBoard } from "./routing";

export type OppCotacaoInput = {
  locationId: string;
  opportunityId?: string | null;
  contactId?: string | null;
  name?: string | null;
  assignedTo?: string | null;
  /** Pipeline + stage as reported by GHL (used for the optional guard). */
  pipeline?: string | null;
  stage?: string | null;
  // Client data (resolved by GHL merge fields) used to pre-fill the task note.
  clienteEstado?: string | null;
  dateOfBirth?: string | null;
  fumante?: string | null;
  indicacao?: string | null;
  estadoCivil?: string | null;
  conjuge?: string | null;
  medicamentos?: string | null;
  cotacaoDate?: string | null;
  /** If GHL sends a fully composed body, we use it verbatim as the note. */
  note?: string | null;
};

/**
 * Build the pre-filled "DADOS DO CLIENTE" + "OBSERVAÇÕES" note from the contact
 * data GHL sends. If a fully composed `note` is provided, it's used verbatim.
 */
function buildCotacaoNote(i: OppCotacaoInput): string {
  if (i.note && i.note.trim()) return i.note.trim();
  const v = (s?: string | null) => (s ?? "").trim();
  const today = v(i.cotacaoDate) || new Date().toLocaleDateString("pt-BR");
  return [
    "## DADOS DO CLIENTE",
    "",
    `Nome completo: ${v(i.name)}`,
    "",
    `Cliente/Estado: ${v(i.clienteEstado)}`,
    "",
    `Data de nascimento: ${v(i.dateOfBirth)}`,
    "",
    `Fumante: ${v(i.fumante)}`,
    "",
    `Indicação: ${v(i.indicacao)}`,
    "",
    `Estado civil: ${v(i.estadoCivil)}`,
    "",
    `Informações do cônjuge: ${v(i.conjuge)}`,
    "",
    `Uso de medicamentos: ${v(i.medicamentos)}`,
    "",
    "## OBSERVAÇÕES",
    "",
    `Data da cotação: ${today}`,
    "",
    "Responsável pela cotação: Júlia",
    "",
    "Informações complementares:",
    "",
  ].join("\n");
}

// Allowlist of locations where this automation runs. Defaults to Sabrina's
// subaccount; override with COTACAO_OPP_LOCATION_IDS (comma-separated).
const ALLOWED_LOCATIONS = new Set(
  (process.env.COTACAO_OPP_LOCATION_IDS ?? "K9b92VcD0KdCMIn60y0W")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
export function locationAllowed(locationId: string): boolean {
  return ALLOWED_LOCATIONS.size === 0 || ALLOWED_LOCATIONS.has(locationId);
}

// Optional extra guard: when set, the opportunity's stage (name or id) must
// contain this substring (case-insensitive) for a task to be created — a
// backstop in case the GHL workflow trigger isn't scoped tightly. When unset we
// trust the workflow's own pipeline/stage filter.
const STAGE_GUARD = (process.env.COTACAO_OPP_STAGE ?? "").trim().toLowerCase();
export function stageAllowed(stage?: string | null): boolean {
  if (!STAGE_GUARD) return true;
  return !!stage && stage.toLowerCase().includes(STAGE_GUARD);
}

// Optional fixed assignee (e.g. Julia's GHL user id). When unset, we fall back
// to whatever assignee the webhook provides (the opportunity owner).
const FIXED_ASSIGNEE = (process.env.COTACAO_OPP_ASSIGNEE ?? "").trim() || null;

async function scoped<T>(locationId: string, fn: (tx: typeof db) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
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

export type OppCotacaoResult = {
  created: boolean;
  taskId?: string;
  reason?: string;
};

export async function createCotacaoTaskFromOpp(
  input: OppCotacaoInput,
): Promise<OppCotacaoResult> {
  if (!input.locationId) return { created: false, reason: "missing_location" };
  if (!locationAllowed(input.locationId)) {
    return { created: false, reason: "location_not_allowed" };
  }
  if (!stageAllowed(input.stage)) {
    return { created: false, reason: "stage_not_matched" };
  }

  const leadName = (input.name ?? "").trim();
  const assignee = FIXED_ASSIGNEE ?? (input.assignedTo?.trim() || null);
  // Stable dedup marker: prefer the opportunity id, else the contact id.
  const marker = input.opportunityId
    ? `cotacao-opp:${input.opportunityId}`
    : input.contactId
      ? `cotacao-opp:c:${input.contactId}`
      : null;

  const result = await scoped(input.locationId, async (tx) => {
    const board =
      (await routedBoard(tx, input.locationId, assignee)) ??
      (await defaultBoard(tx, input.locationId));
    // Proposal tasks land in the dedicated "Cotação" stage (created first on
    // the board if missing).
    const ensured = await ensureCotacaoStage(tx, board);
    const stages = ensured.stages;
    const status = ensured.stageId;
    const doneSet = doneStageIds(stages);

    // Don't stack duplicates: skip if an OPEN cotação task already exists for
    // this opportunity/contact.
    if (marker) {
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

    const base = seedTitleForType(PROPOSAL_TASK_TYPE); // "Proposta de cotação: "
    const title = leadName ? `${base}${leadName}` : base;

    const [created] = await tx
      .insert(tasks)
      .values({
        locationId: input.locationId,
        boardId: board.id,
        title,
        note: buildCotacaoNote(input),
        status,
        color: "blue",
        priority: "high",
        contactId: input.contactId ?? null,
        position: count,
        createdBy: "opportunity",
        source: "native",
        externalId: marker,
      })
      .returning({ id: tasks.id });
    if (!created) return { created: false, reason: "insert_failed" };

    if (assignee) {
      await tx
        .insert(taskAssignees)
        .values({
          taskId: created.id,
          userId: assignee,
          locationId: input.locationId,
        })
        .onConflictDoNothing();
      await tx.insert(notifications).values({
        locationId: input.locationId,
        userId: assignee,
        type: "assigned",
        taskId: created.id,
        title: "Nova cotação para montar",
        body: title,
        actorId: null,
      });
    }
    return { created: true, taskId: created.id };
  });

  // Desktop/push alert to the assignee (best-effort, post-commit).
  if (result.created && assignee) {
    const { locationId } = input;
    const cid = input.contactId;
    const url = cid ? ghlContactUrl(locationId, cid) : ghlDashboardUrl(locationId);
    after(() =>
      sendPushToUser(locationId, assignee, {
        title: "Nova cotação para montar",
        body: leadName || "Novo contato",
        url,
        tag: `cotacao-${result.taskId}`,
      }),
    );
  }
  return result;
}
