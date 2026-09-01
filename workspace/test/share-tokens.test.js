/**
 * Tokens do QR code.
 *
 * O token É a credencial de quem lê o código, sem sessão nenhuma. O que
 * precisa valer: ser estável (QR impresso não pode parar de funcionar),
 * ser revogável, e não servir para nada além daquela ficha.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __setDbClient } from "../lib/server/db.js";
import { createFakeDb } from "./helpers/fake-db.js";
import { ensureWorkspace, WorkspaceError } from "../lib/server/context.js";
import { createPage } from "../lib/server/pages.js";
import {
  ensureShareToken, resolveShareToken, revokeShareToken, recordShareUse,
} from "../lib/server/share.js";

async function setup(tenant = "loc_A", user = "user_1") {
  const ws = await ensureWorkspace(tenant, user);
  return { tenantId: tenant, userKey: user, role: "owner", workspaceId: ws.id };
}

async function comFicha() {
  __setDbClient(createFakeDb());
  const ctx = await setup();
  const page = await createPage(ctx, { title: "Ficha" });
  return { ctx, page };
}

test("o token é estável: reabrir a ficha não invalida o QR impresso", async () => {
  const { ctx, page } = await comFicha();
  const a = await ensureShareToken(ctx, page.id);
  const b = await ensureShareToken(ctx, page.id);
  assert.equal(a.token, b.token);
  assert.equal(a.id, b.id);
});

test("cada ficha tem o seu token", async () => {
  const { ctx, page } = await comFicha();
  const outra = await createPage(ctx, { title: "Outra" });
  const a = await ensureShareToken(ctx, page.id);
  const b = await ensureShareToken(ctx, outra.id);
  assert.notEqual(a.token, b.token);
});

test("o token é longo e aleatório o bastante para não ser adivinhado", async () => {
  const { ctx, page } = await comFicha();
  const { token } = await ensureShareToken(ctx, page.id);
  assert.ok(token.length >= 40, `token de ${token.length} caracteres`);
  assert.match(token, /^[A-Za-z0-9_-]+$/, "precisa caber numa URL sem escapar");
});

test("resolver o token devolve a ficha certa", async () => {
  const { ctx, page } = await comFicha();
  const { token } = await ensureShareToken(ctx, page.id);
  const achado = await resolveShareToken(token);
  assert.equal(achado.page_id, page.id);
});

test("token inventado, curto ou vazio não resolve nada", async () => {
  await comFicha();
  for (const ruim of [null, undefined, "", "curto", "x".repeat(43), 12345]) {
    assert.equal(await resolveShareToken(ruim), null, String(ruim));
  }
});

test("revogar corta aquele QR e o próximo já é outro", async () => {
  const { ctx, page } = await comFicha();
  const antigo = await ensureShareToken(ctx, page.id);
  await revokeShareToken(ctx, page.id);

  assert.equal(await resolveShareToken(antigo.token), null, "o QR revogado ainda abre");

  const novo = await ensureShareToken(ctx, page.id);
  assert.notEqual(novo.token, antigo.token);
  assert.ok(await resolveShareToken(novo.token), "o QR novo precisa funcionar");
});

test("revogar uma ficha não derruba o QR das outras", async () => {
  const { ctx, page } = await comFicha();
  const outra = await createPage(ctx, { title: "Outra" });
  const a = await ensureShareToken(ctx, page.id);
  const b = await ensureShareToken(ctx, outra.id);

  await revokeShareToken(ctx, page.id);
  assert.equal(await resolveShareToken(a.token), null);
  assert.ok(await resolveShareToken(b.token), "o QR da outra ficha caiu junto");
});

test("outra conta não revoga o token desta", async () => {
  const { ctx, page } = await comFicha();
  const alheio = await setup("loc_B", "user_2");
  const meu = await ensureShareToken(ctx, page.id);

  await revokeShareToken(alheio, page.id);
  assert.ok(await resolveShareToken(meu.token), "outra conta derrubou o QR");
});

test("ficha sem id é recusada em vez de gerar token solto", async () => {
  const { ctx } = await comFicha();
  await assert.rejects(() => ensureShareToken(ctx, null),
    (e) => e instanceof WorkspaceError && e.code === "missing_id");
});

test("o uso é contado, para dar para auditar depois", async () => {
  const { ctx, page } = await comFicha();
  const token = await ensureShareToken(ctx, page.id);
  await recordShareUse(token.id, token.use_count);
  const depois = await resolveShareToken(token.token);
  assert.equal(depois.use_count, 1);
});
