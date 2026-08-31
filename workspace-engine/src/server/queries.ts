import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { pages, blocks, type Page, type Block } from "./schema";
import { getWorkspaceId } from "./workspace";

export type PageNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: Page["icon"];
  position: number;
  isFavorite: boolean;
  children: PageNode[];
};

/** Full page tree (non-archived), nested. */
export async function getPageTree(): Promise<PageNode[]> {
  const wid = await getWorkspaceId();
  const rows = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      icon: pages.icon,
      position: pages.position,
      isFavorite: pages.isFavorite,
    })
    .from(pages)
    .where(and(eq(pages.workspaceId, wid), isNull(pages.archivedAt)))
    .orderBy(asc(pages.position), asc(pages.createdAt));

  const byId = new Map<string, PageNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function getFavorites() {
  const wid = await getWorkspaceId();
  return db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.workspaceId, wid), eq(pages.isFavorite, true), isNull(pages.archivedAt)))
    .orderBy(asc(pages.title));
}

export async function getPage(pageId: string): Promise<Page | null> {
  const wid = await getWorkspaceId();
  const [p] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.workspaceId, wid)))
    .limit(1);
  return p ?? null;
}

export async function getBlocks(pageId: string): Promise<Block[]> {
  const wid = await getWorkspaceId();
  return db
    .select()
    .from(blocks)
    .where(and(eq(blocks.pageId, pageId), eq(blocks.workspaceId, wid)))
    .orderBy(asc(blocks.position), asc(blocks.createdAt));
}

/** Ancestor chain (root → page) for breadcrumbs. */
export async function getBreadcrumb(
  pageId: string,
): Promise<Array<{ id: string; title: string; icon: Page["icon"] }>> {
  const wid = await getWorkspaceId();
  const all = await db
    .select({ id: pages.id, parentId: pages.parentId, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(eq(pages.workspaceId, wid));
  const map = new Map(all.map((p) => [p.id, p]));
  const chain: Array<{ id: string; title: string; icon: Page["icon"] }> = [];
  let cur = map.get(pageId);
  let guard = 0;
  while (cur && guard++ < 50) {
    chain.unshift({ id: cur.id, title: cur.title, icon: cur.icon });
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return chain;
}
