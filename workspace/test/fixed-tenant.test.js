/**
 * Modo de tenant fixo (WORKSPACE_FIXED_TENANT_ID).
 *
 * Primeira fase: uma subconta só usa o Workspace, sem SSO. O que precisa
 * ficar travado por teste é que o modo só existe quando a variável está
 * definida, e que ele não vira uma porta para outros tenants.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { resolveContext, WorkspaceError } from "../lib/server/context.js";

const FIXED = "mqO0er6vDQahqWGS1FYJ";

function reset() {
  __setDbClient(createFakeDb());
  delete process.env.WORKSPACE_FIXED_TENANT_ID;
  delete process.env.ADMIN_URL_SECRET;
  delete process.env.WORKSPACE_FIXED_USER_KEY;
}

const bareRequest = { headers: {}, query: {} };

test("sem a variável, requisição sem credencial é recusada", async () => {
  reset();
  await assert.rejects(
    () => resolveContext(bareRequest),
    (err) => err instanceof WorkspaceError && err.status === 401 && err.code === "missing_session",
  );
});

test("com a variável, requisição sem credencial entra como owner do tenant fixo", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  const ctx = await resolveContext(bareRequest);
  assert.equal(ctx.tenantId, FIXED);
  assert.equal(ctx.role, "owner");
  assert.ok(ctx.workspaceId);
});

test("o modo fixo ignora tenantId vindo da query — não é uma porta para outros tenants", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  const ctx = await resolveContext({ headers: {}, query: { tenantId: "outro_qualquer" } });
  assert.equal(ctx.tenantId, FIXED);
});

test("chamadas repetidas reaproveitam o mesmo workspace", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  const a = await resolveContext(bareRequest);
  const b = await resolveContext(bareRequest);
  assert.equal(a.workspaceId, b.workspaceId);
});

test("o JWT do SSO continua tendo precedência sobre o tenant fixo", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  process.env.JWT_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");
  const { sign } = await import("../lib/server/jwt.js");
  const token = sign({ locationId: "outra_location", userId: "u1", role: "admin" });

  const ctx = await resolveContext({ headers: { "x-spark-session": token }, query: {} });
  assert.equal(ctx.tenantId, "outra_location");
  assert.equal(ctx.role, "admin");
  delete process.env.JWT_SIGNING_KEY;
});

test("token inválido é recusado mesmo com tenant fixo ligado", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  process.env.JWT_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");
  await assert.rejects(
    () => resolveContext({ headers: { "x-spark-session": "nao.e.um.jwt" }, query: {} }),
    (err) => err instanceof WorkspaceError && err.code === "invalid_session",
  );
  delete process.env.JWT_SIGNING_KEY;
});

/* ------------------------------------------------------------------ */
/* Duas contas, um banco só                                           */
/* ------------------------------------------------------------------ */

/**
 * Cada conta tem o seu deploy, e os deploys dividem o mesmo Postgres. O
 * que separa uma da outra é o tenant — então o caminho de suporte, que
 * aceita `?tenantId=` livre, não pode ser uma ponte entre elas.
 *
 * Isto foi verificado em produção antes de existir a trava: a instância
 * de uma conta, com a chave de suporte, devolvia as 12 páginas da outra.
 */
const OUTRO_TENANT = "zFrqRkebl6dO8uI45jjC";

test("no deploy de conta fixa, o suporte não alcança outro tenant", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  process.env.ADMIN_URL_SECRET = "segredo-de-suporte";
  await assert.rejects(
    () => resolveContext({ headers: {}, query: { k: "segredo-de-suporte", tenantId: OUTRO_TENANT } }),
    (err) => err instanceof WorkspaceError && err.status === 403
      && err.code === "tenant_not_allowed_here",
  );
});

test("o suporte continua entrando no tenant do próprio deploy", async () => {
  reset();
  process.env.WORKSPACE_FIXED_TENANT_ID = FIXED;
  process.env.ADMIN_URL_SECRET = "segredo-de-suporte";
  const ctx = await resolveContext({
    headers: {}, query: { k: "segredo-de-suporte", tenantId: FIXED },
  });
  assert.equal(ctx.tenantId, FIXED);
  assert.equal(ctx.role, "owner");
});

test("sem conta fixa, o suporte segue alcançando qualquer tenant", async () => {
  // É o modo multi-tenant do Hub: lá o suporte precisa mesmo poder abrir
  // a conta de quem abriu o chamado. A trava é só do deploy de conta fixa.
  reset();
  process.env.ADMIN_URL_SECRET = "segredo-de-suporte";
  const ctx = await resolveContext({
    headers: {}, query: { k: "segredo-de-suporte", tenantId: OUTRO_TENANT },
  });
  assert.equal(ctx.tenantId, OUTRO_TENANT);
});
