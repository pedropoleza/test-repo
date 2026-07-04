// Placeholder shell. The real board (Stage 2) mounts here once SSO + isolation
// (Stage 1) are in place. Kept deliberately minimal until the auth foundation
// is built, so we never render task UI without a validated location scope.
export default function Page() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Spark Tasks</h1>
      <p style={{ color: "#6b7280", marginTop: 8 }}>
        Scaffold ready. Board UI arrives in Stage 2, after SSO and tenant
        isolation (Stage 1) are wired.
      </p>
    </main>
  );
}
