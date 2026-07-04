/**
 * Shared board constants — fixed color palette + priority scale (§6, D4).
 * Hexes mirror the GHL design language tokens in globals.css. Stages
 * (columns) are per-board data now; helpers here operate on them.
 */
import type { Stage, TaskColor, TaskPriority } from "~/server/db/schema";

export const COLOR_HEX: Record<TaskColor, string> = {
  gray: "#667085",
  blue: "#155EEF",
  amber: "#F79009",
  green: "#12B76A",
  red: "#F04438",
  purple: "#7A5AF8",
};

export const COLORS = Object.keys(COLOR_HEX) as TaskColor[];

/** Priority scale (ClickUp-style flags). rank drives "sort by priority". */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; color: string; rank: number }
> = {
  urgent: { label: "Urgent", color: "#F04438", rank: 0 },
  high: { label: "High", color: "#F79009", rank: 1 },
  medium: { label: "Medium", color: "#155EEF", rank: 2 },
  low: { label: "Low", color: "#667085", rank: 3 },
  none: { label: "No priority", color: "#98A2B3", rank: 4 },
};

export const PRIORITIES = Object.keys(PRIORITY_META) as TaskPriority[];

const AVATAR_COLORS = ["#155EEF", "#7A5AF8", "#12B76A", "#F79009", "#F04438", "#0E9384"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : "";
  return `${first}${last ?? ""}`;
}

export function formatDue(d: Date): string {
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

/** Overdue = has a due date, in the past, and not already in a done stage. */
export function isOverdue(due: Date | null, isDone: boolean): boolean {
  return !!due && !isDone && due.getTime() < Date.now();
}

/** Quick lookup helpers over a board's stages. */
export function stageMap(stages: Stage[]): Map<string, Stage> {
  return new Map(stages.map((s) => [s.id, s]));
}

export function doneStageIds(stages: Stage[]): Set<string> {
  return new Set(stages.filter((s) => s.isDone).map((s) => s.id));
}

/** A short, url/id-safe slug for a new stage id derived from its name. */
export function slugStageId(name: string, existing: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "stage";
  let id = base;
  let n = 1;
  while (existing.has(id)) id = `${base}-${n++}`;
  return id;
}
