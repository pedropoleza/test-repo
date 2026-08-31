"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { PageNode } from "~/server/queries";
import type { Icon } from "~/server/schema";
import {
  createPage,
  renamePage,
  archivePage,
  toggleFavorite,
  movePage,
} from "~/server/actions";

function iconGlyph(icon: Icon): string {
  if (icon?.type === "emoji") return icon.value;
  return "📄";
}

export function Sidebar({
  tree,
  favorites,
}: {
  tree: PageNode[];
  favorites: Array<{ id: string; title: string; icon: Icon }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const activeId = pathname.startsWith("/w/") ? pathname.slice(3) : null;

  // Expand ancestors of the active page by default.
  const ancestorsOpen = useMemo(() => {
    const parent = new Map<string, string | null>();
    const walk = (nodes: PageNode[]) => {
      for (const n of nodes) {
        parent.set(n.id, n.parentId);
        walk(n.children);
      }
    };
    walk(tree);
    const set = new Set<string>();
    let cur = activeId ? parent.get(activeId) ?? null : null;
    while (cur) {
      set.add(cur);
      cur = parent.get(cur) ?? null;
    }
    return set;
  }, [tree, activeId]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const isOpen = (id: string) => open.has(id) || ancestorsOpen.has(id);
  const toggle = (id: string) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(id) || ancestorsOpen.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function act(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  async function addChild(parentId: string) {
    const { id } = await createPage({ parentId });
    setOpen((p) => new Set(p).add(parentId));
    router.push(`/w/${id}`);
    router.refresh();
  }

  function Row({ node, depth }: { node: PageNode; depth: number }) {
    const hasChildren = node.children.length > 0;
    const opened = isOpen(node.id);
    return (
      <div>
        <div
          className={`tree-row${activeId === node.id ? " active" : ""}${
            dropId === node.id ? " drop-into" : ""
          }`}
          draggable
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (dragId && dragId !== node.id) {
              e.preventDefault();
              setDropId(node.id);
            }
          }}
          onDragLeave={() => setDropId((d) => (d === node.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== node.id) act(() => movePage(dragId, node.id));
            setDragId(null);
            setDropId(null);
          }}
          onClick={() => router.push(`/w/${node.id}`)}
        >
          <span
            className={`tw-caret${opened ? " open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggle(node.id);
            }}
            style={{ visibility: hasChildren ? "visible" : "hidden" }}
          >
            ▶
          </span>
          <span className="tw-icon">{iconGlyph(node.icon)}</span>
          <span className="tw-title">{node.title || "Untitled"}</span>
          <span className="tw-actions">
            <button
              className="tw-btn"
              title="Add subpage"
              onClick={(e) => {
                e.stopPropagation();
                void addChild(node.id);
              }}
            >
              +
            </button>
            <RowMenu node={node} onAct={act} />
          </span>
        </div>
        {hasChildren && opened && (
          <div className="tw-children">
            {node.children.map((c) => (
              <Row key={c.id} node={c} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <nav className="sidebar">
      <div className="sb-brand">
        <span className="dot" />
        Workspace
      </div>

      {favorites.length > 0 && (
        <>
          <div className="sb-section">Favorites</div>
          {favorites.map((f) => (
            <Link
              key={f.id}
              href={`/w/${f.id}`}
              className={`tree-row${activeId === f.id ? " active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              <span className="tw-caret" style={{ visibility: "hidden" }} />
              <span className="tw-icon">{iconGlyph(f.icon)}</span>
              <span className="tw-title">{f.title || "Untitled"}</span>
            </Link>
          ))}
        </>
      )}

      <div className="sb-section">
        Private
        <button
          className="sb-add"
          title="New page"
          onClick={() =>
            start(async () => {
              const { id } = await createPage({});
              router.push(`/w/${id}`);
              router.refresh();
            })
          }
        >
          +
        </button>
      </div>
      <div
        onDragOver={(e) => {
          if (dragId) e.preventDefault();
        }}
        onDrop={() => {
          if (dragId) act(() => movePage(dragId, null));
          setDragId(null);
          setDropId(null);
        }}
      >
        {tree.length === 0 && <div className="tw-empty">No pages yet</div>}
        {tree.map((n) => (
          <Row key={n.id} node={n} depth={0} />
        ))}
      </div>
    </nav>
  );
}

function RowMenu({
  node,
  onAct,
}: {
  node: PageNode;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button
        className="tw-btn"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 59 }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="pop" style={{ top: 24, right: 0 }}>
            <div
              className="pop-item"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                const t = window.prompt("Rename page", node.title);
                if (t != null) onAct(() => renamePage(node.id, t));
              }}
            >
              ✏️ Rename
            </div>
            <div
              className="pop-item"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAct(() => toggleFavorite(node.id));
              }}
            >
              {node.isFavorite ? "★ Remove favorite" : "☆ Favorite"}
            </div>
            <div className="pop-sep" />
            <div
              className="pop-item danger"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (window.confirm("Move this page to Trash?"))
                  onAct(() => archivePage(node.id));
              }}
            >
              🗑 Move to Trash
            </div>
          </div>
        </>
      )}
    </span>
  );
}
