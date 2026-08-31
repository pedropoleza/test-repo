/**
 * Reexport da ordenação fracionária, que é compartilhada com o browser.
 *
 * O editor calcula a mesma chave que o servidor para renderizar de forma
 * otimista; ter duas implementações seria garantia de divergência.
 * Mesmo padrão de src/workspace/shared/blocks.js.
 */
export * from "../../../src/workspace/shared/fracdex.js";
