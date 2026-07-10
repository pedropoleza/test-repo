# Feature Plan — GHL Native Task Sync

Bring tasks created in GoHighLevel's **native task tool** into a Spark Tasks
pipeline, mapping title, description, due date and assignee. Grounded in the
GHL API v2 (verified July 2026).

## 0. What GHL exposes (verified)

**Webhook events** (real-time): `TaskCreate`, `TaskComplete`, `TaskDelete`.
Payload fields:

| GHL field   | Meaning                | Maps to (Spark Tasks)         |
|-------------|------------------------|-------------------------------|
| `id`        | GHL task id            | `tasks.external_id`           |
| `locationId`| subaccount             | session/tenant scope          |
| `title`     | task title             | `tasks.title`                 |
| `body`      | description            | `tasks.note`                  |
| `dueDate`   | when to do it          | `tasks.due_date`              |
| `assignedTo`| GHL user id (single)   | `task_assignees` (one row)    |
| `contactId` | linked contact         | `tasks.contact_id`            |
| `dateAdded` | created at             | display / `created_at` origin |
| `type`      | event name             | routing                       |

**REST** (tasks are CONTACT-scoped): `GET/POST /contacts/{contactId}/tasks`,
`GET/PUT/DELETE /contacts/{contactId}/tasks/{taskId}`, "Update Task Completed".
There is **no location-wide list**, so:
- **Ongoing sync → webhooks** (scalable, real-time).
- **Backfill of existing tasks → iterate contacts** (heavier; optional).

## 1. Locked design decisions (to confirm — see §7)

- **D1 Direction:** V1 is **one-way GHL → Spark Tasks** (mirror in). Two-way
  (our completion → complete the GHL task) is a fast follow, behind a loop
  guard.
- **D2 Landing:** imported tasks go to a **dedicated auto-created pipeline
  "GHL Tasks"** per location (keeps native + manual work separable), stage by
  status: open → first stage, `TaskComplete` → the pipeline's done stage.
- **D3 Backfill:** V1 syncs **new/changed tasks going forward** via webhook;
  a **manual "Import existing" backfill** (per linked contact, then optionally
  all contacts) is Stage 4.

## 2. Non-negotiable rules

1. **Tenant isolation stays absolute.** The webhook resolves `locationId` from
   the verified payload and writes only under that location (RLS backstop as
   everywhere else). No cross-tenant writes.
2. **Verify webhook authenticity.** Validate the GHL webhook signature
   (`x-wh-signature`) against GHL's webhook public key before acting. Reject
   unsigned/invalid payloads. Never trust a raw POST.
3. **Idempotent upserts.** Keyed by `(location_id, external_id)`. Re-delivery,
   retries and out-of-order events must converge, never duplicate.
4. **No loops.** When two-way lands (Stage 5), tag app-originated writes so the
   webhook echo they cause is ignored.
5. **Least privilege.** Only the scopes needed (see §3). Flag missing scopes;
   don't stub around them.

## 3. Required GHL scopes / config (👤 team)

- Subscribe the marketplace app to the **Task webhook events**
  (`TaskCreate`, `TaskComplete`, `TaskDelete`) with the app **Webhook URL** =
  `https://spark-tasks-sigma.vercel.app/api/webhooks/ghl` (already set).
- Confirm the **tasks scope** for read (and write for Stage 5). GHL exposes
  granular scopes — confirm the exact names in the app (likely
  `contacts.readonly` covers task reads via the contact object; task write may
  need `contacts.write`). **Do not assume — verify on the app.**
- Obtain GHL's **webhook signing public key** for signature verification.

## 4. Data model (migration 0006)

```
tasks.source       text NOT NULL DEFAULT 'native'   -- 'native' | 'ghl'
tasks.external_id  text                              -- GHL task id (null for native)
-- partial unique index so one GHL task maps to exactly one card per location:
CREATE UNIQUE INDEX tasks_ext_unique
  ON spark_tasks.tasks (location_id, external_id)
  WHERE external_id IS NOT NULL;
```

A small per-location settings row (or reuse a board flag) records the target
"GHL Tasks" board id so we don't re-resolve it each webhook.

## 5. tRPC / server surface

- **Ingestion** (REST, not tRPC): extend `POST /api/webhooks/ghl`:
  1. verify signature; 2. branch on `type`; 3. scope a tx to `locationId`
  (`SET LOCAL role` + `app.location_id`); 4. resolve/lazily-create the "GHL
  Tasks" board; 5. **upsert** the card by `(location_id, external_id)` mapping
  the fields; 6. `assignedTo` → single `task_assignees` row (+ reuse the
  assignment notification); 7. `TaskComplete` → move card to the done stage and
  fire the existing D7 contact write-back path only if a contact is linked;
  8. `TaskDelete` → archive (soft) the mirror.
- **Backfill (Stage 4):** `ghl.importContactTasks(contactId)` and an
  admin-triggered `ghl.importAllTasks` (paginated contact iteration, rate-limit
  aware, `log()` what was imported/skipped).
- **Two-way (Stage 5):** on our card entering a done stage where
  `source='ghl'`, call GHL "Update Task Completed"; on edits, PUT the GHL task.
  Guarded so the resulting webhook echo is a no-op (compare updated fields /
  short-lived write marker).

## 6. UI

- Card badge **"GHL"** (small chip) when `source='ghl'`, with an "Open in GHL"
  link to the contact/task. Read-only affordances stay editable (we can still
  reassign/schedule locally); Stage 5 pushes those edits back.
- The "GHL Tasks" pipeline appears as a normal tab; users can drag/manage it
  like any other.

## 7. Execution stages & gates

- **Stage 0 (👤):** subscribe app to Task webhooks; confirm scopes; provide the
  webhook signing key. **Gate:** a real GHL TaskCreate reaches `/api/webhooks/ghl`.
- **Stage 1 (🤖):** migration 0006 (source, external_id, unique index) + target
  board resolution. **Gate:** migration applied; RLS still green.
- **Stage 2 (🤖):** signed webhook ingestion for Create/Complete/Delete with
  idempotent upsert. **Gate:** creating a native GHL task mirrors a card;
  completing it moves the card; deleting archives it — verified via logs/SQL.
- **Stage 3 (🤖):** assignee mapping + notifications; card "GHL" badge + deep
  link. **Gate:** assignee shows; assigned user gets the in-app notification.
- **Stage 4 (🤝, optional):** backfill existing tasks (per contact, then all).
- **Stage 5 (🤝, optional):** two-way write-back with loop guard.

## 8. Risks / open questions

- **No location-wide task list** → backfill cost is O(contacts); may need
  batching + a progress UI. Confirm appetite before Stage 4.
- **Assignee identity:** `assignedTo` is a GHL user id — same id space as our
  `ghl.users`, so it maps cleanly to `task_assignees` and avatars.
- **Duplicate suppression across events:** rely on the partial unique index +
  upsert; never key on title.
- **Rate limits** on backfill/two-way — honor GHL limits, retry with backoff
  (reuse the write-back job's retry shape).
