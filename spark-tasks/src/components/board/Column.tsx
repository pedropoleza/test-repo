"use client";

import { useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import type { Stage, TaskColor } from "~/server/db/schema";
import { COLORS, COLOR_HEX } from "./palette";
import { TaskCard, type Task } from "./TaskCard";

/** Cap initial render per column; long columns paginate (§6 perf). */
const PAGE = 50;

export type StagePatch = { name?: string; color?: TaskColor; isDone?: boolean };

export function Column({
  stage,
  tasks,
  usersById,
  onCardClick,
  onQuickAdd,
  onEditStage,
  onDeleteStage,
  canDelete,
  adding,
  dragDisabled,
  selected,
  onToggleSelect,
  currentUserId,
  openStageId,
  doneStageId,
}: {
  stage: Stage;
  tasks: Task[];
  usersById: Map<string, string>;
  onCardClick: (task: Task) => void;
  onQuickAdd: (title: string, stageId: string) => void;
  onEditStage: (stageId: string, patch: StagePatch) => void;
  onDeleteStage: (stageId: string) => void;
  canDelete: boolean;
  adding: boolean;
  /** True when a non-manual sort is active — order is computed, not dragged. */
  dragDisabled: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  currentUserId: string | undefined;
  openStageId: string;
  doneStageId: string;
}) {
  const [visible, setVisible] = useState(PAGE);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(stage.name);
  const [editColor, setEditColor] = useState<TaskColor>(stage.color);
  const [editDone, setEditDone] = useState(!!stage.isDone);

  const shown = tasks.slice(0, visible);

  function submitDraft() {
    const title = draft?.trim();
    if (title) onQuickAdd(title, stage.id);
    setDraft(null);
  }

  function saveMeta() {
    onEditStage(stage.id, {
      name: editName.trim() || stage.name,
      color: editColor,
      isDone: editDone,
    });
    setEditing(false);
  }

  return (
    <section className="column" aria-label={stage.name}>
      <header className="column-header">
        <span className="dot" style={{ background: COLOR_HEX[stage.color] }} />
        <span className="name">{stage.name}</span>
        <span className="count">{tasks.length}</span>
        <button
          className="edit-btn"
          title="Edit stage"
          onClick={() => {
            setEditName(stage.name);
            setEditColor(stage.color);
            setEditDone(!!stage.isDone);
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
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            maxLength={30}
            autoFocus
            placeholder="Stage name"
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={editDone}
              onChange={(e) => setEditDone(e.target.checked)}
              style={{ accentColor: "var(--primary)" }}
            />
            Completion stage (triggers contact write-back)
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" type="submit" style={{ padding: "5px 12px", fontSize: 12.5 }}>
              Save
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              style={{ padding: "5px 10px", fontSize: 12.5 }}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {canDelete && (
              <button
                className="btn btn-danger-ghost"
                type="button"
                style={{ padding: "5px 10px", fontSize: 12.5, marginLeft: "auto" }}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the "${stage.name}" stage? Its tasks move to the first stage.`,
                    )
                  ) {
                    onDeleteStage(stage.id);
                    setEditing(false);
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      )}

      <Droppable droppableId={stage.id} isDropDisabled={dragDisabled}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`column-body${snapshot.isDraggingOver ? " drag-over" : ""}`}
          >
            {shown.length === 0 && !snapshot.isDraggingOver && (
              <div className="empty-column">No tasks</div>
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
                      aria-label="Select task"
                    />
                    <TaskCard
                      task={task}
                      usersById={usersById}
                      isDone={!!stage.isDone}
                      dragging={dragSnapshot.isDragging}
                      onClick={() => onCardClick(task)}
                      currentUserId={currentUserId}
                      openStageId={openStageId}
                      doneStageId={doneStageId}
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
                Show more ({tasks.length - visible})
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
            + Add task
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
              placeholder="Task title…"
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
