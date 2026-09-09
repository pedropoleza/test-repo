/**
 * Portal de status do cliente.
 *
 *   GET  ?t=<token>[&lang=]     → página pública com o andamento (SEM sessão)
 *   GET  ?action=link&id=<c>    → { url, qr } para mostrar na ficha (autenticado)
 *   POST ?action=revoke {id}    → invalida o link daquele contato
 *
 * O token no endereço é a credencial de quem lê: dá acesso somente ao
 * status daquele contato, em leitura, e pode ser revogado. O idioma sai
 * do seletor na própria página (PT/EN/ES), sem depender de campo no CRM.
 */
import QRCode from "qrcode";
import {
  resolveContext, requireRole, sendError, WorkspaceError,
} from "../lib/server/context.js";
import { isConfigured } from "../lib/server/ghl.js";
import {
  ensureStatusToken, resolveStatusToken, recordStatusUse, revokeStatusToken,
} from "../lib/server/status-token.js";
import { buildStatusData } from "../lib/server/status-page.js";
import { traduzir, idiomaDoCliente } from "../src/shared/client-status.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  try {
    // Caminho público: o token é a credencial, vem antes de resolveContext.
    const token = req.query?.t;
    if (token) return await paginaPorToken(req, res, token);

    const ctx = await resolveContext(req);
    const body = parseBody(req);
    const action = req.query?.action || body.action || "link";

    if (action === "link") {
      requireRole(ctx, "editor");
      const contactId = req.query?.id || body.contactId;
      const t = await ensureStatusToken(ctx, contactId);
      const url = urlDoPortal(req, t.token);
      return res.status(200).json({
        url,
        qr: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
      });
    }

    if (action === "revoke") {
      requireRole(ctx, "editor");
      await revokeStatusToken(ctx, body.contactId || req.query?.id);
      log.info("status.link.revoked", { workspaceId: ctx.workspaceId });
      return res.status(200).json({ ok: true });
    }

    throw new WorkspaceError(400, "unknown_action", { action });
  } catch (err) {
    return sendError(res, err);
  }
}

async function paginaPorToken(req, res, token) {
  const registro = await resolveStatusToken(token);
  // Mesma resposta para inexistente e revogado: distinguir contaria a
  // quem tenta que aquele código já existiu.
  if (!registro) return paginaErro(res, 404);
  if (!isConfigured()) return paginaErro(res, 503);

  const lang = idiomaDoCliente(req.query?.lang);
  let dados;
  try {
    dados = await buildStatusData(registro.contact_external_id, lang);
  } catch (err) {
    if (err?.code === "contact_not_found") return paginaErro(res, 404);
    return paginaErro(res, 503);
  }

  recordStatusUse(registro.id, registro.use_count).catch(() => {});
  log.info("status.page.viewed", { workspaceId: registro.workspace_id });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(200).end(renderHtml(dados, lang, token));
}

/* ---------------- render ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const CORES = {
  documentos: "#b45309", pronto: "#b45309",
  concluido: "#047857", terceiro: "#6b7280",
  recebido: "#4f46e5", processando: "#4f46e5",
};

export function renderHtml(dados, lang, token) {
  const saudacao = dados.nome
    ? { pt: `Olá, ${dados.nome}`, en: `Hi, ${dados.nome}`, es: `Hola, ${dados.nome}` }[lang]
    : traduzir("titulo", lang);

  const cards = dados.servicos.length
    ? dados.servicos.map((s) => `
        <li class="svc" style="--c:${CORES[s.categoria] || "#4f46e5"}">
          <div class="svc__name">${esc(s.nome)}</div>
          <div class="svc__status">
            <span class="dot"></span>${esc(s.status)}
            ${s.acaoCliente ? `<span class="badge">${esc(traduzir("acaoCliente", lang))}</span>` : ""}
          </div>
        </li>`).join("")
    : `<li class="empty">${esc(traduzir("semServico", lang))}</li>`;

  const troca = ["pt", "en", "es"].map((l) => (
    l === lang
      ? `<b>${l.toUpperCase()}</b>`
      : `<a href="?t=${encodeURIComponent(token)}&lang=${l}">${l.toUpperCase()}</a>`
  )).join(" · ");

  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(traduzir("titulo", lang))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f3f4f6; color: #111827; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  header { text-align: center; padding: 24px 0 8px; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .sub { color: #6b7280; margin: 0; }
  .lang { text-align: center; margin: 10px 0 20px; color: #9ca3af; font-size: 14px; }
  .lang a { color: #4f46e5; text-decoration: none; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 20px 4px 8px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .svc { background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid var(--c);
    border-radius: 12px; padding: 14px 16px; }
  .svc__name { font-weight: 600; }
  .svc__status { display: flex; align-items: center; gap: 8px; color: #374151; margin-top: 4px; font-size: 15px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: none; }
  .badge { margin-left: auto; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: 600;
    padding: 2px 8px; border-radius: 999px; }
  .empty { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; color: #6b7280; text-align: center; }
  footer { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 28px; }
</style>
</head><body>
  <div class="wrap">
    <header>
      <h1>${esc(saudacao)}</h1>
      <p class="sub">${esc(traduzir("subtitulo", lang))}</p>
    </header>
    <div class="lang">${troca}</div>
    <h2>${esc(traduzir("servicos", lang))}</h2>
    <ul>${cards}</ul>
    <footer>${esc(traduzir("rodape", lang))}</footer>
  </div>
</body></html>`;
}

function paginaErro(res, code) {
  const msg = code === 503
    ? "Serviço indisponível no momento."
    : "Este link não é válido ou foi desativado.";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>—</title><body style="font:16px/1.5 -apple-system,sans-serif;background:#f3f4f6;color:#374151;`
    + `display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px">`
    + `<p>${msg}</p></body>`,
  );
}

function urlDoPortal(req, token) {
  const caminho = `/api/status?t=${encodeURIComponent(token)}`;
  if (process.env.WORKSPACE_PUBLIC_URL) {
    return process.env.WORKSPACE_PUBLIC_URL.replace(/\/$/, "") + caminho;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"]
    || (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}${caminho}`;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}
