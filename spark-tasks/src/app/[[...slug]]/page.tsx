"use client";

// Optional catch-all: GHL custom-page URLs often carry a path (e.g. the
// {{location.id}} placeholder), so the board renders on ANY path. The path is
// never used for auth — identity always comes from the SSO handshake.
import { SsoGate } from "../_components/sso-gate";
import { Board } from "~/components/board/Board";

export default function Page() {
  return (
    <SsoGate>
      <Board />
    </SsoGate>
  );
}
