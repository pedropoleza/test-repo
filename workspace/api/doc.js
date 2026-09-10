/**
 * Documento para o cliente assinar.
 *
 *   GET  ?t=<token>          → a página do documento (SEM sessão)
 *   GET  ?t=<token>&pdf=1    → o PDF (pré-preenchido, ou o assinado)
 *   POST ?t=<token>          → assina e aprova
 *
 *   GET  ?action=list&id=    → pedidos de um contato (autenticado)
 *   GET  ?action=all         → todos os pedidos, para o painel
 *   POST ?action=send        → cria o pedido e devolve link + QR
 *   POST ?action=cancel      → invalida o link
 *
 * O token no endereço é a credencial de quem assina: vale para UM
 * documento, de UM contato, e deixa de valer depois de assinado. A página
 * sai no idioma do contato; o PDF, na variante oficial daquela língua
 * quando ela existe.
 */
import QRCode from "qrcode";
import {
  resolveContext, requireRole, sendError, WorkspaceError,
} from "../lib/server/context.js";
import { getLocation } from "../lib/server/ghl.js";
import {
  criarPedido, resolverPedido, registrarAbertura, assinarPedido,
  listarPedidos, listarTodos, cancelarPedido,
} from "../lib/server/doc-request.js";
import { avisarAssinatura } from "../lib/server/doc-notify.js";
import { db } from "../lib/server/db.js";
import { MAPAS } from "../lib/server/acordo-maps.js";
import { preencherAcordo } from "../lib/server/document-fill.js";
import { ACORDOS } from "../src/shared/catalog.js";
import { secoesDoAcordo, texto } from "../src/shared/doc-forms.js";
import { documentoEmOutraLingua } from "../src/shared/idioma.js";
import { log } from "../lib/server/log.js";

export default async function handler(req, res) {
  try {
    const token = req.query?.t;
    if (token) {
      if (req.method === "POST") return await assinar(req, res, token);
      if (req.query?.pdf) return await servirPdf(req, res, token);
      return await pagina(req, res, token);
    }

    const ctx = await resolveContext(req);
    const body = parseBody(req);
    const action = req.query?.action || body.action || "list";

    if (action === "list") {
      const pedidos = await listarPedidos(ctx, req.query?.id || body.contactId);
      return res.status(200).json({ pedidos: pedidos.map(publico) });
    }
    if (action === "all") {
      const pedidos = await listarTodos(ctx);
      return res.status(200).json({ pedidos: pedidos.map(publico) });
    }
    if (action === "send") {
      requireRole(ctx, "editor");
      const pedido = await criarPedido(ctx, {
        contactId: body.contactId, acordo: body.acordo, idioma: body.idioma,
      });
      const url = urlDoDocumento(req, pedido.token);
      log.info("doc.request.created", { workspaceId: ctx.workspaceId, acordo: pedido.acordo });
      return res.status(201).json({
        pedido: publico(pedido),
        url,
        qr: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
      });
    }
    if (action === "cancel") {
      requireRole(ctx, "editor");
      await cancelarPedido(ctx, body.id || req.query?.id);
      return res.status(200).json({ ok: true });
    }
    throw new WorkspaceError(400, "unknown_action", { action });
  } catch (err) {
    return sendError(res, err);
  }
}

/** O que a interface interna pode ver de um pedido (sem o token). */
function publico(p) {
  return {
    id: p.id, acordo: p.acordo, slug: p.slug, idioma: p.idioma, status: p.status,
    contactId: p.contact_external_id,
    assinadoPor: p.assinado_por || null,
    assinadoEm: p.assinado_em || null,
    criadoEm: p.created_at, abertoEm: p.opened_at || null,
    fileId: p.file_id || null,
    nome: ACORDOS[p.acordo]?.nome || p.acordo,
  };
}

/* ---------------- caminho público ---------------- */

async function pagina(req, res, token) {
  const pedido = await resolverPedido(token);
  if (!pedido || pedido.status === "cancelado") return paginaSimples(res, 404, texto("expirado", "pt"));
  // Sem checar o CRM de propósito: a página se monta do pedido guardado e
  // o PDF sai dos arquivos locais. Um CRM instável não pode derrubar um
  // link que já está na mão do cliente.

  const lang = pedido.idioma || "pt";
  if (pedido.status === "assinado") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).end(htmlAssinado(pedido, lang, token));
  }

  await registrarAbertura(pedido);
  const empresa = await nomeDaEmpresa();

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(200).end(htmlFormulario(pedido, lang, token, empresa));
}

