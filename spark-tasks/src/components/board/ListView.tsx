"use client";

/**
 * List view: flat, sortable table of the (already filtered/sorted) tasks.
 * Rows open the task modal; the status select and checkbox act inline.
 */
import { api } from "~/trpc/react";
import type { Stage } from "~/server/db/schema";
import {
  COLOR_HEX,
  PRIORITY_META,
  avatarColor,
  initials,
  formatDue,
  isOverdue,
} from "./palette";
import type { Task } from "./TaskCard";

export function ListView({
  tasks,
  usersById,
  stages,
  doneIds,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
}: {
  tasks: Task[];
  usersById: Map<string, string>;
  stages: Stage[];
  doneIds: Set<string>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onRowClick: (task: Task) => void;
}) {
  const utils = api.useUtils();
  const move = api.task.move.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;

  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));

  return (
    <div className="list-wrap">
      <table className="tasks-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Select all"
                style={{ accentColor: "var(--primary)" }}
              />
            </th>
            <th>Task</th>
            <th>Stage</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Checklist</th>
            <th>Assignees</th>
            <th>Labels</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                No tasks with the current filters
              </td>
            </tr>
          )}
          {tasks.map((t) => {
            const isDone = doneIds.has(t.status);
            const overdue = isOverdue(t.dueDate, isDone);
            const checkDone = t.checklist.filter((c) => c.done).length;
            return (
              <tr
                key={t.id}
                className={selected.has(t.id) ? "selected" : ""}
                onClick={() => onRowClick(t)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => onToggleSelect(t.id)}
                    aria-label="Select task"
                    style={{ accentColor: "var(--primary)" }}
                  />
                </td>
                <td>
                  <span className="lrow-title">
                    <span className="color-dot" style={{ background: COLOR_HEX[t.color] }} />
                    {t.priority !== "none" && (
                      <span
                        className="flag"
                        style={{ color: PRIORITY_META[t.priority].color }}
                        title={PRIORITY_META[t.priority].label}
                      >
                        ⚑
                      </span>
                    )}
                    <span
                      style={
                        isDone
                          ? { textDecoration: "line-through", color: "var(--text-muted)" }
                          : undefined
                      }
                    >
                      {t.title}
                    </span>
                    {t.archivedAt && <span className="pill archived-pill">Archived</span>}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="select"
                    style={{ padding: "4px 8px", fontSize: 12.5 }}
                    value={t.status}
                    onChange={(e) => move.mutate({ id: t.id, status: e.target.value })}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    {!stages.some((s) => s.id === t.status) && (
                      <option value={t.status}>{stageName(t.status)}</option>
                    )}
                  </select>
                </td>
                <td>
                  {t.priority === "none" ? (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  ) : (
                    <span
                      className="status-chip"
                      style={{ color: PRIORITY_META[t.priority].color }}
                    >
                      ⚑ {PRIORITY_META[t.priority].label}
                    </span>
                  )}
                </td>
                <td>
                  {t.dueDate ? (
                    <span className={`pill${overdue ? " overdue" : ""}`}>
                      {overdue ? "⚠ " : ""}
                      {formatDue(t.dueDate)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {t.checklist.length ? (
                    <span
                      className={`progress-pill${checkDone === t.checklist.length ? " complete" : ""}`}
                    >
                      ✓ {checkDone}/{t.checklist.length}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {t.assigneeIds.length ? (
                    <span className="avatars" style={{ marginLeft: 0 }}>
                      {t.assigneeIds.slice(0, 4).map((uid) => {
                        const name = usersById.get(uid) ?? uid;
                        return (
                          <span
                            key={uid}
                            className="avatar"
                            title={name}
                            style={{ background: avatarColor(uid) }}
                          >
                            {initials(name)}
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {t.labels.length ? (
                    <span className="label-row">
                      {t.labels.slice(0, 2).map((l) => (
                        <span key={l} className="label-chip">
                          {l}
                        </span>
                      ))}
                      {t.labels.length > 2 && (
                        <span className="label-chip">+{t.labels.length - 2}</span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
