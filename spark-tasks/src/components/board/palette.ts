/**
 * Shared board constants — fixed palette + status metadata (plan §6, D3/D4).
 * Hexes mirror the GHL design language tokens in globals.css.
 */
import type { TaskColor, TaskPriority, TaskStatus } from "~/server/db/schema";

export const STATUSES: TaskStatus[] = ["todo", "doing", "waiting", "done"];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; defaultColor: TaskColor }
> = {
  todo: { label: "A Fazer", dot: "#667085", defaultColor: "gray" },
  doing: { label: "Em Progresso", dot: "#155EEF", defaultColor: "blue" },
  waiting: { label: "Aguardando", dot: "#F79009", defaultColor: "amber" },
  done: { label: "Concluída", dot: "#12B76A", defaultColor: "green" },
};

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
  urgent: { label: "Urgente", color: "#F04438", rank: 0 },
  high: { label: "Alta", color: "#F79009", rank: 1 },
  medium: { label: "Média", color: "#155EEF", rank: 2 },
  low: { label: "Baixa", color: "#667085", rank: 3 },
  none: { label: "Sem prioridade", color: "#98A2B3", rank: 4 },
};

export const PRIORITIES = Object.keys(PRIORITY_META) as TaskPriority[];

/** Per-column display after applying the board's overrides. */
export type StatusDisplay = { label: string; dot: string };

export function mergeColumnMeta(
  config: Partial<Record<TaskStatus, { label?: string; color?: TaskColor }>> | undefined,
): Record<TaskStatus, StatusDisplay> {
  const out = {} as Record<TaskStatus, StatusDisplay>;
  for (const s of STATUSES) {
    const cfg = config?.[s];
    out[s] = {
      label: cfg?.label?.trim() || STATUS_META[s].label,
      dot: cfg?.color ? COLOR_HEX[cfg.color] : STATUS_META[s].dot,
    };
  }
  return out;
}

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
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function isOverdue(due: Date | null, status: TaskStatus): boolean {
  return !!due && status !== "done" && due.getTime() < Date.now();
}
