import type { Metadata } from "next";
import "./globals.css";
import { getPageTree, getFavorites } from "~/server/queries";
import { Sidebar } from "~/components/Sidebar";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your CRM is also your workspace",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tree, favorites] = await Promise.all([getPageTree(), getFavorites()]);
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar tree={tree} favorites={favorites} />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
