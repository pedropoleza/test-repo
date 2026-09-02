/**
 * Contexto de requisição do Workspace Engine: quem é o usuário, qual o
 * tenant e qual o workspace.
 *
 * Reusa a autenticação que já existe no produto — o JWT curto emitido em
 * /api/auth/ghl-context a partir do SSO do GHL. NÃO cria login próprio.
 *
 * MULTI-TENANCY (§63): `tenant_id` vem SEMPRE do token, nunca do body ou
 * da query. Toda query do módulo passa por `workspace_id`, que por sua
 * vez é derivado do tenant autenticado. Um id sozinho nunca é suficiente
 * para ler um recurso.
 */
import { timingSafeEqual } from "node:crypto";
import { verify as jwtVerify } from "./jwt.js";
import { db } from "./db.js";
import { firstKey } from "../../src/shared/fracdex.js";

export class WorkspaceError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Papéis do §62, do mais forte para o mais fraco. */
export const ROLES = ["owner", "admin", "editor", "commenter", "viewer"];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, ROLES.length - i]));

export function roleAtLeast(role, minimum) {
  return (RANK[role] || 0) >= (RANK[minimum] || 0);
}

export function requireRole(ctx, minimum) {
  if (!roleAtLeast(ctx.role, minimum)) {
    throw new WorkspaceError(403, "insufficient_role", { need: minimum, have: ctx.role });
  }
}

function parseCookies(req) {
  const raw = req.headers?.cookie || "";
  const out = {};
  raw.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

function checkAdminKey(req) {
  const expected = process.env.ADMIN_URL_SECRET;
  if (!expected) return false;
  const cookies = parseCookies(req);
  const provided =
    req.headers["x-spark-admin-key"] || cookies["spark_admin_key"] || req.query?.k;
  if (!provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Traduz o papel do GHL para o papel do workspace. */
function mapRole(claims) {
  if (claims.type === "agency") return "owner";
  if (claims.role === "admin") return "admin";
  if (claims.role) return "editor";
  return "viewer";
}

/**
 * Resolve o contexto autenticado.
 *
 * Caminho 1 (usuário final): JWT do SSO do GHL.
 * Caminho 2 (operador Spark): ADMIN_URL_SECRET + ?tenantId — mesmo
 *   mecanismo já usado por /api/admin/*, para suporte.
 * Caminho 3 (modo tenant fixo): WORKSPACE_FIXED_TENANT_ID definido.
 *   Sem SSO, sem chave: qualquer requisição entra como owner daquele
 *   tenant. É o modo da primeira fase, com uma única subconta usando o
 *   Workspace.
 *
 *   ATENÇÃO: enquanto essa variável existir, quem tiver a URL tem acesso
 *   total de leitura e escrita ao workspace desse tenant. Não há login.
 *   Para encerrar o modo, basta apagar a variável — o código volta a
 *   exigir SSO sem mudança nenhuma.
 */
export async function resolveContext(req, { ensure = true } = {}) {
  const token = req.headers["x-spark-session"] || req.query?.session;

  if (token) {
    let claims;
    try {
      claims = jwtVerify(token);
    } catch (err) {
      throw new WorkspaceError(401, "invalid_session", { reason: err.message });
    }
    if (!claims.locationId) throw new WorkspaceError(401, "session_without_tenant");
    return buildContext({
      tenantId: claims.locationId,
      userKey: claims.userId || claims.locationId,
      role: mapRole(claims),
      ensure,
    });
  }

  if (checkAdminKey(req)) {
    const tenantId = req.query?.tenantId;
    if (!tenantId || typeof tenantId !== "string") {
      throw new WorkspaceError(400, "missing_tenantId");
    }
    // Um deploy de conta fixa só fala do PRÓPRIO tenant, nem pelo
    // caminho de suporte.
    //
    // Sem esta trava, duas contas hospedadas no mesmo banco ficam a um
    // `?tenantId=` de distância uma da outra: quem tiver a chave de
    // suporte de qualquer um dos deploys lê o workspace do outro. Foi
    // verificado — a instância de uma conta devolvia as 12 páginas da
    // outra. O deploy fixo passa a ser incapaz disso, e não só proibido.
    //
    // O modo multi-tenant (sem a variável) segue como era: lá o suporte
    // precisa mesmo alcançar qualquer tenant.
    const fixo = process.env.WORKSPACE_FIXED_TENANT_ID;
    if (fixo && tenantId !== fixo) {
      throw new WorkspaceError(403, "tenant_not_allowed_here");
    }
    return buildContext({
      tenantId,
      userKey: `admin:${String(req.query?.as || "spark")}`,
      role: "owner",
      ensure,
    });
  }

  const fixedTenant = process.env.WORKSPACE_FIXED_TENANT_ID;
  if (fixedTenant) {
    return buildContext({
      tenantId: fixedTenant,
      userKey: process.env.WORKSPACE_FIXED_USER_KEY || `fixed:${fixedTenant}`,
      role: "owner",
      ensure,
    });
  }

  throw new WorkspaceError(401, "missing_session");
}

async function buildContext({ tenantId, userKey, role, ensure }) {
  const workspace = ensure
    ? await ensureWorkspace(tenantId, userKey)
    : await findWorkspace(tenantId);
  if (!workspace) throw new WorkspaceError(404, "workspace_not_found");
  return { tenantId, userKey, role, workspaceId: workspace.id, workspace };
}

export async function findWorkspace(tenantId, slug = "default") {
  const { data, error } = await db()
    .from("workspaces")
    .select("id,tenant_id,slug,name,icon_type,icon_value,settings,created_at")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return data || null;
}

/**
 * Cria o workspace do tenant na primeira visita. Idempotente: em corrida,
 * o unique index (tenant_id, slug) faz o insert falhar e relemos a linha.
 */
export async function ensureWorkspace(tenantId, createdBy, slug = "default") {
  const existing = await findWorkspace(tenantId, slug);
  if (existing) return existing;

  const { data, error } = await db()
    .from("workspaces")
    .insert({ tenant_id: tenantId, slug, name: "Workspace", created_by: createdBy })
    .select("id,tenant_id,slug,name,icon_type,icon_value,settings,created_at")
    .maybeSingle();

  if (error) {
    const again = await findWorkspace(tenantId, slug);
    if (again) return again;
    throw new WorkspaceError(500, "workspace_create_failed", { detail: error.message });
  }
  return data;
}

/** Posição inicial usada quando uma lista de irmãos está vazia. */
export { firstKey };

/** Envelope padrão de erro das rotas do módulo. */
export function sendError(res, err) {
  if (err instanceof WorkspaceError) {
    return res.status(err.status).json({ error: err.code, ...err.extra });
  }
  console.error("[workspace] unhandled:", err);
  return res.status(500).json({ error: "internal_error" });
}
