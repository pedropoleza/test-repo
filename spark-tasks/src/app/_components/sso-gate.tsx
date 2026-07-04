"use client";

/**
 * SSO bootstrap for the GHL iframe (plan §4.1).
 *
 * On mount we ask the GHL parent frame for the encrypted user context
 * (`REQUEST_USER_DATA`), receive `REQUEST_USER_DATA_RESPONSE`, and POST the
 * encrypted blob to /api/sso/handshake, which decrypts it server-side and opens
 * the session cookie. Only once the session exists do we render the app.
 *
 * The client never sees or sets location_id — it only forwards the opaque
 * encrypted payload GHL gave it.
 */
import { useEffect, useState, type ReactNode } from "react";

type State = "loading" | "ready" | "error";

export function SsoGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let done = false;

    async function establish(encryptedData: string) {
      try {
        const res = await fetch("/api/sso/handshake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedData }),
        });
        setState(res.ok ? "ready" : "error");
      } catch {
        setState("error");
      }
    }

    function onMessage(e: MessageEvent) {
      const data = e.data as { message?: string; payload?: string } | undefined;
      if (data?.message === "REQUEST_USER_DATA_RESPONSE" && data.payload) {
        done = true;
        void establish(data.payload);
      }
    }

    window.addEventListener("message", onMessage);
    // Ask the GHL parent for the encrypted user context.
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");

    // If GHL never answers (e.g. opened outside an iframe), surface an error.
    const timeout = setTimeout(() => {
      if (!done) setState("error");
    }, 8000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
    };
  }, []);

  if (state === "loading") {
    return <Centered>Carregando…</Centered>;
  }
  if (state === "error") {
    return (
      <Centered>
        Não foi possível autenticar. Abra o app dentro de uma location do
        GoHighLevel.
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
        color: "#6b7280",
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
