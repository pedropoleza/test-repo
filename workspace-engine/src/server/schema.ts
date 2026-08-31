/**
 * Workspace Engine — Phase 0 data model (schema `workspace_engine`).
 *
 * Hybrid model (spec §68): relational for hierarchy (pages tree, blocks tree),
 * JSONB for rich text / config / icon / cover. Every row carries workspace_id
 * and every query filters by it (spec §63 multi-tenancy).
 */
import {
  pgSchema,
  uuid,
  text,
  jsonb,
  boolean,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const ws = pgSchema("workspace_engine");

export type Icon = { type: "emoji" | "url"; value: string } | null;
export type Cover = {
  type: "color" | "gradient" | "url";
  value: string;
  positionY?: number;
} | null;

export const workspaces = ws.table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id"),
  name: text("name").notNull().default("Workspace"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pages = ws.table(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    parentId: uuid("parent_id"),
    title: text("title").notNull().default("Untitled"),
    icon: jsonb("icon").$type<Icon>(),
    cover: jsonb("cover").$type<Cover>(),
    position: doublePrecision("position").notNull().default(0),
    visibility: text("visibility").notNull().default("private").$type<"private" | "shared">(),
    isFavorite: boolean("is_favorite").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    source: text("source"),
    sourceExternalId: text("source_external_id"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pages_workspace_idx").on(t.workspaceId),
    index("pages_tree_idx").on(t.workspaceId, t.parentId, t.position),
    index("pages_archived_idx").on(t.workspaceId, t.archivedAt),
  ],
);

/** Block content is JSONB: { text?: RichText[], ...typeSpecific }. */
export type RichSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  link?: string;
};
export type BlockContent = {
  text?: RichSpan[];
  checked?: boolean; // checklist
  language?: string; // code
  emoji?: string; // callout
};

export const BLOCK_TYPES = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulleted_list",
  "numbered_list",
  "checklist",
  "quote",
  "callout",
  "code",
  "divider",
  "toggle",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const blocks = ws.table(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    pageId: uuid("page_id").notNull(),
    parentBlockId: uuid("parent_block_id"),
    type: text("type").notNull().default("paragraph").$type<BlockType>(),
    content: jsonb("content").notNull().default({}).$type<BlockContent>(),
    position: doublePrecision("position").notNull().default(0),
    source: text("source"),
    sourceExternalId: text("source_external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("blocks_page_idx").on(t.pageId),
    index("blocks_tree_idx").on(t.pageId, t.parentBlockId, t.position),
  ],
);

export type Page = typeof pages.$inferSelect;
export type Block = typeof blocks.$inferSelect;
