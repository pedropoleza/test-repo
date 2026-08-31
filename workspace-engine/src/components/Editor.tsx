"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Block, BlockType } from "~/server/schema";
import {
  createBlock,
  updateBlock,
  deleteBlock,
  moveBlock,
} from "~/server/actions";

type EBlock = {
  key: string;
  id: string | null;
  type: BlockType;
  text: string;
  checked: boolean;
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function toE(b: Block): EBlock {
  const spans = (b.content?.text ?? []) as Array<{ text: string }>;
  return {
    key: b.id,
    id: b.id,
    type: b.type,
    text: spans.map((s) => s.text).join(""),
    checked: !!b.content?.checked,
  };
}

const LIST_TYPES: BlockType[] = ["bulleted_list", "numbered_list", "checklist"];
const NO_TEXT: BlockType[] = ["divider"];

const SLASH: Array<{ type: BlockType; label: string; hint: string; ic: string }> = [
  { type: "paragraph", label: "Text", hint: "Plain paragraph", ic: "¶" },
  { type: "heading1", label: "Heading 1", hint: "Big section heading", ic: "H₁" },
  { type: "heading2", label: "Heading 2", hint: "Medium heading", ic: "H₂" },
  { type: "heading3", label: "Heading 3", hint: "Small heading", ic: "H₃" },
  { type: "bulleted_list", label: "Bulleted list", hint: "Simple bullets", ic: "•" },
  { type: "numbered_list", label: "Numbered list", hint: "Ordered list", ic: "1." },
  { type: "checklist", label: "To-do", hint: "Checklist item", ic: "☑" },
  { type: "quote", label: "Quote", hint: "Capture a quote", ic: "❝" },
  { type: "callout", label: "Callout", hint: "Highlight a note", ic: "💡" },
  { type: "code", label: "Code", hint: "Code snippet", ic: "</>" },
  { type: "divider", label: "Divider", hint: "Visual separator", ic: "—" },
];

export function Editor({
  pageId,
  initialBlocks,
  track,
}: {
  pageId: string;
  initialBlocks: Block[];
  track: (p: Promise<unknown>) => Promise<void>;
}) {
  const [blocks, setBlocks] = useState<EBlock[]>(() => {
    const arr = initialBlocks.map(toE);
    if (arr.length === 0)
      arr.push({ key: uid(), id: null, type: "paragraph", text: "", checked: false });
    return arr;
  });
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const els = useRef(new Map<string, HTMLDivElement>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingFocus = useRef<{ key: string; at: "start" | "end" } | null>(null);

  // Ensure the very first (unsaved) block gets a server id.
  useEffect(() => {
    const first = blocksRef.current[0];
    if (first && first.id === null) {
      void createBlock({ pageId, type: first.type }).then((res) =>
        setBlocks((bs) =>
          bs.map((b) => (b.key === first.key ? { ...b, id: res.id } : b)),
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    const el = els.current.get(f.key);
    if (el) placeCaret(el, f.at);
  });

  const setEl = (key: string) => (el: HTMLDivElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };

  const scheduleSave = useCallback(
    (key: string) => {
      const t = saveTimers.current.get(key);
      if (t) clearTimeout(t);
      saveTimers.current.set(
        key,
        setTimeout(() => {
          const el = els.current.get(key);
          const blk = blocksRef.current.find((b) => b.key === key);
          if (!blk || !blk.id) return;
          const text = el?.textContent ?? blk.text;
          void track(
            updateBlock(blk.id, {
              content: { text: [{ text }], checked: blk.checked },
            }),
          );
        }, 600),
      );
    },
    [track],
  );

  function persistNew(key: string, afterId: string | null, type: BlockType) {
    void createBlock({ pageId, afterBlockId: afterId, type }).then((res) =>
      setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, id: res.id } : b))),
    );
  }

  function addAfter(currentKey: string, type: BlockType) {
    const cur = blocksRef.current.find((b) => b.key === currentKey);
    const newKey = uid();
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.key === currentKey);
      const next = [...bs];
      next.splice(i + 1, 0, { key: newKey, id: null, type, text: "", checked: false });
      return next;
    });
    pendingFocus.current = { key: newKey, at: "start" };
    persistNew(newKey, cur?.id ?? null, type);
  }

  function removeBlock(key: string) {
    const idx = blocksRef.current.findIndex((b) => b.key === key);
    const blk = blocksRef.current[idx];
    if (!blk) return;
    if (blocksRef.current.length === 1) return; // keep at least one
    const prev = blocksRef.current[idx - 1];
    setBlocks((bs) => bs.filter((b) => b.key !== key));
    if (prev) pendingFocus.current = { key: prev.key, at: "end" };
    if (blk.id) void track(deleteBlock(blk.id));
  }

  function changeType(key: string, type: BlockType) {
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, type } : b)));
    const blk = blocksRef.current.find((b) => b.key === key);
    if (blk?.id) void track(updateBlock(blk.id, { type }));
    pendingFocus.current = { key, at: "end" };
  }

  function duplicate(key: string) {
    const blk = blocksRef.current.find((b) => b.key === key);
    if (!blk) return;
    const newKey = uid();
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.key === key);
      const next = [...bs];
      next.splice(i + 1, 0, { ...blk, key: newKey, id: null });
      return next;
    });
    void createBlock({
      pageId,
      afterBlockId: blk.id,
      type: blk.type,
      content: { text: [{ text: blk.text }], checked: blk.checked },
    }).then((res) =>
      setBlocks((bs) => bs.map((b) => (b.key === newKey ? { ...b, id: res.id } : b))),
    );
  }

  function toggleCheck(key: string) {
    setBlocks((bs) =>
      bs.map((b) => (b.key === key ? { ...b, checked: !b.checked } : b)),
    );
    const blk = blocksRef.current.find((b) => b.key === key);
    if (blk?.id)
      void track(
        updateBlock(blk.id, {
          content: { text: [{ text: blk.text }], checked: !blk.checked },
        }),
      );
  }

  // ---- drag reorder ----
  const [dragKey, setDragKey] = useState<string | null>(null);
  function onDropOn(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.key === dragKey);
      const to = bs.findIndex((b) => b.key === targetKey);
      const next = [...bs];
      const [moved] = next.splice(from, 1);
      const insertAt = from < to ? to : to + 1;
      next.splice(insertAt, 0, moved!);
      // compute midpoint position for persistence
      const prev = next[insertAt - 1];
      const after = next[insertAt + 1];
      const moving = next[insertAt]!;
      if (moving.id) {
        const a = prev ? posOf(bs, prev.key) : 0;
        const b = after ? posOf(bs, after.key) : a + 2000;
        void track(moveBlock(moving.id, (a + b) / 2));
      }
      return next;
    });
    setDragKey(null);
  }

  // slash menu
  const [slash, setSlash] = useState<{ key: string; x: number; y: number } | null>(null);
  const [slashSel, setSlashSel] = useState(0);

  function openSlash(key: string) {
    const el = els.current.get(key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSlash({ key, x: r.left, y: r.bottom + 4 });
    setSlashSel(0);
  }
  function pickSlash(type: BlockType) {
    if (!slash) return;
    const el = els.current.get(slash.key);
    if (el) el.textContent = "";
    if (type === "divider") {
      changeType(slash.key, "divider");
      addAfter(slash.key, "paragraph");
    } else {
      changeType(slash.key, type);
    }
    setSlash(null);
  }

  let numberCounter = 0;
  return (
    <div className="editor">
      {blocks.map((b, i) => {
        const prev = blocks[i - 1];
        if (b.type === "numbered_list") {
          numberCounter = prev?.type === "numbered_list" ? numberCounter + 1 : 1;
        } else {
          numberCounter = 0;
        }
        return (
          <BlockRow
            key={b.key}
            b={b}
            number={numberCounter}
            setEl={setEl(b.key)}
            onInput={() => {
              scheduleSave(b.key);
            }}
            onKeyDown={(e) => handleKeyDown(e, b)}
            onDragStartHandle={() => setDragKey(b.key)}
            onDrop={() => onDropOn(b.key)}
            dragging={dragKey === b.key}
            onToggleCheck={() => toggleCheck(b.key)}
            onDuplicate={() => duplicate(b.key)}
            onDelete={() => removeBlock(b.key)}
            onTurnInto={(t) => changeType(b.key, t)}
          />
        );
      })}

      {slash && (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          sel={slashSel}
          onHover={setSlashSel}
          onPick={pickSlash}
          onClose={() => setSlash(null)}
        />
      )}
    </div>
  );

  function posOf(list: EBlock[], key: string): number {
    return list.findIndex((b) => b.key === key) * 1000 + 1000;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>, b: EBlock) {
    const el = e.currentTarget;
    const text = el.textContent ?? "";

    if (slash) {
      if (e.key === "Escape") {
        setSlash(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSel((s) => Math.min(s + 1, SLASH.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSel((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pickSlash(SLASH[slashSel]!.type);
        return;
      }
    }

    if (e.key === "/" && text === "") {
      // opening slash on an empty block
      setTimeout(() => openSlash(b.key), 0);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const continueList =
        LIST_TYPES.includes(b.type) && text.trim() !== "" ? b.type : "paragraph";
      if (LIST_TYPES.includes(b.type) && text.trim() === "") {
        changeType(b.key, "paragraph");
        return;
      }
      addAfter(b.key, continueList);
      return;
    }

    if (e.key === "Backspace" && text === "") {
      e.preventDefault();
      if (b.type !== "paragraph" && !NO_TEXT.includes(b.type)) {
        changeType(b.key, "paragraph");
      } else {
        removeBlock(b.key);
      }
    }
  }
}

function BlockRow({
  b,
  number,
  setEl,
  onInput,
  onKeyDown,
  onDragStartHandle,
  onDrop,
  dragging,
  onToggleCheck,
  onDuplicate,
  onDelete,
  onTurnInto,
}: {
  b: EBlock;
  number: number;
  setEl: (el: HTMLDivElement | null) => void;
  onInput: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDragStartHandle: () => void;
  onDrop: () => void;
  dragging: boolean;
  onToggleCheck: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTurnInto: (t: BlockType) => void;
}) {
  const [menu, setMenu] = useState(false);

  if (b.type === "divider") {
    return (
      <div className="blk" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="blk-gutter">
          <button
            className="g-btn"
            draggable
            onDragStart={onDragStartHandle}
            onClick={() => onDelete()}
            title="Delete divider"
          >
            ⋮⋮
          </button>
        </div>
        <div className="blk-body">
          <hr className="hr" />
        </div>
      </div>
    );
  }

  const ph =
    b.type === "heading1"
      ? "Heading 1"
      : b.type === "heading2"
        ? "Heading 2"
        : b.type === "heading3"
          ? "Heading 3"
          : b.type === "quote"
            ? "Quote"
            : b.type === "callout"
              ? "Callout"
              : b.type === "code"
                ? "Code"
                : "Type '/' for commands";

  const ce = (
    <div
      className={`ce t-${b.type}${b.checked ? " done" : ""}`}
      contentEditable
      suppressContentEditableWarning
      data-ph={ph}
      ref={setEl}
      onInput={onInput}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: escapeHtml(b.text) }}
    />
  );

  let body: React.ReactNode = ce;
  if (b.type === "bulleted_list") {
    body = (
      <div className="row-with-marker">
        <span className="marker">•</span>
        {ce}
      </div>
    );
  } else if (b.type === "numbered_list") {
    body = (
      <div className="row-with-marker">
        <span className="marker">{number}.</span>
        {ce}
      </div>
    );
  } else if (b.type === "checklist") {
    body = (
      <div className="row-with-marker">
        <span className="marker check" onClick={onToggleCheck}>
          <span className={`chk${b.checked ? " on" : ""}`} />
        </span>
        {ce}
      </div>
    );
  } else if (b.type === "callout") {
    body = (
      <div className="t-callout">
        <span>💡</span>
        {ce}
      </div>
    );
  }

  return (
    <div
      className="blk"
      style={{ opacity: dragging ? 0.4 : 1 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="blk-gutter">
        <span style={{ position: "relative" }}>
          <button
            className="g-btn"
            draggable
            onDragStart={onDragStartHandle}
            onClick={() => setMenu((v) => !v)}
            title="Drag or click for actions"
          >
            ⋮⋮
          </button>
          {menu && (
            <BlockMenu
              onClose={() => setMenu(false)}
              onDuplicate={() => {
                setMenu(false);
                onDuplicate();
              }}
              onDelete={() => {
                setMenu(false);
                onDelete();
              }}
              onTurnInto={(t) => {
                setMenu(false);
                onTurnInto(t);
              }}
            />
          )}
        </span>
      </div>
      <div className="blk-body">{body}</div>
    </div>
  );
}

function BlockMenu({
  onClose,
  onDuplicate,
  onDelete,
  onTurnInto,
}: {
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTurnInto: (t: BlockType) => void;
}) {
  const [turn, setTurn] = useState(false);
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 59 }} onClick={onClose} />
      <div className="pop" style={{ top: 24, left: 0, zIndex: 60 }}>
        {!turn ? (
          <>
            <div className="pop-item" onClick={onDuplicate}>
              ⧉ Duplicate
            </div>
            <div className="pop-item" onClick={() => setTurn(true)}>
              🔁 Turn into ›
            </div>
            <div className="pop-sep" />
            <div className="pop-item danger" onClick={onDelete}>
              🗑 Delete
            </div>
          </>
        ) : (
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {SLASH.filter((s) => s.type !== "divider").map((s) => (
              <div key={s.type} className="pop-item" onClick={() => onTurnInto(s.type)}>
                <span style={{ width: 18 }}>{s.ic}</span> {s.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SlashMenu({
  x,
  y,
  sel,
  onHover,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  sel: number;
  onHover: (i: number) => void;
  onPick: (t: BlockType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={onClose} />
      <div className="slash" style={{ left: x, top: y }}>
        <div className="slash-group">Basic blocks</div>
        {SLASH.map((s, i) => (
          <div
            key={s.type}
            className={`slash-item${i === sel ? " active" : ""}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(s.type);
            }}
          >
            <span className="slash-ic">{s.ic}</span>
            <span className="slash-tx">
              <b>{s.label}</b>
              <span>{s.hint}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- helpers ----
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function placeCaret(el: HTMLElement, at: "start" | "end") {
  el.focus();
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(at === "start");
  sel?.removeAllRanges();
  sel?.addRange(range);
}
