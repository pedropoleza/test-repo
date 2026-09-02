/**
 * Cliente do GHL: tradução de erro, retry e paginação — sem rede.
 * O fetch global é substituído por um duplo controlado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ghlFetch, checkScopes, listContacts, GhlError, __clearGhlCache,
} from "../lib/server/ghl.js";

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
  // Sem isto, a memoização de custom fields/tags/pipelines serve o
  // resultado do teste anterior e o caso seguinte mede outra coisa.
  __clearGhlCache();
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

/* ------------------------------------------------------------------ */
/* O status não pode dizer "pronto" com o CRM fora                    */
/* ------------------------------------------------------------------ */

const { __status } = await import("../api/crm.js");

test("token de outra subconta: o status diz que NÃO está pronto", async () => {
  // Este é o caso real da segunda conta: o token é válido, mas foi
  // gerado dentro de outra subconta. As seis sondagens voltam 403 e
  // nenhuma é `missing_scope` — o status dizia `ready: true` com seis
  // erros ao lado, que é a pior forma de errar num diagnóstico.
  setup();
  stub(() => json(403, { message: "The token does not have access to this location." }));
  const s = await __status();

  assert.equal(s.ready, false);
  assert.equal(s.missingScopes.length, 0, "não é problema de escopo");
  assert.equal(s.failing.length, 6, "as seis sondagens falharam");
  assert.match(s.fix, /gerado DENTRO da subconta/);
  teardown();
});

test("faltando escopo, o status segue apontando os escopos", async () => {
  setup();
  stub(() => json(401, { message: "The token is not authorized for this scope." }));
  const s = await __status();
  assert.equal(s.ready, false);
  assert.ok(s.missingScopes.length > 0);
  assert.match(s.fix, /Private Integration|escopo|leitura/i);
  teardown();
});

test("com tudo respondendo, o status diz que está pronto", async () => {
  setup();
  stub((url) => {
    if (url.includes("/locations/")) return json(200, { location: { id: "loc_teste", name: "Conta" } });
    if (url.includes("customFields")) return json(200, { customFields: [] });
    if (url.includes("/tags")) return json(200, { tags: [] });
    if (url.includes("pipelines")) return json(200, { pipelines: [] });
    if (url.includes("opportunities")) return json(200, { opportunities: [] });
    return json(200, { contacts: [] });
  });
  const s = await __status();
  assert.equal(s.ready, true);
  assert.deepEqual(s.failing, []);
  assert.equal(s.location.name, "Conta");
  teardown();
});
