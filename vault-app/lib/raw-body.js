/**
 * Lê o body cru de um request Vercel Serverless. Necessário para
 * validar assinaturas de webhook (Stripe e GHL exigem o byte exato
 * que o servidor enviou).
 *
 * Uso: setar `export const config = { api: { bodyParser: false } }`
 * na rota e chamar `await readRawBody(req)`.
 */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
