"use client";

import { api, type RouterOutputs } from "~/trpc/react";
import {
  COLOR_HEX,
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
  return (
    <div
      className={`card${dragging ? " dragging" : ""}${task.status === "done" ? " done" : ""}`}
      style={{ ["--card-color" as string]: COLOR_HEX[task.color] }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="card-title">{task.title}</div>
      {task.note && <div className="card-note">{task.note}</div>}
      <div className="card-footer">
        {task.dueDate && (
          <span className={`pill${overdue ? " overdue" : ""}`}>
            {overdue ? "⚠ " : "🗓 "}
            {formatDue(task.dueDate)}
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

function ContactPill({ contactId }: { contactId: string }) {
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
