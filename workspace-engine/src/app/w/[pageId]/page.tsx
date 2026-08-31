import { notFound } from "next/navigation";
import { getPage, getBlocks, getBreadcrumb } from "~/server/queries";
import { PageView } from "~/components/PageView";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const page = await getPage(pageId);
  if (!page) notFound();
  const [blocks, crumbs] = await Promise.all([
    getBlocks(pageId),
    getBreadcrumb(pageId),
  ]);
  return <PageView page={page} initialBlocks={blocks} crumbs={crumbs} />;
}
