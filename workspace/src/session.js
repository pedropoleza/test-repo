/**
 * Sessão do Workspace — reusa exatamente o mesmo mecanismo do Hub de
 * Indicações: o JWT curto emitido por /api/auth/ghl-context a partir do
 * SSO do GHL, capturado de ?session= e guardado em sessionStorage.
 *
 * Não existe login próprio do módulo. Quando o Workspace for embutido no
 * app principal (segunda etapa), a sessão já vem pronta.
 */

const SESSION_KEY = "workspace:session";
const ADMIN_KEY = "workspace:adminKey";
const TENANT_KEY = "workspace:tenantId";

const params = new URLSearchParams(window.location.search);

function remember(storageKey, value) {
  if (!value) return;
  try {
    sessionStorage.setItem(storageKey, value);
  } catch {
    /* modo privado / storage bloqueado: segue só em memória */
  }
}

function recall(storageKey) {
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

const memory = {
  session: params.get("session") || null,
  adminKey: params.get("k") || null,
  tenantId: params.get("tenantId") || null,
};

remember(SESSION_KEY, memory.session);
remember(ADMIN_KEY, memory.adminKey);
remember(TENANT_KEY, memory.tenantId);

// Limpa credenciais da barra de endereço assim que capturadas.
if (memory.session || memory.adminKey) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.delete("k");
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* noop */
  }
}

export function getSession() {
  return memory.session || recall(SESSION_KEY);
}

export function getAdminKey() {
  return memory.adminKey || recall(ADMIN_KEY);
}

export function getTenantId() {
  return memory.tenantId || recall(TENANT_KEY);
}

export function hasCredentials() {
  return !!getSession() || !!(getAdminKey() && getTenantId());
}

export function authHeaders() {
  const headers = {};
  const session = getSession();
  if (session) headers["x-spark-session"] = session;
  const adminKey = getAdminKey();
  if (!session && adminKey) headers["x-spark-admin-key"] = adminKey;
  return headers;
}

/** Query string de tenant exigida pelo caminho de admin key. */
export function authQuery() {
  if (getSession()) return {};
  const tenantId = getTenantId();
  return tenantId ? { tenantId } : {};
}
