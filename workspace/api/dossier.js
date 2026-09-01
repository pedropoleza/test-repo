/**
 * /api/dossier — o PDF da ficha do contato e o QR que leva a ele.
 *
 *   GET ?action=pdf&pageId=   → baixa o PDF (autenticado)
 *   GET ?action=share&pageId= → { url, qr } para mostrar na ficha
 *   GET ?t=<token>            → baixa o PDF SEM sessão (é o QR)
 *   POST action=revoke        → invalida o QR daquela ficha
 *
 * SOBRE O QR
 * Um QR code carrega texto, não arquivo: não há como um PDF caber nele
 * (a capacidade é de alguns KB, e nenhum leitor de celular renderiza PDF
 * a partir de bytes crus). O que o QR carrega é um endereço que RESPONDE
 * o PDF como anexo — ler o código baixa o arquivo, sem passar pelo app.
 *
 * O token no endereço é a credencial de quem lê. Ele dá acesso somente a
 * este PDF, é revogável, e quem tiver o código tem os dados daquele
 * contato — o que é a natureza do pedido.
 */
import QRCode from "qrcode";
import {
  resolveContext, requireRole, sendError, WorkspaceError,
} from "../lib/server/context.js";
import { getPage } from "../lib/server/pages.js";
import { loadContactDetail } from "../lib/server/contact-detail.js";
import { buildDossierPdf, nomeDoArquivo } from "../lib/server/dossier-pdf.js";
import {
  ensureShareToken, resolveShareToken, recordShareUse, revokeShareToken,
} from "../lib/server/share.js";
import { db } from "../lib/server/db.js";
import { isConfigured, GhlError } from "../lib/server/ghl.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    // Caminho do QR: sem sessão, o token é a credencial. Vem antes de
    // resolveContext justamente porque não há contexto a resolver.
    const token = req.query?.t;
    if (token) return await pdfPorToken(req, res, token);

    const ctx = await resolveContext(req);
    const body = parseBody(req);
    const action = req.query?.action || body.action || "share";
    const pageId = req.query?.pageId || body.pageId;

    if (action === "revoke") {
      requireRole(ctx, "editor");
      if (!pageId) throw new WorkspaceError(400, "missing_id");
      await revokeShareToken(ctx, pageId);
      log.info("dossier.share.revoked", { workspaceId: ctx.workspaceId, pageId });
      return res.status(200).json({ ok: true });
    }

    // Sem id não há o que buscar: sem esta guarda o valor "undefined"
    // chegava ao Postgres e voltava como 500 com a mensagem do banco.
    if (!pageId) throw new WorkspaceError(400, "missing_id");

    const page = await getPage(ctx, pageId);
    if (page.source !== "ghl_contact" || !page.source_external_id) {
      throw new WorkspaceError(400, "not_a_contact_page");
    }

    if (action === "share") {
      const share = await ensureShareToken(ctx, pageId);
      const url = urlDoPdf(req, share.token);
      return res.status(200).json({
        url,
        // SVG e não PNG: escala sem borrar na impressão, e é texto — cabe
        // na mesma resposta sem um segundo pedido.
        qr: await QRCode.toString(url, {
          type: "svg", margin: 1, errorCorrectionLevel: "M",
        }),
        revoked: false,
      });
    }

    if (action === "pdf") {
      if (!isConfigured()) throw new WorkspaceError(503, "ghl_not_configured");
      const pdf = await montarPdf(page);
      return enviarPdf(res, pdf, nomeDoArquivo(page.title));
    }

    throw new WorkspaceError(400, "unknown_action", { action });
  } catch (err) {
    if (err instanceof GhlError) {
      log.warn("dossier.crm_failed", { code: err.code, status: err.status });
      return res.status(err.status === 401 ? 502 : err.status).json({ error: err.code });
    }
    return sendError(res, err);
  }
}

/** O caminho de quem chegou pelo QR: token válido, PDF, e nada mais. */
async function pdfPorToken(req, res, token) {
  const share = await resolveShareToken(token);
  if (!share) {
    // Mesma resposta para token inexistente e revogado: distinguir diria
    // a quem está tentando que aquele código já existiu.
    return res.status(404).json({ error: "link_invalido" });
  }

  const { data: page } = await db()
    .from("workspace_pages")
    .select("id,title,source,source_external_id,is_archived")
    .eq("id", share.page_id)
    .maybeSingle();

  if (!page || page.is_archived || page.source !== "ghl_contact") {
    return res.status(404).json({ error: "link_invalido" });
  }
  if (!isConfigured()) return res.status(503).json({ error: "ghl_not_configured" });

  const pdf = await montarPdf(page);
  recordShareUse(share.id, share.use_count).catch(() => {});
  log.info("dossier.share.used", { pageId: page.id });
  return enviarPdf(res, pdf, nomeDoArquivo(page.title));
}

async function montarPdf(page) {
  const detalhe = await loadContactDetail(page.source_external_id);
  return buildDossierPdf({
    page,
    record: detalhe.record,
    columns: detalhe.columns,
    opportunities: detalhe.opportunities,
    opportunityColumns: detalhe.opportunityColumns,
    notes: detalhe.notes,
    tasks: detalhe.tasks,
  });
}

function enviarPdf(res, pdf, nome) {
  res.setHeader("Content-Type", "application/pdf");
  // `attachment` é o que faz o celular baixar em vez de abrir o app.
  res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
  res.setHeader("Content-Length", String(pdf.length));
  // A ficha muda quando o CRM muda: um PDF em cache mostraria dados
  // velhos justamente para quem leu o QR agora.
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  return res.end(pdf);
}

/**
 * O endereço público do PDF.
 *
 * Montado a partir do host da requisição: fixar o domínio quebraria em
 * preview e em qualquer outro deploy, e um QR impresso apontando para o
 * domínio errado não tem conserto.
 */
function urlDoPdf(req, token) {
  const caminho = `/api/dossier?t=${encodeURIComponent(token)}`;
  if (process.env.WORKSPACE_PUBLIC_URL) {
    return process.env.WORKSPACE_PUBLIC_URL.replace(/\/$/, "") + caminho;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  // O protocolo vem do proxy quando há um (a Vercel manda
  // x-forwarded-proto). Fixar https quebrava fora dela: o endereço do QR
  // virava um link morto em desenvolvimento.
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
