/**
 * Drizzle schema for Spark Tasks (Postgres schema `spark_tasks`).
 *
 * Isolation model (see plan §2, §5):
 *  - Every table carries `location_id text NOT NULL`. It is ALWAYS derived
 *    server-side from the validated SSO session and never accepted from the
 *    client.
 *  - RLS is the backstop: policies compare `location_id` against
 *    `current_setting('app.location_id')`, which the request transaction sets
 *    via `SET LOCAL`. The authoritative RLS + role setup lives in the SQL
 *    migration (drizzle/0000_init.sql) so we can also FORCE RLS and run the
 *    app under a non-superuser role — things the ORM schema alone can't express.
 */
import { sql } from "drizzle-orm";
import {
  pgSchema,
  text,
  uuid,
  integer,
  timestamp,
  index,
  primaryKey,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export const sparkTasks = pgSchema("spark_tasks");

/** Fixed color palette (D4, §6). */
export const TASK_COLORS = [
  "gray",
  "blue",
  "amber",
  "green",
  "red",
  "purple",
] as const;
export type TaskColor = (typeof TASK_COLORS)[number];

/**
 * A stage (column) of a pipeline. Stages are now DATA, defined per board, so
 * clients can add/rename/recolor/reorder them (ClickUp-style). `isDone` marks
 * a completion stage — moving a linked task into it triggers the D7 contact
 * write-back. `tasks.status` holds a stage id.
 */
export type Stage = {
  id: string;
  name: string;
  color: TaskColor;
  isDone?: boolean;
};

/** Seed stages for a new/default board. */
export const DEFAULT_STAGES: Stage[] = [
  { id: "todo", name: "To Do", color: "gray" },
  { id: "doing", name: "In Progress", color: "blue" },
  { id: "waiting", name: "Waiting", color: "amber" },
  { id: "done", name: "Done", color: "green", isDone: true },
];

export const TASK_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Lightweight embedded checklist — low-contention, saved wholesale. */
export type ChecklistItem = { id: string; text: string; done: boolean };

/** Card rendering style: color strip only, or soft-filled background. */
export const CARD_STYLES = ["strip", "filled"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const boards = sparkTasks.table(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    name: text("name").notNull().default("Tasks"),
    stages: jsonb("stages").notNull().$type<Stage[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("boards_location_idx").on(t.locationId)],
);

export const tasks = sparkTasks.table(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    /** Stage id (references a stage in the task's board). */
    status: text("status").notNull().default("todo"),
    color: text("color").notNull().default("gray").$type<TaskColor>(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    contactId: text("contact_id"),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").notNull(),
    priority: text("priority").notNull().default("none").$type<TaskPriority>(),
    cardStyle: text("card_style").notNull().default("strip").$type<CardStyle>(),
    /** 'native' (created here) or 'ghl' (mirrored from a GHL native task). */
    source: text("source").notNull().default("native").$type<"native" | "ghl">(),
    /** GHL task id this card mirrors (null for native tasks). */
    externalId: text("external_id"),
    /** True for recurring source tasks — rendered with a distinct badge. */
    recurring: boolean("recurring").notNull().default(false),
    labels: jsonb("labels").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    checklist: jsonb("checklist")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<ChecklistItem[]>(),
    /** Soft delete: archived tasks are hidden from the board by default. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Set once the D7 contact write-back succeeded — the idempotency flag. */
    completedWritebackAt: timestamp("completed_writeback_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tasks_location_idx").on(t.locationId),
    index("tasks_board_status_position_idx").on(
      t.boardId,
      t.status,
      t.position,
    ),
    index("tasks_contact_idx").on(t.contactId),
  ],
);

export const taskAssignees = sparkTasks.table(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    locationId: text("location_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_assignees_location_idx").on(t.locationId),
    index("task_assignees_user_idx").on(t.userId),
  ],
);

export const taskComments = sparkTasks.table(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("task_comments_task_idx").on(t.taskId, t.createdAt),
    index("task_comments_location_idx").on(t.locationId),
  ],
);

export const notifications = sparkTasks.table(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    /** Recipient GHL user id. */
    userId: text("user_id").notNull(),
    /** 'assigned' | 'comment'. */
    type: text("type").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    actorId: text("actor_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_recipient_idx").on(
      t.locationId,
      t.userId,
      t.createdAt,
    ),
  ],
);

/** Web Push subscriptions — one row per user+browser (endpoint unique). */
export const pushSubscriptions = sparkTasks.table(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("push_subs_recipient_idx").on(t.locationId, t.userId)],
);

/**
 * Agency-level GHL OAuth installation (plan §4.2). One row per company.
 *
 * This is agency-global infrastructure, NOT tenant data: it has no
 * `location_id`, carries the encrypted Company access/refresh token, and is
 * only ever touched by server-side system code (OAuth callback + token
 * exchange) running under the privileged connection. It is deliberately NOT
 * granted to `spark_tasks_app` and has no tenant RLS policy, so a
 * location-scoped request can never reach agency credentials.
 */
export const ghlInstallations = sparkTasks.table("ghl_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: text("scopes"),
  /** 'Company' (agency install) or 'Location' (subaccount install). */
  userType: text("user_type"),
  /** For Location installs: the location the token is scoped to (null = agency). */
  locationId: text("location_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Session GUC name RLS policies read. Kept in one place to avoid typos. */
export const LOCATION_GUC = "app.location_id" as const;

/**
 * Helper the tRPC middleware uses to scope a transaction to the session's
 * location. `set_config(..., true)` = SET LOCAL (rolled back at tx end).
 */
export function setLocationScope(locationId: string) {
  return sql`select set_config(${LOCATION_GUC}, ${locationId}, true)`;
}
