"use client";

/**
 * In-app notification bell. Unread count polls every 20s; opening the panel
 * lists recent notifications and marks the shown ones as read.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { avatarColor, initials } from "./palette";

export function Notifications({
  usersById,
  onOpenTask,
}: {
  usersById: Map<string, string>;
  onOpenTask: (taskId: string) => void;
}) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
  const list = api.notifications.list.useQuery(undefined, { enabled: open });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void unread.refetch();
      void list.refetch();
    },
  });
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => void unread.refetch(),
  });

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const count = unread.data ?? 0;

  return (
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
              <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => markAll.mutate()}>
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
  );
}
