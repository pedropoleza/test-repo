"use server";

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import {
  pages,
  blocks,
  type Icon,
  type Cover,
  type BlockType,
  type BlockContent,
} from "./schema";
import { getWorkspaceId } from "./workspace";

// --------------------------------------------------------------------------
// Position helpers (midpoint ordering — spec §11 "fractional or equivalent")
// --------------------------------------------------------------------------

async function nextPagePosition(wid: string, parentId: string | null) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${pages.position}), 0)` })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, wid),
        parentId === null
          ? sql`${pages.parentId} is null`
          : eq(pages.parentId, parentId),
      ),
    );
  return (row?.max ?? 0) + 1000;
}

async function nextBlockPosition(pageId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${blocks.position}), 0)` })
    .from(blocks)
    .where(eq(blocks.pageId, pageId));
  return (row?.max ?? 0) + 1000;
}

// --------------------------------------------------------------------------
// Pages
// --------------------------------------------------------------------------

export async function createPage(input: {
  parentId?: string | null;
  title?: string;
}): Promise<{ id: string }> {
  const wid = await getWorkspaceId();
  const parentId = input.parentId ?? null;
  const position = await nextPagePosition(wid, parentId);
  const [created] = await db
    .insert(pages)
    .values({
      workspaceId: wid,
      parentId,
      title: input.title?.trim() || "Untitled",
      position,
    })
    .returning({ id: pages.id });
  revalidatePath("/", "layout");
  return { id: created!.id };
}

export async function renamePage(id: string, title: string) {
  const wid = await getWorkspaceId();
  await db
    .update(pages)
    .set({ title: title.trim() || "Untitled", updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

export async function setPageIcon(id: string, icon: Icon) {
  const wid = await getWorkspaceId();
  await db
    .update(pages)
    .set({ icon, updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

export async function setPageCover(id: string, cover: Cover) {
  const wid = await getWorkspaceId();
  await db
    .update(pages)
    .set({ cover, updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

export async function toggleFavorite(id: string) {
  const wid = await getWorkspaceId();
  await db
    .update(pages)
    .set({ isFavorite: sql`not ${pages.isFavorite}`, updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

/** Move a page under a new parent (or root) at the end of that list. */
export async function movePage(id: string, parentId: string | null) {
  const wid = await getWorkspaceId();
  if (id === parentId) return;
  const position = await nextPagePosition(wid, parentId);
  await db
    .update(pages)
    .set({ parentId, position, updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

/** Soft-delete (Trash). Cascade archive is handled by cascading FK on delete;
 * for archive we only flag the page — descendants follow via the tree filter. */
export async function archivePage(id: string) {
  const wid = await getWorkspaceId();
  await db
    .update(pages)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

export async function deletePage(id: string) {
  const wid = await getWorkspaceId();
  await db.delete(pages).where(and(eq(pages.id, id), eq(pages.workspaceId, wid)));
  revalidatePath("/", "layout");
}

// --------------------------------------------------------------------------
// Blocks
// --------------------------------------------------------------------------

export async function createBlock(input: {
  pageId: string;
  afterBlockId?: string | null;
  type?: BlockType;
  content?: BlockContent;
}): Promise<{ id: string; position: number }> {
  const wid = await getWorkspaceId();
  let position: number;
  if (input.afterBlockId) {
    const [after] = await db
      .select({ position: blocks.position })
      .from(blocks)
      .where(and(eq(blocks.id, input.afterBlockId), eq(blocks.pageId, input.pageId)))
      .limit(1);
    const [next] = await db
      .select({ position: blocks.position })
      .from(blocks)
      .where(and(eq(blocks.pageId, input.pageId), gt(blocks.position, after?.position ?? 0)))
      .orderBy(asc(blocks.position))
      .limit(1);
    const a = after?.position ?? 0;
    const b = next?.position ?? a + 2000;
    position = (a + b) / 2;
  } else {
    position = await nextBlockPosition(input.pageId);
  }
  const [created] = await db
    .insert(blocks)
    .values({
      workspaceId: wid,
      pageId: input.pageId,
      type: input.type ?? "paragraph",
      content: input.content ?? {},
      position,
    })
    .returning({ id: blocks.id, position: blocks.position });
  await touchPage(input.pageId, wid);
  return { id: created!.id, position: created!.position };
}

export async function updateBlock(
  id: string,
  patch: { type?: BlockType; content?: BlockContent },
) {
  const wid = await getWorkspaceId();
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.content !== undefined) set.content = patch.content;
  const [row] = await db
    .update(blocks)
    .set(set)
    .where(and(eq(blocks.id, id), eq(blocks.workspaceId, wid)))
    .returning({ pageId: blocks.pageId });
  if (row) await touchPage(row.pageId, wid);
}

export async function moveBlock(id: string, position: number) {
  const wid = await getWorkspaceId();
  await db
    .update(blocks)
    .set({ position, updatedAt: sql`now()` })
    .where(and(eq(blocks.id, id), eq(blocks.workspaceId, wid)));
}

export async function deleteBlock(id: string) {
  const wid = await getWorkspaceId();
  const [row] = await db
    .delete(blocks)
    .where(and(eq(blocks.id, id), eq(blocks.workspaceId, wid)))
    .returning({ pageId: blocks.pageId });
  if (row) await touchPage(row.pageId, wid);
}

async function touchPage(pageId: string, wid: string) {
  await db
    .update(pages)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(pages.id, pageId), eq(pages.workspaceId, wid)));
}
