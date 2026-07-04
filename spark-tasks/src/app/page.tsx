"use client";

import { SsoGate } from "./_components/sso-gate";
import { api } from "~/trpc/react";

export default function Page() {
  return (
    <SsoGate>
      <WhoAmI />
    </SsoGate>
  );
}

/**
 * Stage 1 proof: once the session exists, calling a location-scoped procedure
 * returns the location resolved server-side from SSO. The board UI (Stage 2)
 * replaces this.
 */
function WhoAmI() {
  const whoami = api.system.whoami.useQuery();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Spark Tasks</h1>
      {whoami.isLoading && <p style={{ color: "#6b7280" }}>Autenticando…</p>}
      {whoami.error && (
        <p style={{ color: "#dc2626" }}>Erro: {whoami.error.message}</p>
      )}
      {whoami.data && (
        <p style={{ color: "#6b7280", marginTop: 8 }}>
          Sessão ativa — location <code>{whoami.data.locationId}</code>. Board UI
          chega na Stage 2.
        </p>
      )}
    </main>
  );
}
