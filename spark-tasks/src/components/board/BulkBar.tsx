"use client";

/**
 * Floating action bar shown while tasks are selected (kanban or list).
 * Applies bulk stage/priority/assignee changes, archive and delete.
 */
import { api } from "~/trpc/react";
import type { Stage, TaskPriority } from "~/server/db/schema";
import { PRIORITIES, PRIORITY_META } from "./palette";

type GhlUser = { id: string; name: string };

export function BulkBar({
  selected,
  users,
  stages,
  onClear,
}: {
  selected: Set<string>;
  users: GhlUser[];
  stages: Stage[];
  onClear: () => void;
}) {
  const utils = api.useUtils();
  const bulk = api.task.bulkUpdate.useMutation({
    onSuccess: async () => {
      await utils.task.list.invalidate();
      onClear();
    },
  });
  const bulkDelete = api.task.bulkDelete.useMutation({
    onSuccess: async () => {
      await utils.task.list.invalidate();
      onClear();
    },
  });

  const ids = [...selected];
  const busy = bulk.isPending || bulkDelete.isPending;

  return (
    <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <span className="count">{ids.length} selected</span>

      <select
        className="select"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) bulk.mutate({ ids, status: e.target.value });
        }}
      >
        <option value="">Move to…</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        className="select"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) {
            bulk.mutate({ ids, priority: e.target.value as TaskPriority });
          }
        }}
      >
        <option value="">Priority…</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_META[p].label}
          </option>
        ))}
      </select>

      {users.length > 0 && (
        <select
          className="select"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) bulk.mutate({ ids, addAssigneeIds: [e.target.value] });
          }}
        >
          <option value="">Assign to…</option>
          {users
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
      )}

      <button
        className="btn btn-dark"
        disabled={busy}
        onClick={() => bulk.mutate({ ids, archived: true })}
      >
        Archive
      </button>
      <button
        className="btn btn-danger"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              `Permanently delete ${ids.length} task(s)? This cannot be undone.`,
            )
          ) {
            bulkDelete.mutate({ ids });
          }
        }}
      >
        Delete
      </button>
      <button className="btn btn-dark" onClick={onClear} disabled={busy}>
        ✕
      </button>
    </div>
  );
}
