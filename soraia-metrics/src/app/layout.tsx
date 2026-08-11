import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soraia Close — Métricas",
  description: "Painel de métricas de prospecção e reuniões",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
