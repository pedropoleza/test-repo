"use client";

import { api, type RouterOutputs } from "~/trpc/react";
import {
  COLOR_HEX,
  PRIORITY_META,
  avatarColor,
  initials,
  formatDue,
  isOverdue,
} from "./palette";

export type Task = RouterOutputs["task"]["list"][number];

export function TaskCard({
  task,
  usersById,
  onClick,
  dragging,
}: {
  task: Task;
  usersById: Map<string, string>;
  onClick: () => void;
  dragging: boolean;
}) {
  const overdue = isOverdue(task.dueDate, task.status);
  const checkDone = task.checklist.filter((c) => c.done).length;
  const checkTotal = task.checklist.length;
  const archived = !!task.archivedAt;

  return (
    <div
      className={`card${dragging ? " dragging" : ""}${task.status === "done" ? " done" : ""}${archived ? " archived" : ""}${task.cardStyle === "filled" ? " filled" : ""}`}
      style={{ ["--card-color" as string]: COLOR_HEX[task.color] }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="card-title">
        {task.priority !== "none" && (
          <span
            className="flag"
            title={PRIORITY_META[task.priority].label}
            style={{ color: PRIORITY_META[task.priority].color, marginRight: 6 }}
          >
            ⚑
          </span>
        )}
        {task.title}
      </div>
      {task.note && <div className="card-note">{task.note}</div>}
      {task.labels.length > 0 && (
        <div className="label-row" style={{ marginTop: 6 }}>
          {task.labels.slice(0, 3).map((l) => (
            <span key={l} className="label-chip">
              {l}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="label-chip">+{task.labels.length - 3}</span>
          )}
        </div>
      )}
      <div className="card-footer">
        {archived && <span className="pill archived-pill">Arquivada</span>}
        {task.dueDate && (
          <span className={`pill${overdue ? " overdue" : ""}`}>
            {overdue ? "⚠ " : "🗓 "}
            {formatDue(task.dueDate)}
          </span>
        )}
        {checkTotal > 0 && (
          <span
            className={`progress-pill${checkDone === checkTotal ? " complete" : ""}`}
            title={`Checklist: ${checkDone}/${checkTotal}`}
          >
            ✓ {checkDone}/{checkTotal}
            <span className="progress-bar">
              <span style={{ width: `${(checkDone / checkTotal) * 100}%` }} />
            </span>
          </span>
        )}
        {task.contactId && <ContactPill contactId={task.contactId} />}
        {task.assigneeIds.length > 0 && (
          <span className="avatars">
            {task.assigneeIds.slice(0, 4).map((uid) => {
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
            {task.assigneeIds.length > 4 && (
              <span className="avatar" style={{ background: "#667085" }}>
                +{task.assigneeIds.length - 4}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function ContactPill({ contactId }: { contactId: string }) {
  const contact = api.ghl.contactGet.useQuery(
    { contactId },
    { staleTime: 10 * 60_000, retry: 1 },
  );
  return (
    <span className="pill contact" title={contact.data?.name ?? "Contato"}>
      👤 {contact.data?.name ?? "Contato"}
    </span>
  );
}
