/**
 * Cliente do GHL: tradução de erro, retry e paginação — sem rede.
 * O fetch global é substituído por um duplo controlado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ghlFetch, checkScopes, listContacts, GhlError } from "../lib/server/ghl.js";

const realFetch = globalThis.fetch;
function stub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return calls;
}
function json(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  };
}

function setup() {
  process.env.GHL_LOCATION_TOKEN = "tok_teste";
  process.env.GHL_LOCATION_ID = "loc_teste";
}
function teardown() {
  globalThis.fetch = realFetch;
  delete process.env.GHL_LOCATION_TOKEN;
  delete process.env.GHL_LOCATION_ID;
}

test("401 por escopo é distinguido de token inválido", async () => {
  setup();
  stub(() => json(401, { message: "The token is not authorized for this scope." }));
  await assert.rejects(() => ghlFetch("/contacts/"),
    (err) => err instanceof GhlError && err.code === "missing_scope");

  stub(() => json(401, { message: "Invalid JWT" }));
  await assert.rejects(() => ghlFetch("/contacts/"),
    (err) => err.code === "invalid_token");
  teardown();
});

test("sem token configurado a chamada falha antes de sair da máquina", async () => {
  globalThis.fetch = async () => { throw new Error("não deveria chamar a rede"); };
  delete process.env.GHL_LOCATION_TOKEN;
  delete process.env.GHL_AGENCY_PIT;
  await assert.rejects(() => ghlFetch("/contacts/"),
    (err) => err.code === "ghl_not_configured");
  globalThis.fetch = realFetch;
});

test("429 é respeitado e a chamada é repetida", async () => {
  setup();
  const calls = stub((url, init, n) =>
    n === 1 ? json(429, { message: "rate" }, { "retry-after": "0" })
            : json(200, { contacts: [] }));
  const out = await ghlFetch("/contacts/");
  assert.deepEqual(out, { contacts: [] });
  assert.equal(calls.length, 2);
  teardown();
});

test("erro de rede tem backoff; erro de negócio não repete", async () => {
  setup();
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n < 3) throw new Error("ECONNRESET");
    return json(200, { ok: true });
  };
  assert.deepEqual(await ghlFetch("/x"), { ok: true });
  assert.equal(n, 3);

  n = 0;
  globalThis.fetch = async () => { n += 1; return json(404, { message: "sumiu" }); };
  await assert.rejects(() => ghlFetch("/y"), (err) => err.status === 404);
  assert.equal(n, 1, "404 não deve ser repetido");
  teardown();
});

test("o token vai no header e nunca na URL", async () => {
  setup();
  const calls = stub(() => json(200, { contacts: [] }));
  await ghlFetch("/contacts/", { query: { locationId: "loc_teste" } });
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok_teste");
  assert.equal(calls[0].url.includes("tok_teste"), false);
  assert.equal(calls[0].init.headers.Version, "2021-07-28");
  teardown();
});

test("listContacts segue a paginação até o limite pedido", async () => {
  setup();
  stub((url) => {
    const u = new URL(url);
    if (!u.searchParams.get("startAfterId")) {
      return json(200, {
        contacts: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })),
        meta: { startAfterId: "a99", startAfter: 1 },
      });
    }
    return json(200, { contacts: [{ id: "b0" }, { id: "b1" }], meta: {} });
  });
  const out = await listContacts({ limit: 150 });
  assert.equal(out.length, 102);
  assert.equal(out[0].id, "a0");
  assert.equal(out[101].id, "b1");
  teardown();
});

test("checkScopes reporta cada recurso separadamente", async () => {
  setup();
  stub((url) => {
    if (url.includes("/contacts/")) {
      return json(401, { message: "The token is not authorized for this scope." });
    }
    if (url.includes("/locations/")) return json(200, { location: { id: "loc_teste" } });
    return json(200, { pipelines: [], opportunities: [], tags: [] });
  });
  const scopes = await checkScopes("loc_teste");
  assert.equal(scopes.location.ok, true);
  assert.equal(scopes.contacts.ok, false);
  assert.equal(scopes.contacts.code, "missing_scope");
  assert.equal(scopes.pipelines.ok, true);
  teardown();
});
