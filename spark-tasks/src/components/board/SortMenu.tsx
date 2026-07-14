"use client";

import { useEffect, useRef, useState } from "react";
import { IconSort, IconChevron, IconCheck } from "./Icons";

export type SortMode = "manual" | "priority" | "due";

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: "manual", label: "Manual order" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "Due date" },
];

export function SortMenu({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="sort-wrap" ref={ref}>
      <button className="toolbar-btn" onClick={() => setOpen((v) => !v)}>
        <IconSort size={15} />
        <span>Sort</span>
        {value !== "manual" && <span className="toolbar-badge">{current.label}</span>}
        <IconChevron size={13} />
      </button>
      {open && (
        <div className="sort-menu">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`sort-item${o.value === value ? " on" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <IconCheck size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
