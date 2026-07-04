"use client";

import { SsoGate } from "./_components/sso-gate";
import { Board } from "~/components/board/Board";

export default function Page() {
  return (
    <SsoGate>
      <Board />
    </SsoGate>
  );
}
