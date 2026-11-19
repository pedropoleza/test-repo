"use client";

/**
 * Task card, structured top-to-bottom with a clear hierarchy:
 *   1. tags row (priority / recurring / origin / archived) — only when present
 *   2. title
 *   3. note preview
 *   4. labels
 *   5. meta footer (divider): due + checklist on the left, contact + assignees
 *      on the right
 * Quick actions are a single floating pill (SVG icons) revealed on hover at
 * the top-right edge.
 */
import { api, type RouterOutputs } from "~/trpc/react";
import {
  COLOR_HEX,
  PRIORITY_META,
  avatarColor,
  initials,
  formatDue,
  isOverdue,
} from "./palette";
import {
  IconArchive,
  IconCalendar,
  IconChat,
  IconCheck,
  IconChecklist,
  IconFlag,
  IconRepeat,
  IconRestore,
  IconTrash,
  IconUserPlus,
  IconZap,
} from "./Icons";
import { openResolvedTab } from "./open-tab";
import { useContactsCtx } from "./ContactsContext";

export type Task = RouterOutputs["task"]["list"][number];

export function TaskCard({
  task,
  usersById,
  isDone,
  onClick,
  dragging,
  currentUserId,
  openStageId,
  doneStageId,
}: {
  task: Task;
  usersById: Map<string, string>;
  /** Whether the task's current stage is a completion stage. */
  isDone: boolean;
  onClick: () => void;
  dragging: boolean;
  currentUserId: string | undefined;
  openStageId: string;
  doneStageId: string;
}) {
  const utils = api.useUtils();
  const move = api.task.move.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });
  const assign = api.task.assign.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });
  const setArchived = api.task.setArchived.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });
  const deleteTask = api.task.delete.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });

  const overdue = isOverdue(task.dueDate, isDone);
  const checkDone = task.checklist.filter((c) => c.done).length;
  const checkTotal = task.checklist.length;
  const archived = !!task.archivedAt;
  const mineAlready = !!currentUserId && task.assigneeIds.includes(currentUserId);
  const prio = PRIORITY_META[task.priority];
  const hasTags =
    task.priority !== "none" || task.recurring || task.source === "ghl" || archived;
  const hasMeta =
    !!task.dueDate || checkTotal > 0 || !!task.contactId || task.assigneeIds.length > 0;

  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  async function openConversation(e: React.MouseEvent) {
    stop(e);
    await openResolvedTab(async () => {
      const { url } = await utils.ghl.conversationUrl.fetch({
        contactId: task.contactId!,
      });
      return url;
    });
  }

  return (
    <div
      className={`card${dragging ? " dragging" : ""}${isDone ? " done" : ""}${archived ? " archived" : ""}${task.cardStyle === "filled" ? " filled" : ""}${task.recurring ? " recurring" : ""}`}
      style={{ ["--card-color" as string]: COLOR_HEX[task.color] }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Hover quick-action pill */}
      <div className="qa-bar" onMouseDown={stop}>
        <button
          className={`qa${isDone ? " on-done" : ""}`}
          title={isDone ? "Reopen" : "Mark complete"}
          onClick={(e) => {
            stop(e);
            move.mutate({ id: task.id, status: isDone ? openStageId : doneStageId });
          }}
        >
          <IconCheck />
        </button>
        {currentUserId && !mineAlready && (
          <button
            className="qa"
            title="Assign to me"
            onClick={(e) => {
              stop(e);
              assign.mutate({ id: task.id, add: [currentUserId] });
            }}
          >
            <IconUserPlus />
          </button>
        )}
        {task.contactId && (
          <button className="qa qa-chat" title="Message client" onClick={openConversation}>
            <IconChat />
          </button>
        )}
        <span className="qa-sep" />
        <button
          className="qa"
          title={archived ? "Restore" : "Archive"}
          onClick={(e) => {
            stop(e);
            setArchived.mutate({ id: task.id, archived: !archived });
          }}
        >
          {archived ? <IconRestore /> : <IconArchive />}
        </button>
        <button
          className="qa qa-danger"
          title="Delete"
          onClick={(e) => {
            stop(e);
            if (window.confirm("Delete this task? This cannot be undone.")) {
              deleteTask.mutate({ id: task.id });
            }
          }}
        >
          <IconTrash />
        </button>
      </div>

      {/* 1. Tags */}
      {hasTags && (
        <div className="card-tags">
          {task.priority !== "none" && (
            <span
              className="tag"
              style={{ color: prio.color, background: `${prio.color}14` }}
              title={`Priority: ${prio.label}`}
            >
              <IconFlag size={10} />
              {prio.label}
            </span>
          )}
          {task.recurring && (
            <span
              className="tag"
              style={{ color: "#6938EF", background: "#6938EF14" }}
              title="Recurring task"
            >
              <IconRepeat size={10} />
              Recurring
            </span>
          )}
          {task.source === "ghl" && (
            <span
              className="tag"
              style={{ color: "#155EEF", background: "#155EEF14" }}
              title="Synced from Spark"
            >
              <IconZap size={10} />
              Spark
            </span>
          )}
          {archived && (
            <span
              className="tag"
              style={{ color: "#667085", background: "#66708514" }}
            >
              <IconArchive size={10} />
              Archived
            </span>
          )}
        </div>
      )}

      {/* 2. Title */}
      <div className="card-title">{task.title}</div>

      {/* 3. Note preview */}
      {task.note && <div className="card-note">{task.note}</div>}

      {/* 4. Labels */}
      {task.labels.length > 0 && (
        <div className="label-row" style={{ marginTop: 7 }}>
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

      {/* 5. Meta footer */}
      {hasMeta && (
        <div className="card-meta">
          <div className="meta-left">
            {task.dueDate && (
              <span
                className={`meta-item${overdue ? " overdue" : ""}`}
                title={overdue ? "Overdue" : "Due date"}
              >
                <IconCalendar size={12} />
                {formatDue(task.dueDate)}
              </span>
            )}
            {checkTotal > 0 && (
              <span
                className={`meta-item${checkDone === checkTotal ? " complete" : ""}`}
                title={`Checklist ${checkDone}/${checkTotal}`}
              >
                <IconChecklist size={12} />
                {checkDone}/{checkTotal}
              </span>
            )}
          </div>
          <div className="meta-right">
            {task.contactId && <ContactPill contactId={task.contactId} />}
            {task.assigneeIds.length > 0 && (
              <span className="avatars">
                {task.assigneeIds.slice(0, 3).map((uid) => {
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
                {task.assigneeIds.length > 3 && (
                  <span className="avatar" style={{ background: "#667085" }}>
                    +{task.assigneeIds.length - 3}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactPill({ contactId }: { contactId: string }) {
  const utils = api.useUtils();
  const ctx = useContactsCtx();
  // Prefer the board's batched resolution. Only fall back to an individual
  // lookup when there's no provider, or the batch is done and didn't cover it.
  const fromBatch = ctx?.requestedIds.has(contactId)
    ? ctx.contacts[contactId]
    : undefined;
  const useIndividual = ctx
    ? !ctx.pending && !ctx.requestedIds.has(contactId)
    : true;
  const contact = api.ghl.contactGet.useQuery(
    { contactId },
    { staleTime: 10 * 60_000, retry: 1, enabled: useIndividual },
  );
  const resolved = fromBatch ?? contact.data;
  const name = resolved?.name ?? "Contact";
  const photo = resolved?.photoUrl;

  async function openConversation(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    await openResolvedTab(async () => {
      const { url } = await utils.ghl.conversationUrl.fetch({ contactId });
      return url;
    });
  }

  return (
    <button
      className="contact-mini"
      title={`${name} — open conversation`}
      onClick={openConversation}
    >
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
      <span className="contact-mini-name">{name.split(" ")[0]}</span>
      <span className="contact-mini-chat">
        <IconChat size={10} />
      </span>
    </button>
  );
}
