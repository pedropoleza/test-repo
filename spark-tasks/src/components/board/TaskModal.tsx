"use client";

/**
 * Task modal — wide two-column layout (ClickUp-style): content on the left
 * (title, note, checklist, comments), properties on the right (stage,
 * priority, due, color, assignees, labels, contact, actions). Fits without
 * scrolling the dialog on desktop; stacks on narrow iframes.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import type {
  CardStyle,
  ChecklistItem,
  Stage,
  TaskColor,
  TaskPriority,
} from "~/server/db/schema";
import {
  COLORS,
  COLOR_HEX,
  PRIORITIES,
  PRIORITY_META,
  avatarColor,
  initials,
} from "./palette";
import type { Task } from "./TaskCard";

type GhlUser = { id: string; name: string; email?: string };

export type ModalState =
  | { mode: "create"; status: string; title?: string }
  | { mode: "edit"; task: Task };

export function TaskModal({
  state,
  users,
  usersError,
  locationId,
  currentUserId,
  boardId,
  stages,
  requiresOwner,
  onClose,
}: {
  state: ModalState;
  users: GhlUser[];
  usersError: boolean;
  locationId: string | undefined;
  currentUserId: string | undefined;
  boardId: string | undefined;
  stages: Stage[];
  /** This subaccount requires at least one assignee (owner) on a task. */
  requiresOwner: boolean;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const editing = state.mode === "edit" ? state.task : null;
  const initialStatus = editing?.status ?? (state.mode === "create" ? state.status : stages[0]?.id ?? "todo");
  const stageColor = stages.find((s) => s.id === initialStatus)?.color ?? "gray";

  const [title, setTitle] = useState(
    editing?.title ?? (state.mode === "create" ? state.title ?? "" : ""),
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [color, setColor] = useState<TaskColor>(editing?.color ?? stageColor);
  const [status, setStatus] = useState<string>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>(editing?.priority ?? "none");
  const [cardStyle, setCardStyle] = useState<CardStyle>(editing?.cardStyle ?? "strip");
  const [due, setDue] = useState(editing?.dueDate ? toDateInput(editing.dueDate) : "");
  const [labels, setLabels] = useState<string[]>(editing?.labels ?? []);
  const [labelDraft, setLabelDraft] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(editing?.checklist ?? []);
  const [checkDraft, setCheckDraft] = useState("");
  const [assignees, setAssignees] = useState<Set<string>>(new Set(editing?.assigneeIds ?? []));
  const [contact, setContact] = useState<{ id: string; name: string } | null>(
    editing?.contactId ? { id: editing.contactId, name: "…" } : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linkedContact = api.ghl.contactGet.useQuery(
    { contactId: editing?.contactId ?? "" },
    { enabled: !!editing?.contactId, staleTime: 10 * 60_000, retry: 1 },
  );
  useEffect(() => {
    if (linkedContact.data && contact && contact.name === "…") {
      setContact({ id: linkedContact.data.id, name: linkedContact.data.name });
    }
  }, [linkedContact.data, contact]);

  const [contactQuery, setContactQuery] = useState("");
  const debouncedQuery = useDebounced(contactQuery, 300);
  const search = api.ghl.contactsSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2, staleTime: 60_000, retry: 1 },
  );

  const comments = api.task.comments.list.useQuery(
    { taskId: editing?.id ?? "" },
    { enabled: !!editing, refetchInterval: 25_000 },
  );
  const [commentDraft, setCommentDraft] = useState("");
  const addComment = api.task.comments.add.useMutation({
    onSuccess: () => {
      setCommentDraft("");
      void comments.refetch();
    },
  });
  const removeComment = api.task.comments.remove.useMutation({
    onSuccess: () => void comments.refetch(),
  });

  const create = api.task.create.useMutation();
  const update = api.task.update.useMutation();
  const move = api.task.move.useMutation();
  const assign = api.task.assign.useMutation();
  const duplicate = api.task.duplicate.useMutation();
  const setArchived = api.task.setArchived.useMutation();
  const deleteTask = api.task.delete.useMutation();

  const ownerMissing = requiresOwner && assignees.size === 0;

  async function save() {
    if (!title.trim() || saving || ownerMissing) return;
    setSaving(true);
    setError(null);
    const dueDate = due ? new Date(`${due}T12:00:00`) : null;
    try {
      if (state.mode === "create") {
        const created = await create.mutateAsync({
          boardId,
          title: title.trim(),
          note: note.trim() || null,
          status,
          color,
          cardStyle,
          priority,
          labels,
          dueDate,
          contactId: contact?.id ?? null,
          // Assignees are created atomically with the task (enforces the
          // required-owner rule server-side).
          assigneeIds: [...assignees],
        });
        if (checklist.length) await update.mutateAsync({ id: created.id, checklist });
      } else {
        const t = state.task;
        await update.mutateAsync({
          id: t.id,
          title: title.trim(),
          note: note.trim() || null,
          color,
          cardStyle,
          priority,
          labels,
          checklist,
          dueDate,
          contactId: contact?.id ?? null,
        });
        if (status !== t.status) await move.mutateAsync({ id: t.id, status });
        const add = [...assignees].filter((u) => !t.assigneeIds.includes(u));
        const remove = t.assigneeIds.filter((u) => !assignees.has(u));
        if (add.length || remove.length) await assign.mutateAsync({ id: t.id, add, remove });
      }
      await utils.task.list.invalidate();
      onClose();
    } catch {
      setError("Could not save. Try again.");
      setSaving(false);
    }
  }

  async function runAction(action: "duplicate" | "archive" | "restore" | "delete") {
    if (!editing || saving) return;
    if (action === "delete" && !window.confirm("Permanently delete this task? This cannot be undone.")) {
      return;
    }
    setSaving(true);
    try {
      if (action === "duplicate") await duplicate.mutateAsync({ id: editing.id });
      if (action === "archive") await setArchived.mutateAsync({ id: editing.id, archived: true });
      if (action === "restore") await setArchived.mutateAsync({ id: editing.id, archived: false });
      if (action === "delete") await deleteTask.mutateAsync({ id: editing.id });
      await utils.task.list.invalidate();
      onClose();
    } catch {
      setError("Action failed. Try again.");
      setSaving(false);
    }
  }

  function addLabel() {
    const l = labelDraft.trim();
    if (l && !labels.includes(l) && labels.length < 10) setLabels([...labels, l]);
    setLabelDraft("");
  }
  function addCheckItem() {
    const text = checkDraft.trim();
    if (text && checklist.length < 50) {
      setChecklist([...checklist, { id: `c${Date.now()}${checklist.length}`, text, done: false }]);
    }
    setCheckDraft("");
  }

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );
  const checkDone = checklist.filter((c) => c.done).length;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{state.mode === "create" ? "New task" : "Edit task"}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-columns">
          {/* ---------- Main content ---------- */}
          <div className="modal-main">
            <div className="field">
              <input
                className="input"
                style={{ fontSize: 16, fontWeight: 600 }}
                autoFocus={state.mode === "create"}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                maxLength={500}
              />
            </div>

            <div className="field">
              <label>Note</label>
              <textarea
                className="textarea"
                style={{ minHeight: 150 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Details, context, next steps…"
                maxLength={10_000}
              />
            </div>

            <div className="field">
              <label>
                Checklist{" "}
                {checklist.length > 0 && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                    — {checkDone}/{checklist.length}
                  </span>
                )}
              </label>
              {checklist.length > 0 && (
                <div className="checklist" style={{ marginBottom: 6 }}>
                  {checklist.map((c) => (
                    <div key={c.id} className={`check-item${c.done ? " done" : ""}`}>
                      <input
                        type="checkbox"
                        checked={c.done}
                        onChange={() =>
                          setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))
                        }
                      />
                      <span className="txt">{c.text}</span>
                      <button
                        type="button"
                        className="rm"
                        aria-label="Remove item"
                        onClick={() => setChecklist(checklist.filter((x) => x.id !== c.id))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addCheckItem();
                }}
              >
                <input
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="+ Add item and press Enter"
                  value={checkDraft}
                  onChange={(e) => setCheckDraft(e.target.value)}
                  maxLength={500}
                />
              </form>
            </div>

            {editing && (
              <div className="field">
                <label>Comments</label>
                {comments.data && comments.data.length > 0 && (
                  <div className="comments" style={{ marginBottom: 8 }}>
                    {comments.data.map((c) => {
                      const who = users.find((u) => u.id === c.authorId)?.name ?? "User";
                      return (
                        <div key={c.id} className="comment">
                          <span
                            className="avatar"
                            style={{ background: avatarColor(c.authorId), marginLeft: 0 }}
                          >
                            {initials(who)}
                          </span>
                          <div className="comment-body">
                            <div className="comment-meta">
                              <span className="who">{who}</span>
                              <span className="when">
                                {c.createdAt.toLocaleString("en-US", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {c.authorId === currentUserId && (
                                <button className="rm" onClick={() => removeComment.mutate({ id: c.id })}>
                                  delete
                                </button>
                              )}
                            </div>
                            <div className="comment-text">{c.body}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = commentDraft.trim();
                    if (body && editing) addComment.mutate({ taskId: editing.id, body });
                  }}
                  style={{ display: "flex", gap: 8 }}
                >
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Write a comment…"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    maxLength={4000}
                  />
                  <button
                    className="btn btn-secondary"
                    type="submit"
                    disabled={!commentDraft.trim() || addComment.isPending}
                  >
                    Send
                  </button>
                </form>
              </div>
            )}

            {error && <div className="error-text">{error}</div>}
          </div>

          {/* ---------- Properties sidebar ---------- */}
          <div className="modal-side">
            <div className="side-field">
              <label>Stage</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {!stages.some((s) => s.id === status) && <option value={status}>{status}</option>}
              </select>
            </div>

            <div className="side-field">
              <label>Priority</label>
              <select
                className="select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                style={{ color: PRIORITY_META[priority].color, fontWeight: 600 }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    ⚑ {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="side-field">
              <label>Due date</label>
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>

            <div className="side-field">
              <label>Color</label>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch${color === c ? " selected" : ""}`}
                    style={{ background: COLOR_HEX[c] }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                    title={c}
                  />
                ))}
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginTop: 8,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  textTransform: "none",
                  letterSpacing: 0,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={cardStyle === "filled"}
                  onChange={(e) => setCardStyle(e.target.checked ? "filled" : "strip")}
                  style={{ accentColor: "var(--primary)" }}
                />
                Fill card background with the color
              </label>
            </div>

            <div className="side-field">
              <label>
                Assignees{" "}
                {requiresOwner && <span style={{ color: "var(--danger)" }}>*</span>}
              </label>
              {requiresOwner && ownerMissing && (
                <div className="error-text" style={{ marginBottom: 6 }}>
                  An owner is required — select at least one assignee.
                </div>
              )}
              {usersError ? (
                <div className="hint">
                  Users unavailable — make sure Spark Tasks is installed on this
                  subaccount (or install it at the agency level to cover all).
                </div>
              ) : sortedUsers.length === 0 ? (
                <div className="hint">Loading…</div>
              ) : (
                <div className="member-list" style={{ maxHeight: 132 }}>
                  {sortedUsers.map((u) => (
                    <label key={u.id} className="member-row" style={{ padding: "6px 10px" }}>
                      <input
                        type="checkbox"
                        checked={assignees.has(u.id)}
                        onChange={(e) => {
                          const next = new Set(assignees);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          setAssignees(next);
                        }}
                      />
                      <span className="avatar" style={{ background: avatarColor(u.id), marginLeft: 0 }}>
                        {initials(u.name)}
                      </span>
                      <span style={{ fontSize: 13 }}>{u.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="side-field">
              <label>Labels</label>
              {labels.length > 0 && (
                <div className="label-row" style={{ marginBottom: 6 }}>
                  {labels.map((l) => (
                    <span key={l} className="label-chip">
                      {l}
                      <span
                        className="rm"
                        role="button"
                        aria-label={`Remove ${l}`}
                        onClick={() => setLabels(labels.filter((x) => x !== l))}
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addLabel();
                }}
              >
                <input
                  className="input"
                  placeholder="+ label and press Enter"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  maxLength={30}
                />
              </form>
            </div>

            <div className="side-field">
              <label>Link Contact</label>
              {contact ? (
                <div className="linked-contact-compact">
                  {linkedContact.data?.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="contact-photo"
                      src={linkedContact.data.photoUrl}
                      alt=""
                    />
                  ) : (
                    <span
                      className="contact-photo initials"
                      style={{ background: avatarColor(contact.id) }}
                    >
                      {initials(
                        contact.name === "…"
                          ? (linkedContact.data?.name ?? "C")
                          : contact.name,
                      )}
                    </span>
                  )}
                  <span className="lc-name">
                    {contact.name === "…"
                      ? (linkedContact.data?.name ?? "Contact")
                      : contact.name}
                  </span>
                  <button
                    type="button"
                    className="lc-icon lc-chat"
                    title="Open conversation"
                    aria-label="Open conversation"
                    onClick={async () => {
                      const w = window.open("", "_blank", "noopener");
                      try {
                        const { url } = await utils.ghl.conversationUrl.fetch({
                          contactId: contact.id,
                        });
                        if (w) w.location.href = url;
                      } catch {
                        if (w) w.close();
                      }
                    }}
                  >
                    💬
                  </button>
                  {locationId && (
                    <a
                      className="lc-icon"
                      title="Open contact in GHL"
                      href={`https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contact.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ↗
                    </a>
                  )}
                  <button
                    type="button"
                    className="lc-icon"
                    title="Unlink contact"
                    aria-label="Unlink contact"
                    onClick={() => setContact(null)}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="input"
                    placeholder="Search contact…"
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                  />
                  {search.isError && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      Search unavailable.
                    </div>
                  )}
                  {search.data && search.data.length > 0 && (
                    <div className="contact-results">
                      {search.data.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="contact-row"
                          onClick={() => {
                            setContact({ id: c.id, name: c.name });
                            setContactQuery("");
                          }}
                        >
                          <div style={{ fontSize: 13 }}>{c.name}</div>
                          {(c.email || c.phone) && <div className="sub">{c.email ?? c.phone}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  {search.data && search.data.length === 0 && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      No contacts found.
                    </div>
                  )}
                </>
              )}
            </div>

            {editing && (
              <div className="side-actions">
                <button className="btn btn-secondary" disabled={saving} onClick={() => void runAction("duplicate")}>
                  ⧉ Duplicate task
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => void runAction(editing.archivedAt ? "restore" : "archive")}
                >
                  {editing.archivedAt ? "↩ Restore" : "🗃 Archive"}
                </button>
                <button className="btn btn-danger-ghost" disabled={saving} onClick={() => void runAction("delete")}>
                  🗑 Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {editing && (
          <div className="modal-created">
            <span
              className="avatar"
              style={{
                background: editing.source === "ghl" ? "#155eef" : avatarColor(editing.createdBy),
                marginLeft: 0,
              }}
            >
              {editing.source === "ghl"
                ? "⚡"
                : initials(users.find((u) => u.id === editing.createdBy)?.name ?? "?")}
            </span>
            <span>
              {editing.source === "ghl" ? (
                <>
                  {editing.recurring && "🔁 Recurring · "}
                  Synced from <b>Spark</b>
                </>
              ) : (
                <>
                  Created by{" "}
                  <b>{users.find((u) => u.id === editing.createdBy)?.name ?? "Unknown user"}</b>
                </>
              )}
              {" · "}
              {editing.createdAt.toLocaleString("en-US", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}

        <div className="modal-footer" style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !title.trim() || ownerMissing}
            title={ownerMissing ? "Select an owner (assignee) first" : undefined}
          >
            {saving ? "Saving…" : state.mode === "create" ? "Create task" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
