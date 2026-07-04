"use client";

/**
 * Floating action bar shown while tasks are selected (kanban or list).
 * Applies bulk status/priority/assignee changes, archive and delete.
 */
import { api } from "~/trpc/react";
import type { TaskPriority, TaskStatus } from "~/server/db/schema";
import { PRIORITIES, PRIORITY_META, STATUSES, STATUS_META } from "./palette";

type GhlUser = { id: string; name: string };

export function BulkBar({
  selected,
  users,
  onClear,
}: {
  selected: Set<string>;
  users: GhlUser[];
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
    <div className="bulkbar" role="toolbar" aria-label="Ações em massa">
      <span className="count">{ids.length} selecionada(s)</span>

      <select
        className="select"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) {
            bulk.mutate({ ids, status: e.target.value as TaskStatus });
          }
        }}
      >
        <option value="">Mover para…</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
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
        <option value="">Prioridade…</option>
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
            if (e.target.value) {
              bulk.mutate({ ids, addAssigneeIds: [e.target.value] });
            }
          }}
        >
          <option value="">Atribuir a…</option>
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
        Arquivar
      </button>
      <button
        className="btn btn-danger"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              `Excluir definitivamente ${ids.length} tarefa(s)? Essa ação não pode ser desfeita.`,
            )
          ) {
            bulkDelete.mutate({ ids });
          }
        }}
      >
        Excluir
      </button>
      <button className="btn btn-dark" onClick={onClear} disabled={busy}>
        ✕
      </button>
    </div>
  );
}
