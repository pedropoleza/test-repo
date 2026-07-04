"use client";

/**
 * In-app notification bell + live toast pop-ups.
 *
 * The identity comes from the SSO session, so each user sees only their own
 * notifications. The list polls every 20s (and on focus); when a NEW unread
 * notification appears after mount, a toast pops up. Opening the panel lists
 * recent notifications and lets the user mark them read.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { avatarColor, initials } from "./palette";

type Toast = { id: string; title: string; body: string | null; actorId: string | null };

export function Notifications({
  usersById,
  onOpenTask,
}: {
  usersById: Map<string, string>;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const taskByNotif = useRef<Map<string, string | null>>(new Map());

  const unread = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  // Poll the list always (not just when the panel is open) so we can detect
  // and toast newly-arrived notifications.
  const list = api.notifications.list.useQuery(undefined, {
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void unread.refetch();
      void list.refetch();
    },
  });
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => void unread.refetch(),
  });

  // Detect new unread notifications and raise toasts.
  useEffect(() => {
    const data = list.data;
    if (!data) return;
    for (const n of data) taskByNotif.current.set(n.id, n.taskId);

    if (!initialized.current) {
      // First load: remember what's already there without toasting.
      for (const n of data) seen.current.add(n.id);
      initialized.current = true;
      return;
    }
    const fresh = data.filter((n) => !seen.current.has(n.id));
    for (const n of data) seen.current.add(n.id);
    const freshUnread = fresh.filter((n) => !n.readAt);
    if (freshUnread.length) {
      setToasts((prev) =>
        [
          ...freshUnread.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            actorId: n.actorId,
          })),
          ...prev,
        ].slice(0, 4),
      );
    }
  }, [list.data]);

  // Auto-dismiss toasts after a few seconds.
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) =>
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6500),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  // Close panel on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const count = unread.data ?? 0;

  function openTask(notifId: string) {
    const taskId = taskByNotif.current.get(notifId);
    if (taskId) onOpenTask(taskId);
  }

  return (
    <>
      <div className="notif" ref={ref}>
        <button
          className="notif-bell"
          onClick={() => setOpen((v) => !v)}
          title="Notifications"
          aria-label="Notifications"
        >
          🔔
          {count > 0 && <span className="notif-badge">{count > 9 ? "9+" : count}</span>}
        </button>

        {open && (
          <div className="notif-panel">
            <div className="notif-head">
              <span>Notifications</span>
              {count > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={() => markAll.mutate()}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="notif-list">
              {list.isLoading && <div className="notif-empty">Loading…</div>}
              {list.data && list.data.length === 0 && (
                <div className="notif-empty">No notifications yet</div>
              )}
              {list.data?.map((n) => {
                const who = n.actorId ? usersById.get(n.actorId) ?? "Someone" : "System";
                return (
                  <button
                    key={n.id}
                    className={`notif-item${n.readAt ? "" : " unread"}`}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ id: n.id });
                      if (n.taskId) {
                        onOpenTask(n.taskId);
                        setOpen(false);
                      }
                    }}
                  >
                    {n.actorId ? (
                      <span
                        className="avatar"
                        style={{ background: avatarColor(n.actorId), marginLeft: 0 }}
                      >
                        {initials(who)}
                      </span>
                    ) : (
                      <span className="avatar" style={{ background: "#667085", marginLeft: 0 }}>
                        ✓
                      </span>
                    )}
                    <div className="notif-body">
                      <div className="notif-title">{n.title}</div>
                      {n.body && <div className="notif-sub">{n.body}</div>}
                      <div className="notif-when">
                        {n.createdAt.toLocaleString("en-US", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    {!n.readAt && <span className="notif-dot" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Live toasts for newly-arrived notifications */}
      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.map((t) => {
            const who = t.actorId ? usersById.get(t.actorId) ?? "Someone" : "System";
            return (
              <button
                key={t.id}
                className="toast"
                onClick={() => {
                  openTask(t.id);
                  if (!markRead.isPending) markRead.mutate({ id: t.id });
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                <span
                  className="avatar"
                  style={{ background: avatarColor(t.actorId ?? "sys"), marginLeft: 0 }}
                >
                  {t.actorId ? initials(who) : "✓"}
                </span>
                <div className="toast-body">
                  <div className="toast-title">🔔 {t.title}</div>
                  {t.body && <div className="toast-sub">{t.body}</div>}
                </div>
                <span
                  className="toast-close"
                  role="button"
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  }}
                >
                  ✕
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
