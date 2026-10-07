"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { IconSettings } from "./Icons";

/**
 * Location settings popover:
 *  - Sync GoHighLevel tasks into this board.
 *  - Show tasks as to-dos on the GHL calendar.
 *  - Per-user default pipeline (auto-created tasks for a user land there).
 */
export function SettingsMenu() {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const settings = api.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const users = api.ghl.users.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
    enabled: open,
  });
  const boardsQ = api.board.list.useQuery(undefined, {
    staleTime: 60_000,
    enabled: open,
  });
  const routing = api.settings.userRouting.list.useQuery(undefined, {
    enabled: open,
  });

  const setSync = api.settings.setGhlSync.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate();
      void utils.task.list.invalidate();
    },
  });
  const setCalendar = api.settings.setCalendarSync.useMutation({
    onSuccess: () => void utils.settings.get.invalidate(),
  });
  void setCalendar; // calendar sync UI ships once GHL calendar writes land
  const setRoute = api.settings.userRouting.set.useMutation({
    onSuccess: () => void utils.settings.userRouting.list.invalidate(),
  });
  const removeRoute = api.settings.userRouting.remove.useMutation({
    onSuccess: () => void utils.settings.userRouting.list.invalidate(),
  });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const ghlOn = settings.data?.ghlSyncEnabled ?? true;

  const userName = useMemo(() => {
    const m = new Map((users.data ?? []).map((u) => [u.id, u.name]));
    return (id: string) => m.get(id) ?? id;
  }, [users.data]);
  const boardName = useMemo(() => {
    const m = new Map((boardsQ.data ?? []).map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [boardsQ.data]);

  const [newUser, setNewUser] = useState("");
  const [newBoard, setNewBoard] = useState("");

  function addRoute() {
    if (!newUser || !newBoard) return;
    setRoute.mutate(
      { userId: newUser, boardId: newBoard },
      {
        onSuccess: () => {
          setNewUser("");
          setNewBoard("");
        },
      },
    );
  }

  return (
    <div className="settings-wrap" ref={ref}>
      <button
        className="notif-bell"
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-label="Settings"
      >
        <IconSettings size={18} />
      </button>

      {open && (
        <div className="settings-menu">
          <div className="settings-title">Settings</div>

          <div className="settings-row">
            <div className="settings-text">
              <div className="settings-label">Sync GoHighLevel tasks</div>
              <div className="settings-desc">
                Pull tasks created in GoHighLevel into this board. When off,
                only tasks created here are shown.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={ghlOn}
              className={`switch${ghlOn ? " on" : ""}`}
              disabled={setSync.isPending || settings.isLoading}
              onClick={() => setSync.mutate({ enabled: !ghlOn })}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="settings-section">
            <div className="settings-label">Pipeline por usuário</div>
            <div className="settings-desc">
              Tarefas criadas automaticamente (respostas de fluxo, tarefas do
              GHL) para esse usuário vão para a pipeline escolhida.
            </div>

            <div className="route-list">
              {(routing.data ?? []).length === 0 && (
                <div className="route-empty">Nenhum mapeamento ainda.</div>
              )}
              {(routing.data ?? []).map((r) => (
                <div className="route-item" key={r.userId}>
                  <span className="route-user">{userName(r.userId)}</span>
                  <span className="route-arrow">→</span>
                  <span className="route-board">{boardName(r.boardId)}</span>
                  <button
                    type="button"
                    className="route-x"
                    title="Remover"
                    disabled={removeRoute.isPending}
                    onClick={() => removeRoute.mutate({ userId: r.userId })}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="route-add">
              <select
                className="select"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
              >
                <option value="">
                  {users.isError ? "Usuários indisponíveis" : "Usuário…"}
                </option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={newBoard}
                onChange={(e) => setNewBoard(e.target.value)}
              >
                <option value="">Pipeline…</option>
                {(boardsQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="route-add-btn"
                disabled={!newUser || !newBoard || setRoute.isPending}
                onClick={addRoute}
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
