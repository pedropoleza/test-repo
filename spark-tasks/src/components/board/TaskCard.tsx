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
  isDone,
  onClick,
  dragging,
}: {
  task: Task;
  usersById: Map<string, string>;
  /** Whether the task's current stage is a completion stage. */
  isDone: boolean;
  onClick: () => void;
  dragging: boolean;
}) {
  const overdue = isOverdue(task.dueDate, isDone);
  const checkDone = task.checklist.filter((c) => c.done).length;
  const checkTotal = task.checklist.length;
  const archived = !!task.archivedAt;

  return (
    <div
      className={`card${dragging ? " dragging" : ""}${isDone ? " done" : ""}${archived ? " archived" : ""}${task.cardStyle === "filled" ? " filled" : ""}${task.recurring ? " recurring" : ""}`}
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
        {task.recurring && (
          <span className="pill recurring-pill" title="Recurring task">
            🔁 Recurring
          </span>
        )}
        {task.source === "ghl" && (
          <span className="pill spark-pill" title="Synced from Spark">
            ⚡ Spark
          </span>
        )}
        {archived && <span className="pill archived-pill">Archived</span>}
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
  const utils = api.useUtils();
  const contact = api.ghl.contactGet.useQuery(
    { contactId },
    { staleTime: 10 * 60_000, retry: 1 },
  );
  const name = contact.data?.name ?? "Contact";
  const photo = contact.data?.photoUrl;

  async function openConversation(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Open synchronously (keeps the user gesture), then set the resolved URL.
    const w = window.open("", "_blank", "noopener");
    try {
      const { url } = await utils.ghl.conversationUrl.fetch({ contactId });
      if (w) w.location.href = url;
    } catch {
      if (w) w.close();
    }
  }

  return (
    <span className="contact-chip" title={name}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="contact-photo" src={photo} alt="" />
      ) : (
        <span
          className="contact-photo initials"
          style={{ background: avatarColor(contactId) }}
        >
          {initials(name)}
        </span>
      )}
      <span className="contact-name">{name}</span>
      <button
        className="contact-chat"
        onClick={openConversation}
        title="Open conversation"
        aria-label="Open conversation"
      >
        💬
      </button>
    </span>
  );
}
