"use client";

/**
 * Board shell: pipeline (board) tabs, board / list view toggle, notifications,
 * quick filters (search, assignee, my tasks, due date, archived), sorting,
 * multi-select with bulk actions, drag-and-drop, custom stages and the task
 * modal. Data auto-syncs across users via polling + refetch-on-focus.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { api } from "~/trpc/react";
import type { Stage, TaskColor } from "~/server/db/schema";
import {
  PRIORITY_META,
  avatarColor,
  initials,
  doneStageIds,
  slugStageId,
} from "./palette";
import { Column, type StagePatch } from "./Column";
import { ListView } from "./ListView";
import { BulkBar } from "./BulkBar";
import { Notifications } from "./Notifications";
import { NewPipelineModal } from "./NewPipelineModal";
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
  const listKey = {
    boardId: activeBoardId ?? undefined,
    includeArchived: showArchived,
  };
  const taskList = api.task.list.useQuery(listKey, {
    enabled: !!activeBoardId,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
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
  const [newPipeline, setNewPipeline] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pan = useRef({ down: false, startX: 0, startScroll: 0 });

  const activeBoard = boardsQ.data?.find((b) => b.id === activeBoardId);
  const stages: Stage[] = activeBoard?.stages ?? [];
  const doneIds = useMemo(() => doneStageIds(stages), [stages]);

  const usersById = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.name])),
    [users.data],
  );

  // Keyboard shortcuts: N = new task, / = search (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || modal || newPipeline) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setModal({ mode: "create", status: stages[0]?.id ?? "todo" });
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, newPipeline, stages]);

  const move = api.task.move.useMutation({
    onMutate: async (vars) => {
      await utils.task.list.cancel();
      const prev = utils.task.list.getData(listKey);
      utils.task.list.setData(listKey, (old) => {
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
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.task.list.setData(listKey, ctx.prev);
    },
    onSettled: () => utils.task.list.invalidate(),
  });

  const quickCreate = api.task.create.useMutation({
    onSettled: () => utils.task.list.invalidate(),
  });

  const invalidateBoards = { onSettled: () => utils.board.list.invalidate() };
  const renameBoard = api.board.rename.useMutation(invalidateBoards);
  const setStages = api.board.setStages.useMutation({
    onSettled: () => {
      void utils.board.list.invalidate();
      void utils.task.list.invalidate();
    },
  });
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
          return t.dueDate.getTime() < now.getTime() && !doneIds.has(t.status);
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
  }, [taskList.data, assigneeFilter, myTasks, myUserId, dueFilter, search, doneIds]);

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

  const byStage = useMemo(() => {
    const map = new Map<string, Task[]>(stages.map((s) => [s.id, []]));
    for (const t of filtered) {
      // Tasks whose stage no longer exists fall into the first stage bucket.
      const bucket = map.get(t.status) ?? map.get(stages[0]?.id ?? "");
      bucket?.push(t);
    }
    for (const s of stages) map.set(s.id, sortTasks(map.get(s.id) ?? []));
    return map;
  }, [filtered, sortTasks, stages]);

  const listRows = useMemo(() => {
    const rank = new Map(stages.map((s, i) => [s.id, i]));
    return sortTasks(filtered).sort(
      (a, b) => (rank.get(a.status) ?? 0) - (rank.get(b.status) ?? 0),
    );
  }, [filtered, sortTasks, stages]);

  function onDragEnd(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination || sort !== "manual") return;
    move.mutate({
      id: draggableId,
      status: destination.droppableId,
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

  // ---- Stage editing helpers (all go through board.setStages) ----
  function editStage(stageId: string, patch: StagePatch) {
    if (!activeBoardId) return;
    const next = stages.map((s) =>
      s.id === stageId
        ? {
            ...s,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            isDone: patch.isDone ?? s.isDone,
          }
        : s,
    );
    setStages.mutate({ id: activeBoardId, stages: next });
  }
  function deleteStage(stageId: string) {
    if (!activeBoardId || stages.length <= 1) return;
    setStages.mutate({
      id: activeBoardId,
      stages: stages.filter((s) => s.id !== stageId),
    });
  }
  function addStage() {
    const name = newStageName.trim();
    if (!activeBoardId || !name) return;
    const id = slugStageId(name, new Set(stages.map((s) => s.id)));
    const color: TaskColor = "gray";
    setStages.mutate({ id: activeBoardId, stages: [...stages, { id, name, color }] });
    setNewStageName("");
    setAddingStage(false);
  }

  /**
   * Drag-to-scroll: click-hold-drag on empty board areas (background, column
   * headers, gaps) pans the columns horizontally. Cards, buttons and inputs
   * are excluded so card drag-and-drop and controls keep working.
   */
  function onBoardMouseDown(e: React.MouseEvent) {
    const el = boardRef.current;
    if (!el || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (
      t.closest(
        ".card, button, input, select, textarea, a, label, .col-editor, .add-stage-form",
      )
    ) {
      return; // let cards drag and controls work
    }
    pan.current = { down: true, startX: e.pageX, startScroll: el.scrollLeft };
    el.classList.add("grabbing");
    const onMove = (ev: MouseEvent) => {
      if (!pan.current.down) return;
      el.scrollLeft = pan.current.startScroll - (ev.pageX - pan.current.startX);
    };
    const onUp = () => {
      pan.current.down = false;
      el.classList.remove("grabbing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function openTaskById(taskId: string) {
    const t = (taskList.data ?? []).find((x) => x.id === taskId);
    if (t) setModal({ mode: "edit", task: t });
  }

  if (taskList.isError) {
    return (
      <div className="centered">
        Session expired or unavailable. Reload the page inside GoHighLevel.
      </div>
    );
  }

  return (
    <div className={`shell${selected.size ? " selection-active" : ""}`}>
      {/* Pipelines + view toggle + notifications */}
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
              const name = window.prompt("Rename pipeline:", b.name);
              if (name?.trim()) renameBoard.mutate({ id: b.id, name: name.trim() });
            }}
            title="Double-click to rename"
          >
            {b.name}
          </button>
        ))}
        <button className="tab tab-add" onClick={() => setNewPipeline(true)}>
          + New pipeline
        </button>
        {activeBoard && (boardsQ.data?.length ?? 0) > 1 && (
          <button
            className="tab"
            style={{ color: "var(--danger-text)", fontSize: 14 }}
            title={`Delete the "${activeBoard.name}" pipeline`}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the "${activeBoard.name}" pipeline and ALL its tasks?`,
                )
              ) {
                deleteBoard.mutate({ id: activeBoard.id });
              }
            }}
          >
            🗑 Delete pipeline
          </button>
        )}

        <div className="tabs-right">
          <Notifications usersById={usersById} onOpenTask={openTaskById} />
          <div className="view-toggle" role="tablist" aria-label="View">
            <button
              className={view === "kanban" ? "on" : ""}
              onClick={() => setView("kanban")}
            >
              Board
            </button>
            <button
              className={view === "list" ? "on" : ""}
              onClick={() => setView("list")}
            >
              Tasks list view
            </button>
          </div>
        </div>
      </nav>

      {/* Filters / actions */}
      <header className="topbar">
        <div className="topbar-title">
          <h1>{activeBoard?.name ?? "Tasks"}</h1>
          <span className="count">{filtered.length}</span>
        </div>

        <input
          ref={searchRef}
          className="input"
          placeholder="Search…  ( / )"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 160 }}
        />

        <button
          className={`chip-toggle${myTasks ? " on" : ""}`}
          onClick={() => setMyTasks((v) => !v)}
          title="Only tasks assigned to you"
        >
          {myUserId && (
            <span
              className="avatar"
              style={{ background: avatarColor(myUserId), marginLeft: 0 }}
            >
              {initials(usersById.get(myUserId) ?? "Me")}
            </span>
          )}
          My tasks
        </button>

        <select
          className="select"
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as DueFilter)}
          title="Due date filter"
        >
          <option value="all">Due: all</option>
          <option value="overdue">⚠ Overdue</option>
          <option value="today">Today</option>
          <option value="week">Next 7 days</option>
        </select>

        <select
          className="select"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          title="Filter by assignee"
        >
          <option value="">All assignees</option>
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
          title="Column ordering"
        >
          <option value="manual">Manual order</option>
          <option value="priority">By priority</option>
          <option value="due">By due date</option>
        </select>

        <button
          className={`chip-toggle${showArchived ? " on" : ""}`}
          onClick={() => setShowArchived((v) => !v)}
          title="Show archived tasks"
        >
          🗃 Archived
        </button>

        <button
          className="btn btn-primary"
          onClick={() => setModal({ mode: "create", status: stages[0]?.id ?? "todo" })}
          title="Shortcut: N"
        >
          + New task
        </button>
      </header>

      {taskList.isLoading || !activeBoardId ? (
        <div className="board">
          {[0, 1, 2, 3].map((s) => (
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
          <div className="board" ref={boardRef} onMouseDown={onBoardMouseDown}>
            {stages.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                tasks={byStage.get(stage.id) ?? []}
                usersById={usersById}
                onCardClick={(task) => setModal({ mode: "edit", task })}
                adding={quickCreate.isPending}
                dragDisabled={sort !== "manual"}
                canDelete={stages.length > 1}
                selected={selected}
                onToggleSelect={toggleSelect}
                onEditStage={editStage}
                onDeleteStage={deleteStage}
                onQuickAdd={(title, stageId) =>
                  quickCreate.mutate({ title, status: stageId, boardId: activeBoardId })
                }
              />
            ))}

            {/* Add stage */}
            <div className="add-stage-col">
              {addingStage ? (
                <form
                  className="add-stage-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addStage();
                  }}
                >
                  <input
                    className="input"
                    autoFocus
                    placeholder="Stage name"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setAddingStage(false)}
                    maxLength={30}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-primary" type="submit" style={{ padding: "6px 12px", fontSize: 12.5 }}>
                      Add
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ padding: "6px 10px", fontSize: 12.5 }}
                      onClick={() => setAddingStage(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="add-stage-btn"
                  onClick={() => setAddingStage(true)}
                  disabled={stages.length >= 12}
                >
                  + Add stage
                </button>
              )}
            </div>
          </div>
        </DragDropContext>
      ) : (
        <ListView
          tasks={listRows}
          usersById={usersById}
          stages={stages}
          doneIds={doneIds}
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
          stages={stages}
          onClear={() => setSelected(new Set())}
        />
      )}

      {newPipeline && (
        <NewPipelineModal
          onClose={() => setNewPipeline(false)}
          onCreated={(id) => {
            setBoardId(id);
            setNewPipeline(false);
          }}
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
          stages={stages}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
