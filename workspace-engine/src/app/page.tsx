import { redirect } from "next/navigation";
import { getPageTree } from "~/server/queries";
import { NewPageCta } from "~/components/NewPageCta";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tree = await getPageTree();
  if (tree.length > 0) redirect(`/w/${tree[0]!.id}`);
  return (
    <div className="empty-state">
      <h2>Create your first page</h2>
      <p>
        Organize notes, processes, documents and data in one place — pages,
        databases and content linked to your CRM.
      </p>
      <div style={{ marginTop: 18 }}>
        <NewPageCta />
      </div>
    </div>
  );
}
