"use client";

/**
 * The board shell: pipeline (board) tabs, kanban/list view toggle, quick
 * filters (search, assignee, "minhas tarefas", due date, archived), sorting,
 * multi-select with bulk actions, drag-and-drop and the task modal.
 * Data auto-syncs across users via polling + refetch-on-focus.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { api } from "~/trpc/react";
import type { TaskColor, TaskStatus } from "~/server/db/schema";
import {
  STATUSES,
  PRIORITY_META,
  avatarColor,
  initials,
  mergeColumnMeta,
} from "./palette";
import { Column } from "./Column";
import { ListView } from "./ListView";
import { BulkBar } from "./BulkBar";
import { TaskModal, type ModalState } from "./TaskModal";
import type { Task } from "./TaskCard";

type ViewMode = "kanban" | "list";
type DueFilter = "all" | "overdue" | "today" | "week";
type SortMode = "manual" | "priority" | "due";

export function Board() {
  const utils = api.useUtils();
  const whoami = api.system.whoami.useQuery(undefined, { staleTime: Infinity });
  const boardsQ = api.board.list.useQuery(undefined, { staleTime: 60_000 });
  const [boardId, setBoardId] = useState<string | null>(null);
  const activeBoardId = boardId ?? boardsQ.data?.[0]?.id ?? null;

  const [showArchived, setShowArchived] = useState(false);
  const taskList = api.task.list.useQuery(
    {
      boardId: activeBoardId ?? undefined,
      includeArchived: showArchived,
    },
    {
      enabled: !!activeBoardId,
      // Multi-user sync: poll + refetch when the iframe regains focus.
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
    },
  );
  const users = api.ghl.users.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const [view, setView] = useState<ViewMode>("kanban");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [myTasks, setMyTasks] = useState(false);
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sort, setSort] = useState<SortMode>("manual");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const usersById = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.name])),
    [users.data],
  );

  // Keyboard shortcuts: N = nova tarefa, / = buscar (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || modal) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setModal({ mode: "create", status: "todo" });
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  const move = api.task.move.useMutation({
    onMutate: async (vars) => {
      await utils.task.list.cancel();
      const key = {
        boardId: activeBoardId ?? undefined,
        includeArchived: showArchived,
      };
      const prev = utils.task.list.getData(key);
      utils.task.list.setData(key, (old) => {
        if (!old) return old;
        const moved = old.find((t) => t.id === vars.id);
        if (!moved) return old;
        const rest = old.filter((t) => t.id !== vars.id);
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
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.task.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => utils.task.list.invalidate(),
  });

  const quickCreate = api.task.create.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });

  const boardMutationOpts = {
    onSettled: () => utils.board.list.invalidate(),
  };
  const createBoard = api.board.create.useMutation({
    ...boardMutationOpts,
    onSuccess: (b) => {
      setBoardId(b.id);
      void utils.board.list.invalidate();
    },
  });
  const renameBoard = api.board.rename.useMutation(boardMutationOpts);
  const updateColumns = api.board.updateColumns.useMutation(boardMutationOpts);
  const deleteBoard = api.board.delete.useMutation({
    onSuccess: () => {
      setBoardId(null);
      void utils.board.list.invalidate();
      void utils.task.list.invalidate();
    },
  });

  const myUserId = whoami.data?.userId;

  const filtered = useMemo(() => {
    let list = taskList.data ?? [];
    if (assigneeFilter) {
      list = list.filter((t) => t.assigneeIds.includes(assigneeFilter));
    }
    if (myTasks && myUserId) {
      list = list.filter((t) => t.assigneeIds.includes(myUserId));
    }
    if (dueFilter !== "all") {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endToday = new Date(startToday.getTime() + 86_400_000);
      const endWeek = new Date(startToday.getTime() + 7 * 86_400_000);
      list = list.filter((t) => {
        if (!t.dueDate) return false;
        if (dueFilter === "overdue") {
          return t.dueDate.getTime() < now.getTime() && t.status !== "done";
        }
        if (dueFilter === "today") {
          return t.dueDate >= startToday && t.dueDate < endToday;
        }
        return t.dueDate >= startToday && t.dueDate < endWeek;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.note ?? "").toLowerCase().includes(q) ||
          t.labels.some((l) => l.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [taskList.data, assigneeFilter, myTasks, myUserId, dueFilter, search]);

  const sortTasks = useMemo(() => {
    return (list: Task[]) => {
      const copy = [...list];
      if (sort === "priority") {
        copy.sort(
          (a, b) =>
            PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
            a.position - b.position,
        );
      } else if (sort === "due") {
        copy.sort((a, b) => {
          const da = a.dueDate?.getTime() ?? Infinity;
          const db = b.dueDate?.getTime() ?? Infinity;
          return da - db || a.position - b.position;
        });
      } else {
        copy.sort((a, b) => a.position - b.position);
      }
      return copy;
    };
  }, [sort]);

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(STATUSES.map((s) => [s, []]));
    for (const t of filtered) map.get(t.status)?.push(t);
    for (const s of STATUSES) map.set(s, sortTasks(map.get(s)!));
    return map;
  }, [filtered, sortTasks]);

  const listRows = useMemo(() => {
    const statusRank = new Map(STATUSES.map((s, i) => [s, i]));
    return sortTasks(filtered).sort(
      (a, b) =>
        (statusRank.get(a.status) ?? 0) - (statusRank.get(b.status) ?? 0),
    );
  }, [filtered, sortTasks]);

  function onDragEnd(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination || sort !== "manual") return;
    move.mutate({
      id: draggableId,
      status: destination.droppableId as TaskStatus,
      index: destination.index,
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const visible = view === "list" ? listRows : filtered;
      const all = visible.every((t) => prev.has(t.id)) && visible.length > 0;
      return all ? new Set() : new Set(visible.map((t) => t.id));
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

  const activeBoard = boardsQ.data?.find((b) => b.id === activeBoardId);
  const statusMeta = mergeColumnMeta(activeBoard?.columnConfig);

  return (
    <div className={`shell${selected.size ? " selection-active" : ""}`}>
      {/* Pipelines */}
      <nav className="tabs-bar" aria-label="Pipelines">
        {(boardsQ.data ?? []).map((b) => (
          <button
            key={b.id}
            className={`tab${b.id === activeBoardId ? " on" : ""}`}
            onClick={() => {
              setBoardId(b.id);
              setSelected(new Set());
            }}
            onDoubleClick={() => {
              const name = window.prompt("Renomear pipeline:", b.name);
              if (name?.trim()) renameBoard.mutate({ id: b.id, name: name.trim() });
            }}
            title="Duplo clique para renomear"
          >
            {b.name}
          </button>
        ))}
        <button
          className="tab tab-add"
          onClick={() => {
            const name = window.prompt(
              "Nome do novo pipeline (ex.: Comercial, Suporte, Onboarding):",
            );
            if (name?.trim()) createBoard.mutate({ name: name.trim() });
          }}
        >
          + Novo pipeline
        </button>
        {activeBoard && (boardsQ.data?.length ?? 0) > 1 && (
          <button
            className="tab"
            style={{ marginLeft: "auto", color: "var(--danger-text)" }}
            onClick={() => {
              if (
                window.confirm(
                  `Excluir o pipeline "${activeBoard.name}" e TODAS as suas tarefas?`,
                )
              ) {
                deleteBoard.mutate({ id: activeBoard.id });
              }
            }}
          >
            Excluir pipeline
          </button>
        )}
      </nav>

      {/* Filters / actions */}
      <header className="topbar">
        <div className="topbar-title">
          <h1>{activeBoard?.name ?? "Tarefas"}</h1>
          <span className="count">{filtered.length}</span>
        </div>

        <input
          ref={searchRef}
          className="input"
          placeholder="Buscar…  ( / )"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 170 }}
        />

        <button
          className={`chip-toggle${myTasks ? " on" : ""}`}
          onClick={() => setMyTasks((v) => !v)}
          title="Somente tarefas atribuídas a você"
        >
          {myUserId && (
            <span
              className="avatar"
              style={{ background: avatarColor(myUserId), marginLeft: 0 }}
            >
              {initials(usersById.get(myUserId) ?? "Eu")}
            </span>
          )}
          Minhas
        </button>

        <select
          className="select"
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as DueFilter)}
          title="Filtro de vencimento"
        >
          <option value="all">Vencimento: todos</option>
          <option value="overdue">⚠ Atrasadas</option>
          <option value="today">Hoje</option>
          <option value="week">Próximos 7 dias</option>
        </select>

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

        <select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          title="Ordenação das colunas"
        >
          <option value="manual">Ordem manual</option>
          <option value="priority">Por prioridade</option>
          <option value="due">Por vencimento</option>
        </select>

        <button
          className={`chip-toggle${showArchived ? " on" : ""}`}
          onClick={() => setShowArchived((v) => !v)}
          title="Mostrar tarefas arquivadas"
        >
          🗃 Arquivadas
        </button>

        <button
          className={`chip-toggle${view === "list" ? " on" : ""}`}
          onClick={() => setView((v) => (v === "kanban" ? "list" : "kanban"))}
          title="Alternar Kanban / Lista"
        >
          {view === "kanban" ? "☰ Lista" : "▦ Kanban"}
        </button>

        <button
          className="btn btn-primary"
          onClick={() => setModal({ mode: "create", status: "todo" })}
          title="Atalho: N"
        >
          + Nova tarefa
        </button>
      </header>

      {taskList.isLoading || !activeBoardId ? (
        <div className="board">
          {STATUSES.map((s) => (
            <div
              key={s}
              className="column"
              style={{ padding: 10, gap: 8, display: "flex", flexDirection: "column" }}
            >
              <div className="skeleton" style={{ height: 20, width: "60%" }} />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ))}
        </div>
      ) : view === "kanban" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="board">
            {STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                meta={statusMeta[status]}
                tasks={byStatus.get(status) ?? []}
                usersById={usersById}
                onCardClick={(task) => setModal({ mode: "edit", task })}
                adding={quickCreate.isPending}
                dragDisabled={sort !== "manual"}
                selected={selected}
                onToggleSelect={toggleSelect}
                onSaveMeta={(s, label, color) => {
                  if (!activeBoardId) return;
                  updateColumns.mutate({
                    id: activeBoardId,
                    columns: { [s]: { label, ...(color ? { color } : {}) } },
                  });
                }}
                onQuickAdd={(title, s) =>
                  quickCreate.mutate({
                    title,
                    status: s,
                    boardId: activeBoardId,
                  })
                }
              />
            ))}
          </div>
        </DragDropContext>
      ) : (
        <ListView
          tasks={listRows}
          usersById={usersById}
          statusMeta={statusMeta}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onRowClick={(task) => setModal({ mode: "edit", task })}
        />
      )}

      {selected.size > 0 && (
        <BulkBar
          selected={selected}
          users={users.data ?? []}
          onClear={() => setSelected(new Set())}
        />
      )}

      {modal && (
        <TaskModal
          state={modal}
          users={users.data ?? []}
          usersError={users.isError}
          locationId={whoami.data?.locationId}
          currentUserId={myUserId}
          boardId={activeBoardId ?? undefined}
          statusMeta={statusMeta}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
