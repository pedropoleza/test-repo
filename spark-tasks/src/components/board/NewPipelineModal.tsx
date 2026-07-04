"use client";

/**
 * Create-pipeline modal: name the pipeline and define its starting stages
 * (add / rename / recolor / mark completion / remove). Stages are the columns
 * of the new board.
 */
import { useState } from "react";
import { api } from "~/trpc/react";
import type { Stage, TaskColor } from "~/server/db/schema";
import { DEFAULT_STAGES } from "~/server/db/schema";
import { COLORS, COLOR_HEX, slugStageId } from "./palette";

export function NewPipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [stages, setStages] = useState<Stage[]>(
    DEFAULT_STAGES.map((s) => ({ ...s })),
  );
  const [newStage, setNewStage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = api.board.create.useMutation({
    onSuccess: async (b) => {
      await utils.board.list.invalidate();
      onCreated(b.id);
    },
    onError: () => setError("Could not create the pipeline. Try again."),
  });

  function addStage() {
    const nm = newStage.trim();
    if (!nm || stages.length >= 12) return;
    const id = slugStageId(nm, new Set(stages.map((s) => s.id)));
    setStages([...stages, { id, name: nm, color: "gray" }]);
    setNewStage("");
  }

  function patch(id: string, p: Partial<Stage>) {
    setStages(stages.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>New pipeline</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-main" style={{ overflowY: "auto", maxHeight: "70vh" }}>
          <div className="field">
            <label>Pipeline name</label>
            <input
              className="input"
              autoFocus
              placeholder="e.g. Sales, Support, Onboarding"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="field">
            <label>Stages</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {stages.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "6px 8px",
                  }}
                >
                  <span
                    className="dot"
                    style={{ background: COLOR_HEX[s.color], width: 10, height: 10, borderRadius: 999 }}
                  />
                  <input
                    className="input"
                    style={{ flex: 1, padding: "5px 9px" }}
                    value={s.name}
                    onChange={(e) => patch(s.id, { name: e.target.value })}
                    maxLength={30}
                  />
                  <div className="swatches">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`swatch${s.color === c ? " selected" : ""}`}
                        style={{ background: COLOR_HEX[c], width: 18, height: 18 }}
                        onClick={() => patch(s.id, { color: c as TaskColor })}
                        aria-label={c}
                      />
                    ))}
                  </div>
                  <label
                    title="Completion stage"
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!s.isDone}
                      onChange={(e) => patch(s.id, { isDone: e.target.checked })}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    ✓
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "2px 6px" }}
                    disabled={stages.length <= 1}
                    onClick={() => setStages(stages.filter((x) => x.id !== s.id))}
                    aria-label="Remove stage"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addStage();
              }}
              style={{ display: "flex", gap: 8, marginTop: 8 }}
            >
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="+ Add stage"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                maxLength={30}
              />
              <button className="btn btn-secondary" type="submit" disabled={!newStage.trim()}>
                Add
              </button>
            </form>
            <div className="hint" style={{ marginTop: 6 }}>
              The ✓ marks a completion stage — moving a linked task there writes
              back to the GHL contact.
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-footer" style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name: name.trim(), stages })}
          >
            {create.isPending ? "Creating…" : "Create pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}
