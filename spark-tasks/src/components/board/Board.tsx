"use client";

/**
 * The Kanban board (plan §6): fixed status columns, drag-and-drop with
 * optimistic updates, assignee filter (a toggle, NOT a visibility boundary —
 * D6), text search, quick-add per column and the task modal.
 */
import { useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { api } from "~/trpc/react";
import type { TaskStatus } from "~/server/db/schema";
import { STATUSES, avatarColor, initials } from "./palette";
import { Column } from "./Column";
import { TaskModal, type ModalState } from "./TaskModal";
import type { Task } from "./TaskCard";

export function Board() {
  const utils = api.useUtils();
  const whoami = api.system.whoami.useQuery(undefined, { staleTime: Infinity });
  const board = api.board.get.useQuery();
  const taskList = api.task.list.useQuery({});
  const users = api.ghl.users.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);

  const usersById = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.name])),
    [users.data],
  );

  const move = api.task.move.useMutation({
    onMutate: async (vars) => {
      await utils.task.list.cancel();
      const prev = utils.task.list.getData({});
      utils.task.list.setData({}, (old) => {
        if (!old) return old;
        const moved = old.find((t) => t.id === vars.id);
        if (!moved) return old;
        const rest = old.filter((t) => t.id !== vars.id);
        // Rebuild the target column order with fractional positions so the
        // optimistic render matches what the server will persist.
        const target = rest
          .filter((t) => t.status === vars.status)
          .sort((a, b) => a.position - b.position);
        const idx = Math.min(vars.index ?? target.length, target.length);
        const before = target[idx - 1]?.position ?? -1;
        const after = target[idx]?.position ?? before + 2;
        return [
          ...rest,
          { ...moved, status: vars.status, position: (before + after) / 2 },
        ];
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.task.list.setData({}, ctx.prev);
    },
    onSettled: () => utils.task.list.invalidate(),
  });

  const quickCreate = api.task.create.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });

  const filtered = useMemo(() => {
    let list = taskList.data ?? [];
    if (assigneeFilter) {
      list = list.filter((t) => t.assigneeIds.includes(assigneeFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.note ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [taskList.data, assigneeFilter, search]);

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(STATUSES.map((s) => [s, []]));
    for (const t of filtered) map.get(t.status)?.push(t);
    for (const s of STATUSES) {
      map.get(s)!.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [filtered]);

  function onDragEnd(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination) return;
    move.mutate({
      id: draggableId,
      status: destination.droppableId as TaskStatus,
      index: destination.index,
    });
  }

  if (taskList.isError) {
    return (
      <div className="centered">
        Sessão expirada ou indisponível. Recarregue a página dentro do
        GoHighLevel.
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-title">
          <h1>{board.data?.name ?? "Tarefas"}</h1>
          <span className="count">{taskList.data?.length ?? 0}</span>
        </div>

        <input
          className="input"
          placeholder="Buscar tarefas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />

        <select
          className="select"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          title="Filtrar por responsável"
        >
          <option value="">Todos os responsáveis</option>
          {(users.data ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
        {assigneeFilter && (
          <span
            className="avatar"
            style={{ background: avatarColor(assigneeFilter) }}
            title={usersById.get(assigneeFilter)}
          >
            {initials(usersById.get(assigneeFilter) ?? "?")}
          </span>
        )}

        <button
          className="btn btn-primary"
          onClick={() => setModal({ mode: "create", status: "todo" })}
        >
          + Nova tarefa
        </button>
      </header>

      {taskList.isLoading ? (
        <div className="board">
          {STATUSES.map((s) => (
            <div key={s} className="column" style={{ padding: 10, gap: 8, display: "flex", flexDirection: "column" }}>
              <div className="skeleton" style={{ height: 20, width: "60%" }} />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ))}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="board">
            {STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={byStatus.get(status) ?? []}
                usersById={usersById}
                onCardClick={(task) => setModal({ mode: "edit", task })}
                adding={quickCreate.isPending}
                onQuickAdd={(title, s) =>
                  quickCreate.mutate({ title, status: s })
                }
              />
            ))}
          </div>
        </DragDropContext>
      )}

      {modal && (
        <TaskModal
          state={modal}
          users={users.data ?? []}
          usersError={users.isError}
          locationId={whoami.data?.locationId}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