async function assinar(req, res, token) {
  const body = parseBody(req);
  try {
    const { pedido, arquivo } = await assinarPedido(token, {
      valores: body.valores || {},
      assinadoPor: body.assinadoPor,
      tipo: body.tipo,
      imagem: body.imagem,
      ip: ipDoPedido(req),
    });
    // Avisar não pode derrubar a assinatura: já está gravada e válida.
    const avisos = await avisarAssinatura({
      contactId: pedido.contact_external_id,
      documento: ACORDOS[pedido.acordo]?.nome || pedido.acordo,
      assinante: pedido.assinado_por,
      assinadoEm: pedido.assinado_em,
      urlArquivo: arquivo?.public_url || "",
    }).catch(() => ({ nota: false, tarefa: false, whatsapp: false }));

    log.info("doc.request.signed", { acordo: pedido.acordo, ...avisos });
    return res.status(200).json({ ok: true, pedido: publico(pedido) });
  } catch (err) {
    return sendError(res, err);
  }
}

async function servirPdf(req, res, token) {
  const pedido = await resolverPedido(token);
  if (!pedido || pedido.status === "cancelado") return paginaSimples(res, 404, texto("expirado", "pt"));

  // Assinado: o arquivo guardado é a verdade.
  if (pedido.status === "assinado" && pedido.file_id) {
    const { data } = await db().from("workspace_files")
      .select("public_url").eq("id", pedido.file_id).maybeSingle();
    if (data?.public_url) {
      res.setHeader("Location", data.public_url);
      return res.status(302).end();
    }
  }

  const mapa = MAPAS[pedido.slug];
  const valores = { ...(pedido.prefill || {}), ...(pedido.valores || {}) };
  const bytes = await preencherAcordo({ slug: pedido.slug, valores, mapa: mapa.mapa });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=\"documento.pdf\"");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).end(Buffer.from(bytes));
}

async function nomeDaEmpresa() {
  try {
    const loc = await getLocation();
    return loc?.name || "";
  } catch {
    return "";
  }
}

function ipDoPedido(req) {
  const bruto = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";
  return String(bruto).split(",")[0].trim();
}

