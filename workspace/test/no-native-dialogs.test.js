/**
 * Nenhum campo pode usar o diálogo do navegador.
 *
 * window.prompt/confirm/alert usam a fonte e o tema do sistema, mostram o
 * domínio do site no título, não validam, não explicam o que um valor
 * vazio faz e travam a página inteira. Já vazaram para a interface uma
 * vez (o campo de link) depois de terem sido removidos das seções, então
 * o teste existe para a volta ser barrada aqui, e não pelo usuário.
 *
 * Os substitutos são openPrompt/openCopyLink em src/ui/prompt.js e
 * confirmDialog em app.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const PROIBIDO = /\b(?:window\.)?(prompt|confirm|alert)\s*\(/;

/** Onde a regra vale: código que roda no browser e nas rotas. */
const PASTAS = ["src", "api", "lib"];

/** Comentários e strings citam os nomes de propósito; o teste olha código. */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function arquivosJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) arquivosJs(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("nenhum diálogo nativo do navegador no código", () => {
  const culpados = [];
  for (const pasta of PASTAS) {
    const dir = path.join(RAIZ, pasta);
    if (!fs.existsSync(dir)) continue;
    for (const arquivo of arquivosJs(dir)) {
      const linhas = semComentarios(fs.readFileSync(arquivo, "utf8")).split("\n");
      linhas.forEach((linha, i) => {
        // confirmDialog e confirmLabel são nossos e contêm "confirm".
        const limpa = linha.replace(/confirmDialog|confirmLabel|confirmed?\b/g, "");
        if (PROIBIDO.test(limpa)) {
          culpados.push(`${path.relative(RAIZ, arquivo)}:${i + 1} → ${linha.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(culpados, [],
    "use openPrompt/openCopyLink (src/ui/prompt.js) ou confirmDialog");
});
