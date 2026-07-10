"use client";

/**
 * Top-level opt-in page for desktop alerts (Web Push).
 *
 * Browsers block Notification.requestPermission() inside cross-origin iframes,
 * so the bell opens THIS page in a small popup on our own origin. The SSO
 * session cookie (same origin) scopes the subscription to the location+user.
 * Flow: register the service worker → ask permission → subscribe → save.
 */
import { useEffect, useState } from "react";
import { api } from "~/trpc/react";

type Step =
  | "checking"
  | "unsupported"
  | "denied"
  | "no-session"
  | "disabled"
  | "working"
  | "done"
  | "error";

function b64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function EnableAlertsPage() {
  const [step, setStep] = useState<Step>("checking");
  const utils = api.useUtils();
  const subscribe = api.push.subscribe.useMutation();

  async function run() {
    setStep("working");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStep("unsupported");
        return;
      }
      let key: string | null = null;
      try {
        key = await utils.push.publicKey.fetch();
      } catch {
        setStep("no-session");
        return;
      }
      if (!key) {
        setStep("disabled");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStep("denied");
        return;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToUint8(key) as BufferSource,
        }));
      const json = sub.toJSON();
      await subscribe.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent.slice(0, 400),
      });
      setStep("done");
      setTimeout(() => window.close(), 2500);
    } catch (err) {
      console.error(err);
      setStep("error");
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const M: Record<Step, { icon: string; title: string; sub: string }> = {
    checking: { icon: "⏳", title: "Checking…", sub: "" },
    working: {
      icon: "🔔",
      title: "Enabling desktop alerts…",
      sub: "Accept the browser permission prompt.",
    },
    done: {
      icon: "✅",
      title: "Desktop alerts enabled!",
      sub: "You'll get a notification when a task is assigned to you — even with the module closed. This window closes itself.",
    },
    denied: {
      icon: "🚫",
      title: "Permission denied",
      sub: "Allow notifications for this site in your browser settings, then try again.",
    },
    unsupported: {
      icon: "😕",
      title: "Browser not supported",
      sub: "Desktop Chrome, Edge or Firefox are required for push alerts.",
    },
    "no-session": {
      icon: "🔑",
      title: "Session not found",
      sub: "Open Spark Tasks inside GoHighLevel first, then click Enable alerts again.",
    },
    disabled: {
      icon: "⚙️",
      title: "Push not configured",
      sub: "The server is missing its push keys. Contact the administrator.",
    },
    error: {
      icon: "⚠️",
      title: "Something went wrong",
      sub: "Close this window and try again.",
    },
  };
  const m = M[step];

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, system-ui, sans-serif",
        background: "#f2f4f7",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #e4e7ec",
          borderRadius: 16,
          boxShadow: "0 12px 16px -4px rgba(16,24,40,.14)",
          padding: "32px 28px",
          maxWidth: 380,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>{m.icon}</div>
        <h1 style={{ fontSize: 17, fontWeight: 700, margin: "12px 0 6px", color: "#101828" }}>
          {m.title}
        </h1>
        <p style={{ fontSize: 13.5, color: "#475467", margin: 0, lineHeight: 1.5 }}>{m.sub}</p>
        {(step === "denied" || step === "error") && (
          <button
            onClick={() => void run()}
            style={{
              marginTop: 16,
              background: "#155eef",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
