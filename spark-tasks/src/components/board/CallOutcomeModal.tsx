"use client";

/**
 * Call disposition modal. Opens when a call task is completed (dropped into a
 * Done stage). The rep records the call outcome, chooses where to move the
 * lead's opportunity (pipeline + stage, mapped live from GHL), and can generate
 * a follow-up call for the next day (pre-checked for "no answer"-type outcomes).
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { CALL_OUTCOMES } from "~/lib/call-outcomes";
import type { Task } from "./TaskCard";

export function CallOutcomeModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const pipelines = api.ghl.pipelines.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const [outcomeId, setOutcomeId] = useState<string>("answered");
  const [pipelineId, setPipelineId] = useState<string>("");
  const [stageId, setStageId] = useState<string>("");
  const [followUp, setFollowUp] = useState<boolean>(false);
  const [touchedFollowUp, setTouchedFollowUp] = useState(false);

  // Default the follow-up toggle from the chosen outcome (until user overrides).
  useEffect(() => {
    if (touchedFollowUp) return;
    const o = CALL_OUTCOMES.find((x) => x.id === outcomeId);
    setFollowUp(!!o?.retryByDefault);
  }, [outcomeId, touchedFollowUp]);

  // Default pipeline selection to the first one once loaded.
  useEffect(() => {
    if (!pipelineId && pipelines.data && pipelines.data.length > 0) {
      setPipelineId(pipelines.data[0]!.id);
    }
  }, [pipelines.data, pipelineId]);

  const stages = useMemo(
    () => pipelines.data?.find((p) => p.id === pipelineId)?.stages ?? [],
    [pipelines.data, pipelineId],
  );

  const dispose = api.task.disposeCall.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate();
      onClose();
    },
  });

  function save() {
    dispose.mutate({
      taskId: task.id,
      outcome: outcomeId,
      move: pipelineId && stageId ? { pipelineId, stageId } : undefined,
      followUp,
    });
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal call-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>Resultado da ligação</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body call-modal-body">
          <div className="call-task-title">{task.title}</div>

          {/* Outcome */}
          <div className="field">
            <label className="field-label">Como foi a ligação?</label>
            <div className="outcome-grid">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`outcome-chip${outcomeId === o.id ? " on" : ""}`}
                  onClick={() => setOutcomeId(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Move opportunity */}
          <div className="field">
            <label className="field-label">Mover oportunidade para</label>
            {pipelines.isError ? (
              <div className="hint">
                Não foi possível carregar os funis (verifique a conexão do GHL).
                O resultado é registrado mesmo assim.
              </div>
            ) : (
              <div className="move-row">
                <select
                  className="select"
                  value={pipelineId}
                  onChange={(e) => {
                    setPipelineId(e.target.value);
                    setStageId("");
                  }}
                  disabled={pipelines.isLoading}
                >
                  {pipelines.isLoading && <option>Carregando…</option>}
                  {pipelines.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  disabled={pipelines.isLoading || stages.length === 0}
                >
                  <option value="">Não mover</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Follow-up */}
          <label className="follow-row">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(e) => {
                setTouchedFollowUp(true);
                setFollowUp(e.target.checked);
              }}
            />
            <span>Gerar nova ligação para este lead (vence amanhã)</span>
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={dispose.isPending}>
            Pular
          </button>
          <button className="btn btn-primary" onClick={save} disabled={dispose.isPending}>
            {dispose.isPending ? "Salvando…" : "Salvar resultado"}
          </button>
        </div>
      </div>
    </div>
  );
}
