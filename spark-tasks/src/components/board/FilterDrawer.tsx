"use client";

/**
 * Right-side "Advanced filters" drawer (GHL-style). All board filters live
 * here; the topbar keeps just Search + the Filters/Sort buttons.
 */
import { PRIORITIES, PRIORITY_META, avatarColor, initials } from "./palette";
import { IconX } from "./Icons";
import type { TaskPriority } from "~/server/db/schema";

export type DueFilter = "all" | "overdue" | "today" | "week";

export type Filters = {
  assigneeId: string;
  due: DueFilter;
  myTasks: boolean;
  archived: boolean;
  priority: TaskPriority | "all";
  label: string;
};

export const EMPTY_FILTERS: Filters = {
  assigneeId: "",
  due: "all",
  myTasks: false,
  archived: false,
  priority: "all",
  label: "",
};

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.assigneeId) n++;
  if (f.due !== "all") n++;
  if (f.myTasks) n++;
  if (f.archived) n++;
  if (f.priority !== "all") n++;
  if (f.label) n++;
  return n;
}

type GhlUser = { id: string; name: string };

export function FilterDrawer({
  filters,
  onChange,
  users,
  labels,
  currentUserId,
  usersById,
  onClose,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  users: GhlUser[];
  labels: string[];
  currentUserId: string | undefined;
  usersById: Map<string, string>;
  onClose: () => void;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const count = activeFilterCount(filters);

  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="filter-drawer" role="dialog" aria-label="Filters">
        <header className="drawer-head">
          <h2>
            Filters {count > 0 && <span className="drawer-count">{count}</span>}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </header>

        <div className="drawer-body">
          {/* My tasks */}
          <label className="drawer-switch">
            <span>
              {currentUserId && (
                <span
                  className="avatar"
                  style={{ background: avatarColor(currentUserId), marginLeft: 0, marginRight: 8 }}
                >
                  {initials(usersById.get(currentUserId) ?? "Me")}
                </span>
              )}
              My tasks only
            </span>
            <input
              type="checkbox"
              checked={filters.myTasks}
              onChange={(e) => set({ myTasks: e.target.checked })}
            />
          </label>

          {/* Assignee */}
          <div className="drawer-field">
            <label>Assignee</label>
            <select
              className="select"
              value={filters.assigneeId}
              onChange={(e) => set({ assigneeId: e.target.value })}
            >
              <option value="">Anyone</option>
              {users
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Priority */}
          <div className="drawer-field">
            <label>Priority</label>
            <div className="chip-group">
              <button
                className={`f-chip${filters.priority === "all" ? " on" : ""}`}
                onClick={() => set({ priority: "all" })}
              >
                All
              </button>
              {PRIORITIES.filter((p) => p !== "none").map((p) => (
                <button
                  key={p}
                  className={`f-chip${filters.priority === p ? " on" : ""}`}
                  style={
                    filters.priority === p
                      ? { color: PRIORITY_META[p].color, borderColor: PRIORITY_META[p].color }
                      : undefined
                  }
                  onClick={() => set({ priority: p })}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div className="drawer-field">
            <label>Due date</label>
            <div className="chip-group">
              {(
                [
                  ["all", "All"],
                  ["overdue", "Overdue"],
                  ["today", "Today"],
                  ["week", "Next 7 days"],
                ] as [DueFilter, string][]
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  className={`f-chip${filters.due === v ? " on" : ""}`}
                  onClick={() => set({ due: v })}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div className="drawer-field">
              <label>Label</label>
              <div className="chip-group">
                <button
                  className={`f-chip${filters.label === "" ? " on" : ""}`}
                  onClick={() => set({ label: "" })}
                >
                  All
                </button>
                {labels.map((l) => (
                  <button
                    key={l}
                    className={`f-chip${filters.label === l ? " on" : ""}`}
                    onClick={() => set({ label: l })}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Archived */}
          <label className="drawer-switch">
            <span>Show archived tasks</span>
            <input
              type="checkbox"
              checked={filters.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
          </label>
        </div>

        <footer className="drawer-foot">
          <button
            className="btn btn-secondary"
            disabled={count === 0}
            onClick={() => onChange({ ...EMPTY_FILTERS })}
          >
            Clear all
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </div>
  );
}
