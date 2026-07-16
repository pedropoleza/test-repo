"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { IconSettings } from "./Icons";

/**
 * Location settings popover. Currently: toggle whether GoHighLevel native
 * tasks sync into this board. Off = internal tasks fully separated from GHL.
 */
export function SettingsMenu() {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const settings = api.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const setSync = api.settings.setGhlSync.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate();
      void utils.task.list.invalidate();
    },
  });

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const enabled = settings.data?.ghlSyncEnabled ?? true;

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
                only tasks created here are shown — GHL tasks stay fully
                separate.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              className={`switch${enabled ? " on" : ""}`}
              disabled={setSync.isPending || settings.isLoading}
              onClick={() => setSync.mutate({ enabled: !enabled })}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
