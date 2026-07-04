"use client";

import { useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import type { TaskColor, TaskStatus } from "~/server/db/schema";
import { COLORS, COLOR_HEX, type StatusDisplay } from "./palette";
import { TaskCard, type Task } from "./TaskCard";

/** Cap initial render per column; long columns paginate (§6 perf). */
const PAGE = 50;

export function Column({
  status,
  meta,
  tasks,
  usersById,
  onCardClick,
  onQuickAdd,
  onSaveMeta,
  adding,
  dragDisabled,
  selected,
  onToggleSelect,
}: {
  status: TaskStatus;
  /** Display (label + dot color) after the board's column overrides. */
  meta: StatusDisplay;
  tasks: Task[];
  usersById: Map<string, string>;
  onCardClick: (task: Task) => void;
  onQuickAdd: (title: string, status: TaskStatus) => void;
  onSaveMeta: (status: TaskStatus, label: string, color: TaskColor | null) => void;
  adding: boolean;
  /** True when a non-manual sort is active — order is computed, not dragged. */
  dragDisabled: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [visible, setVisible] = useState(PAGE);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(meta.label);
  const [editColor, setEditColor] = useState<TaskColor | null>(null);

  const shown = tasks.slice(0, visible);

  function submitDraft() {
    const title = draft?.trim();
    if (title) onQuickAdd(title, status);
    setDraft(null);
  }

  function saveMeta() {
    onSaveMeta(status, editLabel.trim() || meta.label, editColor);
    setEditing(false);
  }

  return (
    <section className="column" aria-label={meta.label}>
      <header className="column-header">
        <span
          className="dot"
          style={{ background: editColor ? COLOR_HEX[editColor] : meta.dot }}
        />
        <span className="name">{meta.label}</span>
        <span className="count">{tasks.length}</span>
        <button
          className="edit-btn"
          title="Renomear / cor da coluna"
          onClick={() => {
            setEditLabel(meta.label);
            setEditColor(null);
            setEditing((v) => !v);
          }}
        >
          ✎
        </button>
      </header>

      {editing && (
        <form
          className="col-editor"
          onSubmit={(e) => {
            e.preventDefault();
            saveMeta();
          }}
        >
          <input
            className="input"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            maxLength={30}
            autoFocus
            placeholder="Nome da coluna"
          />
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${editColor === c ? " selected" : ""}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setEditColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" type="submit" style={{ padding: "5px 12px", fontSize: 12.5 }}>
              Salvar
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              style={{ padding: "5px 10px", fontSize: 12.5 }}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <Droppable droppableId={status} isDropDisabled={dragDisabled}>
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
              <Draggable
                key={task.id}
                draggableId={task.id}
                index={index}
                isDragDisabled={dragDisabled}
              >
                {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    style={{ position: "relative", ...dragProvided.draggableProps.style }}
                  >
                    <input
                      type="checkbox"
                      className="card-check"
                      checked={selected.has(task.id)}
                      onChange={() => onToggleSelect(task.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Selecionar tarefa"
                    />
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