/* ---------------- render ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const ESTILO = `
  :root { color-scheme: light; --tinta:#0f172a; --suave:#64748b; --linha:#e2e8f0;
    --azul:#2563eb; --azul-esc:#1d4ed8; --fundo:#f1f5f9; --ok:#047857; }
  *{box-sizing:border-box} 
  body{margin:0;background:var(--fundo);color:var(--tinta);
    font:16px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:0 16px 56px}
  header{padding:28px 0 12px}
  .marca{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--suave)}
  h1{margin:6px 0 4px;font-size:25px;line-height:1.2}
  .sub{margin:0;color:var(--suave)}
  .card{background:#fff;border:1px solid var(--linha);border-radius:14px;padding:20px;margin-top:16px;
    box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .aviso{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;border-radius:12px;
    padding:12px 14px;margin-top:16px;font-size:14px}
  .verdoc{display:inline-flex;align-items:center;gap:8px;margin-top:14px;color:var(--azul);
    font-weight:600;text-decoration:none;font-size:15px}
  .verdoc:hover{text-decoration:underline}
  h2{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:var(--suave);margin:0 0 14px}
  label{display:block;margin-bottom:14px}
  .rot{display:block;font-size:13px;font-weight:600;margin-bottom:5px}
  .req{color:#dc2626}
  input[type=text],input[type=tel],input[type=email]{width:100%;padding:11px 13px;font:inherit;
    border:1px solid #cbd5e1;border-radius:10px;background:#fff;transition:border-color .15s,box-shadow .15s}
  input:focus{outline:0;border-color:var(--azul);box-shadow:0 0 0 3px rgba(37,99,235,.13)}
  input.erro{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.1)}
  .dica{font-size:12px;color:var(--suave);margin-top:4px}
  .abas{display:flex;gap:6px;margin-bottom:12px}
  .aba{flex:1;padding:9px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;cursor:pointer;
    font:inherit;font-size:14px;font-weight:600;color:var(--suave)}
  .aba[aria-selected=true]{background:var(--azul);border-color:var(--azul);color:#fff}
  #quadro{width:100%;height:170px;border:2px dashed #cbd5e1;border-radius:12px;background:#fff;
    touch-action:none;display:block}
  .limpar{margin-top:8px;background:none;border:0;color:var(--suave);font:inherit;font-size:14px;
    cursor:pointer;text-decoration:underline;padding:0}
  .aceite{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:15px;cursor:pointer}
  .aceite input{margin-top:3px;width:18px;height:18px;flex:none;accent-color:var(--azul)}
  .enviar{width:100%;margin-top:20px;padding:15px;border:0;border-radius:12px;background:var(--azul);
    color:#fff;font:inherit;font-size:17px;font-weight:700;cursor:pointer;transition:background .15s}
  .enviar:hover{background:var(--azul-esc)}
  .enviar:disabled{opacity:.55;cursor:default}
  .erroMsg{margin-top:12px;color:#dc2626;font-size:14px;font-weight:600;min-height:20px}
  .ok{text-align:center;padding:40px 20px}
  .okIcone{width:64px;height:64px;border-radius:50%;background:#d1fae5;color:var(--ok);
    display:grid;place-items:center;font-size:32px;margin:0 auto 18px}
  footer{text-align:center;color:var(--suave);font-size:13px;margin-top:26px}
  @media(max-width:480px){h1{font-size:22px}.card{padding:16px}}
`;

function htmlFormulario(pedido, lang, token, empresa) {
  const def = ACORDOS[pedido.acordo] || {};
  const secoes = secoesDoAcordo(pedido.slug, lang);
  const valores = { ...(pedido.prefill || {}), ...(pedido.valores || {}) };

  const campos = secoes.map((s) => `
    <div class="card">
      <h2>${esc(s.titulo)}</h2>
      ${s.campos.map((c) => `
        <label>
          <span class="rot">${esc(c.rotulo)}${c.obrigatorio ? ' <span class="req">*</span>' : ""}</span>
          <input type="${esc(c.tipo)}" name="${esc(c.campo)}" value="${esc(valores[c.campo] || "")}"
            ${c.obrigatorio ? "data-req=1" : ""} autocomplete="off">
          ${c.dica ? `<span class="dica">${esc(c.dica)}</span>` : ""}
        </label>`).join("")}
    </div>`).join("");

  const avisoLingua = documentoEmOutraLingua(def, lang) && texto("avisoIdioma", lang)
    ? `<div class="aviso">${esc(texto("avisoIdioma", lang))}</div>` : "";

  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(def.nome || "Documento")}</title>
<style>${ESTILO}</style></head><body>
<div class="wrap" id="app">
  <header>
    ${empresa ? `<div class="marca">${esc(empresa)}</div>` : ""}
    <h1>${esc(def.nome || "Documento")}</h1>
    <p class="sub">${esc(texto("intro", lang))}</p>
    ${avisoLingua}
    <a class="verdoc" href="?t=${encodeURIComponent(token)}&pdf=1" target="_blank" rel="noopener">
      ${esc(texto("verDocumento", lang))} &rarr;</a>
  </header>

  <form id="f">
    ${campos}

    <div class="card">
      <h2>${esc(texto("assinatura", lang))}</h2>
      <div class="abas" role="tablist">
        <button type="button" class="aba" id="tDesenhar" role="tab" aria-selected="true">${esc(texto("desenhar", lang))}</button>
        <button type="button" class="aba" id="tDigitar" role="tab" aria-selected="false">${esc(texto("digitar", lang))}</button>
      </div>
      <div id="painelDesenho">
        <canvas id="quadro"></canvas>
        <button type="button" class="limpar" id="limpar">${esc(texto("limpar", lang))}</button>
      </div>
      <div id="painelTexto" hidden>
        <input type="text" id="nomeDigitado" placeholder="${esc(texto("nomeAssina", lang))}">
      </div>
      <label class="aceite">
        <input type="checkbox" id="aceite">
        <span>${esc(texto("consentimento", lang))}</span>
      </label>
      <div class="erroMsg" id="erro"></div>
      <button type="submit" class="enviar" id="enviar">${esc(texto("enviar", lang))}</button>
    </div>
  </form>
  <footer>${esc(empresa || "")}</footer>
</div>
<script>
(function(){
  var T = ${JSON.stringify({
    obrigatorio: texto("obrigatorio", lang),
    precisaAssinar: texto("precisaAssinar", lang),
    enviando: texto("enviando", lang),
    enviar: texto("enviar", lang),
    sucessoTitulo: texto("sucessoTitulo", lang),
    sucessoTexto: texto("sucessoTexto", lang),
    baixar: texto("baixar", lang),
  })};
  var token = ${JSON.stringify(token)};
  var modo = "desenhada";
  var q = document.getElementById("quadro");
  var ctx = q.getContext("2d");
  var desenhou = false;

  function dimensionar(){
    var r = q.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    q.width = r.width * d; q.height = r.height * d;
    ctx.scale(d, d); ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
  }
  dimensionar();
  window.addEventListener("resize", function(){ var img = q.toDataURL(); dimensionar();
    if (desenhou) { var i = new Image(); i.onload = function(){ ctx.drawImage(i,0,0,q.width/(window.devicePixelRatio||1), q.height/(window.devicePixelRatio||1)); }; i.src = img; } });

  var pintando = false;
  function pos(e){ var r = q.getBoundingClientRect();
    var p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function iniciar(e){ e.preventDefault(); pintando = true; desenhou = true;
    var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function mover(e){ if(!pintando) return; e.preventDefault();
    var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function parar(){ pintando = false; }
  q.addEventListener("mousedown", iniciar); q.addEventListener("mousemove", mover);
  window.addEventListener("mouseup", parar);
  q.addEventListener("touchstart", iniciar, {passive:false});
  q.addEventListener("touchmove", mover, {passive:false});
  q.addEventListener("touchend", parar);
  document.getElementById("limpar").onclick = function(){
    ctx.clearRect(0,0,q.width,q.height); desenhou = false; };

  var tD = document.getElementById("tDesenhar"), tT = document.getElementById("tDigitar");
  function aba(qual){
    modo = qual;
    tD.setAttribute("aria-selected", qual === "desenhada");
    tT.setAttribute("aria-selected", qual === "digitada");
    document.getElementById("painelDesenho").hidden = qual !== "desenhada";
    document.getElementById("painelTexto").hidden = qual !== "digitada";
  }
  tD.onclick = function(){ aba("desenhada"); }; tT.onclick = function(){ aba("digitada"); };

  document.getElementById("f").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var erro = document.getElementById("erro"); erro.textContent = "";
    var valores = {}, faltou = null;
    document.querySelectorAll("#f input[name]").forEach(function(i){
      valores[i.name] = i.value.trim();
      i.classList.remove("erro");
      if (i.dataset.req && !i.value.trim()) { i.classList.add("erro"); if(!faltou) faltou = i; }
    });
    if (faltou) { erro.textContent = T.obrigatorio; faltou.focus(); return; }

    var nome = document.getElementById("nomeDigitado").value.trim();
    var aceitou = document.getElementById("aceite").checked;
    var assinou = modo === "desenhada" ? desenhou : nome.length > 1;
    if (!assinou || !aceitou) { erro.textContent = T.precisaAssinar; return; }

    // Na assinatura desenhada o nome vem do campo de nome do formulário.
    var assinante = modo === "digitada" ? nome : (valores.nome || valores.llcNome || "");
    if (!assinante) { erro.textContent = T.precisaAssinar; return; }

    var b = document.getElementById("enviar");
    b.disabled = true; b.textContent = T.enviando;
    try {
      var r = await fetch("?t=" + encodeURIComponent(token), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valores: valores, assinadoPor: assinante, tipo: modo,
          imagem: modo === "desenhada" ? q.toDataURL("image/png") : "" }),
      });
      if (!r.ok) throw new Error("falhou");
      document.getElementById("app").innerHTML =
        '<div class="card ok"><div class="okIcone">&#10003;</div>' +
        '<h1>' + T.sucessoTitulo + '</h1><p class="sub">' + T.sucessoTexto + '</p>' +
        '<a class="verdoc" href="?t=' + encodeURIComponent(token) + '&pdf=1" target="_blank" rel="noopener">' +
        T.baixar + ' &rarr;</a></div>';
      window.scrollTo(0,0);
    } catch (e) {
      b.disabled = false; b.textContent = T.enviar;
      erro.textContent = T.precisaAssinar;
    }
  });
})();
</script>
</body></html>`;
}

function htmlAssinado(pedido, lang, token) {
  const def = ACORDOS[pedido.acordo] || {};
  const quando = pedido.assinado_em
    ? new Date(pedido.assinado_em).toISOString().replace("T", " ").slice(0, 16) : "";
  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(def.nome || "Documento")}</title>
<style>${ESTILO}</style></head><body><div class="wrap">
<div class="card ok">
  <div class="okIcone">&#10003;</div>
  <h1>${esc(texto("sucessoTitulo", lang))}</h1>
  <p class="sub">${esc(texto("sucessoTexto", lang))}</p>
  <p class="sub" style="margin-top:10px;font-size:14px">
    ${esc(def.nome || "")}${quando ? ` &middot; ${esc(texto("assinadoEm", lang))} ${esc(quando)} UTC` : ""}</p>
  <a class="verdoc" href="?t=${encodeURIComponent(token)}&pdf=1" target="_blank" rel="noopener">
    ${esc(texto("baixar", lang))} &rarr;</a>
</div></div></body></html>`;
}

function paginaSimples(res, code, msg) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>—</title><body style="font:16px/1.5 -apple-system,sans-serif;background:#f1f5f9;color:#334155;`
    + `display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px">`
    + `<p>${esc(msg)}</p></body>`,
  );
}

function urlDoDocumento(req, token) {
  const caminho = `/api/doc?t=${encodeURIComponent(token)}`;
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
