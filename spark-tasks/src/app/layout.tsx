import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { TRPCReactProvider } from "~/trpc/react";
import "~/styles/globals.css";

export const metadata: Metadata = {
  title: "Spark Tasks",
  description: "Task board for SparkLeads locations, embedded in GoHighLevel.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
