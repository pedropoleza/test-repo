"use client";

/**
 * Create/edit modal: title, note, color (fixed palette), status, due date,
 * assignees (Stage 3) and optional GHL contact link (Stage 4, D1 — a task
 * with no contact is fully valid).
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import type { TaskColor, TaskStatus } from "~/server/db/schema";
import { COLORS, COLOR_HEX, STATUSES, STATUS_META, avatarColor, initials } from "./palette";
import type { Task } from "./TaskCard";

type GhlUser = { id: string; name: string; email?: string };

export type ModalState =
  | { mode: "create"; status: TaskStatus }
  | { mode: "edit"; task: Task };

export function TaskModal({
  state,
  users,
  usersError,
  locationId,
  onClose,
}: {
  state: ModalState;
  users: GhlUser[];
  usersError: boolean;
  locationId: string | undefined;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const editing = state.mode === "edit" ? state.task : null;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [color, setColor] = useState<TaskColor>(
    editing?.color ?? STATUS_META[state.mode === "create" ? state.status : "todo"].defaultColor,
  );
  const [status, setStatus] = useState<TaskStatus>(
    editing?.status ?? (state.mode === "create" ? state.status : "todo"),
  );
  const [due, setDue] = useState(
    editing?.dueDate ? toDateInput(editing.dueDate) : "",
  );
  const [assignees, setAssignees] = useState<Set<string>>(
    new Set(editing?.assigneeIds ?? []),
  );
  const [contact, setContact] = useState<{ id: string; name: string } | null>(
    editing?.contactId ? { id: editing.contactId, name: "…" } : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the linked contact's display name when editing.
  const linkedContact = api.ghl.contactGet.useQuery(
    { contactId: editing?.contactId ?? "" },
    { enabled: !!editing?.contactId, staleTime: 10 * 60_000, retry: 1 },
  );
  useEffect(() => {
    if (linkedContact.data && contact && contact.name === "…") {
      setContact({ id: linkedContact.data.id, name: linkedContact.data.name });
    }
  }, [linkedContact.data, contact]);

  // Contact search (debounced).
  const [contactQuery, setContactQuery] = useState("");
  const debouncedQuery = useDebounced(contactQuery, 300);
  const search = api.ghl.contactsSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2, staleTime: 60_000, retry: 1 },
  );

  const create = api.task.create.useMutation();
  const update = api.task.update.useMutation();
  const move = api.task.move.useMutation();
  const assign = api.task.assign.useMutation();

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    const dueDate = due ? new Date(`${due}T12:00:00`) : null;
    try {
      if (state.mode === "create") {
        const created = await create.mutateAsync({
          title: title.trim(),
          note: note.trim() || null,
          status,
          color,
          dueDate,
          contactId: contact?.id ?? null,
        });
        if (assignees.size) {
          await assign.mutateAsync({ id: created.id, add: [...assignees] });
        }
      } else {
        const t = state.task;
        await update.mutateAsync({
          id: t.id,
          title: title.trim(),
          note: note.trim() || null,
          color,
          dueDate,
          contactId: contact?.id ?? null,
        });
        if (status !== t.status) {
          await move.mutateAsync({ id: t.id, status });
        }
        const add = [...assignees].filter((u) => !t.assigneeIds.includes(u));
        const remove = t.assigneeIds.filter((u) => !assignees.has(u));
        if (add.length || remove.length) {
          await assign.mutateAsync({ id: t.id, add, remove });
        }
      }
      await utils.task.list.invalidate();
      onClose();
    } catch {
      setError("Não foi possível salvar. Tente novamente.");
      setSaving(false);
    }
  }

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{state.mode === "create" ? "Nova tarefa" : "Editar tarefa"}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Título</label>
            <input
              className="input"
              autoFocus={state.mode === "create"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O que precisa ser feito?"
              maxLength={500}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label>Status</label>
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Vencimento</label>
              <input
                className="input"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Cor</label>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${color === c ? " selected" : ""}`}
                  style={{ background: COLOR_HEX[c] }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label>Anotação</label>
            <textarea
              className="textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Detalhes, contexto, próximos passos…"
              maxLength={10_000}
            />
          </div>

          <div className="field">
            <label>Responsáveis</label>
            {usersError ? (
              <div className="hint">
                Não foi possível carregar os usuários da location. Verifique a
                instalação do app GHL.
              </div>
            ) : sortedUsers.length === 0 ? (
              <div className="hint">Carregando usuários…</div>
            ) : (
              <div className="member-list">
                {sortedUsers.map((u) => (
                  <label key={u.id} className="member-row">
                    <input
                      type="checkbox"
                      checked={assignees.has(u.id)}
                      onChange={(e) => {
                        const next = new Set(assignees);
                        if (e.target.checked) next.add(u.id);
                        else next.delete(u.id);
                        setAssignees(next);
                      }}
                    />
                    <span
                      className="avatar"
                      style={{ background: avatarColor(u.id), marginLeft: 0 }}
                    >
                      {initials(u.name)}
                    </span>
                    <span>{u.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>Contato GHL (opcional)</label>
            {contact ? (
              <div className="linked-contact">
                <span className="name">
                  👤 {contact.name === "…" ? (linkedContact.data?.name ?? "Contato") : contact.name}
                </span>
                {locationId && (
                  <a
                    href={`https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contact.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir no GHL ↗
                  </a>
                )}
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setContact(null)}
                  title="Desvincular contato"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Buscar contato por nome, e-mail ou telefone…"
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  style={{ width: "100%" }}
                />
                {search.isError && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    Busca indisponível — verifique a conexão com o GHL.
                  </div>
                )}
                {search.data && search.data.length > 0 && (
                  <div className="contact-results">
                    {search.data.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="contact-row"
                        onClick={() => {
                          setContact({ id: c.id, name: c.name });
                          setContactQuery("");
                        }}
                      >
                        <div>{c.name}</div>
                        {(c.email || c.phone) && (
                          <div className="sub">{c.email ?? c.phone}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {search.data && search.data.length === 0 && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    Nenhum contato encontrado.
                  </div>
                )}
              </>
            )}
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !title.trim()}
          >
            {saving ? "Salvando…" : state.mode === "create" ? "Criar tarefa" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
