"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createPage } from "~/server/actions";

export function NewPageCta() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn primary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const { id } = await createPage({});
          router.push(`/w/${id}`);
        })
      }
    >
      {pending ? "Creating…" : "New page"}
    </button>
  );
}
