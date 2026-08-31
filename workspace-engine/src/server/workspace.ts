import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { workspaces } from "./schema";

/**
 * Tenant seam. For now the app operates on a single default workspace — this is
 * the ONE place to swap for the existing product's auth/org resolution later
 * (spec §62/§63). Every data access goes through the returned workspaceId.
 */
let cached: string | null = null;

export async function getWorkspaceId(): Promise<string> {
  if (cached) return cached;
  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (existing) {
    cached = existing.id;
    return existing.id;
  }
  const [created] = await db
    .insert(workspaces)
    .values({ name: "My Workspace" })
    .returning({ id: workspaces.id });
  cached = created!.id;
  return created!.id;
}

export async function getWorkspace() {
  const id = await getWorkspaceId();
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return w!;
}
