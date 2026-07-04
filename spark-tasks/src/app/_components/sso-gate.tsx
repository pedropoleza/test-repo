"use client";

/**
 * SSO bootstrap for the GHL iframe (plan §4.1).
 *
 * Asks the GHL parent frame for the encrypted user context
 * (`REQUEST_USER_DATA`), receives `REQUEST_USER_DATA_RESPONSE`, and POSTs the
 * encrypted blob to /api/sso/handshake, which decrypts it server-side and
 * opens the session cookie. Only then does the app render.
 *
 * The request is re-sent a few times: the GHL parent attaches its listener
 * asynchronously, so a single postMessage on mount can race it and be lost.
 *
 * The client never sees or sets location_id — it only forwards the opaque
 * encrypted payload GHL gave it.
 */
import { useEffect, useState, type ReactNode } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ready" }
  // GHL never answered: SSO off in the app config, or opened outside the
  // marketplace app (e.g. a Custom Menu Link, which has no SSO).
  | { kind: "no-response" }
  // GHL answered but the server rejected it (key mismatch / no location).
  | { kind: "rejected"; status: number };

const REQUEST_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 6;

export function SsoGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let settled = false;

    async function establish(encryptedData: string) {
      try {
        const res = await fetch("/api/sso/handshake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedData }),
        });
        setState(
          res.ok ? { kind: "ready" } : { kind: "rejected", status: res.status },
        );
      } catch {
        setState({ kind: "rejected", status: 0 });
      }
    }

    function onMessage(e: MessageEvent) {
      const data = e.data as { message?: string; payload?: string } | undefined;
      if (data?.message === "REQUEST_USER_DATA_RESPONSE" && data.payload) {
        settled = true;
        clearInterval(ticker);
        void establish(data.payload);
      }
    }

    window.addEventListener("message", onMessage);

    // Re-send: the parent's listener may not be ready on our first mount.
    let attempts = 0;
    const ask = () => {
      attempts += 1;
      try {
        window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
      } catch {
        /* not framed — the timeout will surface it */
      }
      if (attempts >= MAX_ATTEMPTS && !settled) {
        clearInterval(ticker);
        setState({ kind: "no-response" });
      }
    };
    ask();
    const ticker = setInterval(ask, REQUEST_INTERVAL_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(ticker);
    };
  }, []);

  if (state.kind === "loading") {
    return <Centered>Carregando…</Centered>;
  }
  if (state.kind === "no-response") {
    return (
      <Centered>
        <div style={{ maxWidth: 460 }}>
          <p style={{ fontWeight: 600, color: "#101828", marginBottom: 8 }}>
            O GoHighLevel não respondeu ao pedido de autenticação (SSO).
          </p>
          <p style={{ margin: 0 }}>
            Isso normalmente significa uma destas duas coisas: o app foi aberto
            por um <b>Custom Menu Link</b> (que não tem SSO) em vez da página do
            app de marketplace instalado, ou o <b>SSO não está habilitado</b>{" "}
            nas configurações do app no Developer Portal. Abra o app pelo menu
            do próprio app instalado na location e confirme que a Shared Secret
            Key está salva na seção SSO do app.
          </p>
        </div>
      </Centered>
    );
  }
  if (state.kind === "rejected") {
    return (
      <Centered>
        <div style={{ maxWidth: 460 }}>
          <p style={{ fontWeight: 600, color: "#101828", marginBottom: 8 }}>
            Autenticação recusada pelo servidor (HTTP {state.status || "—"}).
          </p>
          <p style={{ margin: 0 }}>
            O GHL respondeu, mas o payload não pôde ser validado — em geral é a
            Shared Secret Key do app diferente da configurada no servidor, ou o
            app aberto no nível de agency (abra dentro de uma location).
          </p>
        </div>
      </Centered>
    );
  }
  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "60vh",
        alignItems: "center",
        justifyContent: "center",
        color: "#667085",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
