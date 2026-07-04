"use client";

import { useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import type { TaskStatus } from "~/server/db/schema";
import { STATUS_META } from "./palette";
import { TaskCard, type Task } from "./TaskCard";

/** Cap initial render per column; long columns paginate (§6 perf). */
const PAGE = 50;

export function Column({
  status,
  tasks,
  usersById,
  onCardClick,
  onQuickAdd,
  adding,
}: {
  status: TaskStatus;
  tasks: Task[];
  usersById: Map<string, string>;
  onCardClick: (task: Task) => void;
  onQuickAdd: (title: string, status: TaskStatus) => void;
  adding: boolean;
}) {
  const meta = STATUS_META[status];
  const [visible, setVisible] = useState(PAGE);
  const [draft, setDraft] = useState<string | null>(null);

  const shown = tasks.slice(0, visible);

  function submitDraft() {
    const title = draft?.trim();
    if (title) onQuickAdd(title, status);
    setDraft(null);
  }

  return (
    <section className="column" aria-label={meta.label}>
      <header className="column-header">
        <span className="dot" style={{ background: meta.dot }} />
        <span className="name">{meta.label}</span>
        <span className="count">{tasks.length}</span>
      </header>

      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`column-body${snapshot.isDraggingOver ? " drag-over" : ""}`}
          >
            {shown.length === 0 && !snapshot.isDraggingOver && (
              <div className="empty-column">Sem tarefas</div>
            )}
            {shown.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                  >
                    <TaskCard
                      task={task}
                      usersById={usersById}
                      dragging={dragSnapshot.isDragging}
                      onClick={() => onCardClick(task)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {tasks.length > visible && (
              <button
                className="btn btn-ghost"
                onClick={() => setVisible((v) => v + PAGE)}
              >
                Mostrar mais ({tasks.length - visible})
              </button>
            )}
          </div>
        )}
      </Droppable>

      <footer className="column-footer">
        {draft === null ? (
          <button
            className="btn btn-ghost"
            style={{ width: "100%" }}
            onClick={() => setDraft("")}
            disabled={adding}
          >
            + Nova tarefa
          </button>
        ) : (
          <form
            className="quickadd-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitDraft();
            }}
          >
            <input
              className="input"
              autoFocus
              placeholder="Título da tarefa…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => (draft.trim() ? submitDraft() : setDraft(null))}
              onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
              maxLength={500}
            />
          </form>
        )}
      </footer>
    </section>
  );
}
