/**
 * Workspace Engine tables (Notion-like) — schema `workspace_engine`, living in
 * the SAME database as Spark Tasks. Tenanted by `workspace_id`, which is
 * resolved per GHL location (org_id = locationId). Accessed through the normal
 * scoped tx (role spark_tasks_app has been granted usage on this schema).
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

export const wsSchema = pgSchema("workspace_engine");

export type WsIcon = { type: "emoji" | "url"; value: string } | null;
export type WsCover = {
  type: "color" | "gradient" | "url";
  value: string;
  positionY?: number;
} | null;

export const wsWorkspaces = wsSchema.table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id"),
  name: text("name").notNull().default("Workspace"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wsPages = wsSchema.table(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    parentId: uuid("parent_id"),
    title: text("title").notNull().default("Untitled"),
    icon: jsonb("icon").$type<WsIcon>(),
    cover: jsonb("cover").$type<WsCover>(),
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
    index("we_pages_workspace_idx").on(t.workspaceId),
    index("we_pages_tree_idx").on(t.workspaceId, t.parentId, t.position),
  ],
);

export type WsRichSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  link?: string;
};
export type WsBlockContent = {
  text?: WsRichSpan[];
  checked?: boolean;
  language?: string;
  emoji?: string;
};

export const WS_BLOCK_TYPES = [
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
export type WsBlockType = (typeof WS_BLOCK_TYPES)[number];

export const wsBlocks = wsSchema.table(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    pageId: uuid("page_id").notNull(),
    parentBlockId: uuid("parent_block_id"),
    type: text("type").notNull().default("paragraph").$type<WsBlockType>(),
    content: jsonb("content").notNull().default({}).$type<WsBlockContent>(),
    position: doublePrecision("position").notNull().default(0),
    source: text("source"),
    sourceExternalId: text("source_external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("we_blocks_page_idx").on(t.pageId),
    index("we_blocks_tree_idx").on(t.pageId, t.parentBlockId, t.position),
  ],
);

export type WsPage = typeof wsPages.$inferSelect;
export type WsBlock = typeof wsBlocks.$inferSelect;
