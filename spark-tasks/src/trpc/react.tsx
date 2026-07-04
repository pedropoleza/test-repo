"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { useState, type ReactNode } from "react";
import { type inferRouterOutputs, type inferRouterInputs } from "@trpc/server";
import { type AppRouter } from "~/server/api/root";

export const api = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          // Cookies (the session) ride along on same-origin requests from the
          // iframe automatically; nothing location-related is sent explicitly.
        }),
      ],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
