/**
 * Tokens do portal de status.
 *
 * Um token vivo por contato (reabrir reaproveita); resolver não filtra por
 * tenant (o token é a credencial); revogar corta o acesso e um novo pode
 * nascer depois.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import {
  ensureStatusToken, resolveStatusToken, revokeStatusToken,
} from "../lib/server/status-token.js";

async function setup(tenant = "loc_A") {
  __setDbClient(createFakeDb());
  const ws = await ensureWorkspace(tenant, "user_1");
  return { tenantId: tenant, userKey: "user_1", role: "owner", workspaceId: ws.id };
}

test("cria um token e reaproveita o mesmo na segunda vez", async () => {
  const ctx = await setup();
  const a = await ensureStatusToken(ctx, "c1");
  const b = await ensureStatusToken(ctx, "c1");
  assert.ok(a.token && a.token.length > 20);
  assert.equal(a.token, b.token);
});

test("contatos diferentes têm tokens diferentes", async () => {
  const ctx = await setup();
  const a = await ensureStatusToken(ctx, "c1");
  const b = await ensureStatusToken(ctx, "c2");
  assert.notEqual(a.token, b.token);
});

test("resolve pelo token, sem tenant", async () => {
  const ctx = await setup();
  const { token } = await ensureStatusToken(ctx, "c1");
  const r = await resolveStatusToken(token);
  assert.equal(r.contact_external_id, "c1");
  assert.equal(r.workspace_id, ctx.workspaceId);
});

test("token curto ou vazio não resolve", async () => {
  await setup();
  assert.equal(await resolveStatusToken(""), null);
  assert.equal(await resolveStatusToken("curto"), null);
  assert.equal(await resolveStatusToken(null), null);
});

test("revogar corta o acesso; um novo token nasce depois", async () => {
  const ctx = await setup();
  const antigo = await ensureStatusToken(ctx, "c1");
  await revokeStatusToken(ctx, "c1");
  assert.equal(await resolveStatusToken(antigo.token), null);
  const novo = await ensureStatusToken(ctx, "c1");
  assert.notEqual(novo.token, antigo.token);
});

test("sem contato, recusa", async () => {
  const ctx = await setup();
  await assert.rejects(() => ensureStatusToken(ctx, ""),
    (e) => e instanceof WorkspaceError && e.code === "missing_id");
});
