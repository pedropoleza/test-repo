/**
 * OAuth callback do GHL.
 *
 * Recebe `?code=...&locationId=...` quando o usuário autoriza o app.
 * Por enquanto é apenas um stub que retorna uma página de sucesso —
 * a próxima fase troca o code pelo access_token via /oauth/token,
 * persiste em DB e redireciona pro hub.
 */
export default function handler(req, res) {
  const { code, locationId } = req.query || {};

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>App conectado</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
           background: #f8fafc; color: #0f172a; padding: 40px 24px; text-align: center; }
    .card { max-width: 460px; margin: 60px auto; background: #fff;
            border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;
            box-shadow: 0 4px 12px -4px rgba(15,23,42,0.06); }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p  { color: #64748b; margin: 0 0 16px; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .ok { color: #16a34a; font-size: 32px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="ok">✓</div>
    <h1>App conectado</h1>
    <p>Autorização recebida. A integração será concluída na próxima fase
    (troca do code pelo token + persistência).</p>
    ${code ? `<p><small>code: <code>${String(code).slice(0,16)}…</code></small></p>` : ""}
    ${locationId ? `<p><small>location: <code>${locationId}</code></small></p>` : ""}
    <p>Pode fechar esta janela.</p>
  </div>
</body>
</html>`);
}
