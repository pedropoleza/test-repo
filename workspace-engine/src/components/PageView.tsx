"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Block, Page, Icon, Cover } from "~/server/schema";
import { renamePage, setPageIcon, setPageCover } from "~/server/actions";
import { Editor } from "./Editor";
import { IconPicker } from "./IconPicker";

const GRADIENTS = [
  "linear-gradient(135deg,#667eea,#764ba2)",
  "linear-gradient(135deg,#f093fb,#f5576c)",
  "linear-gradient(135deg,#4facfe,#00f2fe)",
  "linear-gradient(135deg,#43e97b,#38f9d7)",
  "linear-gradient(135deg,#fa709a,#fee140)",
  "linear-gradient(135deg,#30cfd0,#330867)",
];

export type SaveStatus = "idle" | "saving" | "saved";

export function PageView({
  page,
  initialBlocks,
  crumbs,
}: {
  page: Page;
  initialBlocks: Block[];
  crumbs: Array<{ id: string; title: string; icon: Icon }>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = useCallback(async (p: Promise<unknown>) => {
    setStatus("saving");
    try {
      await p;
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("idle");
    }
  }, []);

  // Title (uncontrolled to avoid caret jumps).
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTitleInput(e: React.FormEvent<HTMLDivElement>) {
    const text = e.currentTarget.textContent ?? "";
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      void track(renamePage(page.id, text));
    }, 500);
  }

  const [cover, setCover] = useState<Cover>(page.cover);
  const [icon, setIcon] = useState<Icon>(page.icon);
  const [iconOpen, setIconOpen] = useState(false);

  function applyCover(next: Cover) {
    setCover(next);
    void track(setPageCover(page.id, next)).then(() => router.refresh());
  }
  function applyIcon(next: Icon) {
    setIcon(next);
    setIconOpen(false);
    void track(setPageIcon(page.id, next)).then(() => router.refresh());
  }

  const coverStyle: React.CSSProperties = cover
    ? cover.type === "url"
      ? { backgroundImage: `url(${cover.value})` }
      : { background: cover.value }
    : {};

  return (
    <>
      <div className="topbar">
        {crumbs.map((c, i) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && <span className="crumb-sep">/</span>}
            <Link
              href={`/w/${c.id}`}
              className={`crumb${i === crumbs.length - 1 ? " here" : ""}`}
            >
              {c.icon?.type === "emoji" ? `${c.icon.value} ` : ""}
              {c.title || "Untitled"}
            </Link>
          </span>
        ))}
        <span className="save-state">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>

      <div className="page-scroll">
        {cover && (
          <div className="cover" style={coverStyle}>
            <div className="cover-actions">
              <button
                className="mini-btn"
                onClick={() => {
                  const idx = GRADIENTS.indexOf(cover.value);
                  applyCover({
                    type: "gradient",
                    value: GRADIENTS[(idx + 1) % GRADIENTS.length]!,
                  });
                }}
              >
                Change cover
              </button>
              <button className="mini-btn" onClick={() => applyCover(null)}>
                Remove
              </button>
            </div>
          </div>
        )}

        <div className={`page-body${cover ? " has-cover" : ""}`}>
          <div className="page-head">
            {icon && (
              <div className="page-icon-lg" onClick={() => setIconOpen((v) => !v)}>
                {icon.type === "emoji" ? icon.value : "🖼"}
              </div>
            )}

            <div className="page-controls">
              {!icon && (
                <button
                  className="ghost-add"
                  onClick={() => applyIcon({ type: "emoji", value: "📄" })}
                >
                  😀 Add icon
                </button>
              )}
              {!cover && (
                <button
                  className="ghost-add"
                  onClick={() =>
                    applyCover({ type: "gradient", value: GRADIENTS[0]! })
                  }
                >
                  🖼 Add cover
                </button>
              )}
            </div>

            {iconOpen && (
              <IconPicker
                onPick={(emoji) => applyIcon({ type: "emoji", value: emoji })}
                onRemove={() => applyIcon(null)}
                onClose={() => setIconOpen(false)}
              />
            )}

            <div
              className="page-title"
              contentEditable
              suppressContentEditableWarning
              data-ph="Untitled"
              onInput={onTitleInput}
              onBlur={() => router.refresh()}
              dangerouslySetInnerHTML={{ __html: escapeHtml(page.title) }}
            />
          </div>

          <Editor pageId={page.id} initialBlocks={initialBlocks} track={track} />
        </div>
      </div>
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
