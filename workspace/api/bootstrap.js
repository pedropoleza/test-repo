/**
 * GET /api/workspace/bootstrap
 *
 * Um único request para montar o shell: workspace, árvore da sidebar,
 * favoritos e recentes. Evita o waterfall de 4 chamadas no primeiro
 * paint e não carrega conteúdo de página nenhuma (§75).
 *
 * Auth: x-spark-session (JWT do SSO) ou admin key + ?tenantId.
 */
import { resolveContext, sendError } from "../lib/server/context.js";
import { listTree, listFavorites, listRecent } from "../lib/server/pages.js";
import { listSections } from "../lib/server/sections.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const ctx = await resolveContext(req);
    const includeArchived = req.query?.includeArchived === "1";
    const [tree, favorites, recent, sections] = await Promise.all([
      listTree(ctx, { includeArchived }),
      listFavorites(ctx),
      listRecent(ctx),
      listSections(ctx),
    ]);

    return res.status(200).json({
      workspace: {
        id: ctx.workspaceId,
        name: ctx.workspace.name,
        iconType: ctx.workspace.icon_type,
        iconValue: ctx.workspace.icon_value,
      },
      viewer: { userKey: ctx.userKey, role: ctx.role, tenantId: ctx.tenantId },
      pages: tree,
      sections,
      favorites,
      recent,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("workspace.bootstrap.failed", { error: err.message });
    return sendError(res, err);
  }
}
