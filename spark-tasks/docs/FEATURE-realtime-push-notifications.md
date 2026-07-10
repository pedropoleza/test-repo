# Feature Plan — Real-time Alerts: Pop-ups + Sound (even with the app closed)

Goal: when a task is assigned to a user, alert them with a **pop-up + sound** —
instantly if the module is open, and **even when the Spark Tasks module isn't
open** (another GHL page, a backgrounded tab, or the browser closed).

Written as an architect's plan, grounded in what's actually possible inside a
**cross-origin iframe embedded in GoHighLevel**.

## 0. The core constraint (read first)

Our UI runs in an `<iframe>` on our Vercel origin, embedded in GHL. That dictates
what's reachable in each state:

| User state | Our JS running? | What can alert them | Mechanism |
|---|---|---|---|
| Module **open** (looking at our board) | yes | pop-up + custom sound | in-app toast + Web Audio |
| GHL open, **our module not open** (other page / background tab) | **no** | OS notification (+ system sound) | **Service Worker + Web Push** |
| **Browser closed** | no | OS notification (+ system sound) | **Service Worker + Web Push** |

Conclusions:
- "App open" → we control everything (pop-up + any sound).
- "App not open / closed" → only **Web Push** delivered to a **Service Worker**
  can wake and show an OS notification. There is no other web mechanism.

### Hard caveats (design around these, don't pretend they don't exist)
1. **Notification permission in a cross-origin iframe is blocked by default**
   (Chrome/Firefox). `Notification.requestPermission()` and push subscription
   must happen in a **top-level context** on our origin. → We trigger opt-in via
   a small **popup window** on `spark-tasks-sigma.vercel.app` (top-level), which
   requests permission + subscribes, then closes. The Service Worker itself is
   per-origin (ours) and works fine once subscribed.
2. **Custom loud sound when the page is closed is not guaranteed.** A closed
   page can't run `Audio`. The Service Worker's `showNotification` uses the
   **OS notification sound** (a `silent:false` flag; custom audio isn't reliably
   supported cross-browser). A fully custom sound only works when our page is
   alive (open or backgrounded).
3. **iOS/Safari:** Web Push only works for **installed PWAs** (home-screen), not
   inside a third-party iframe. Desktop Chrome/Edge/Firefox: full support.
   → Push is a desktop-first enhancement; in-app alerts cover everyone.
4. Push requires the user to **opt in per browser/device** and to have opened
   the app at least once.

## 1. Two layers (ship independently)

- **Layer A — In-app real-time (module open): instant pop-up + custom sound.**
  Highest value / lowest risk. Uses Supabase Realtime instead of the 20s poll.
- **Layer B — Out-of-app Web Push (module closed): OS notification + sound.**
  Service Worker + VAPID Web Push, with the top-level opt-in flow.

## 2. Data model (migration 0008)

```
push_subscriptions
  id           uuid pk
  location_id  text not null
  user_id      text not null          -- GHL user (recipient)
  endpoint     text not null unique    -- push service endpoint
  p256dh       text not null           -- subscription keys
  auth         text not null
  user_agent   text
  created_at   timestamptz default now()
  last_seen_at timestamptz default now()
-- RLS: tenant isolation by location_id (same backstop as every table)

notification_prefs                      -- optional (Stage 4)
  location_id text, user_id text pk(location_id,user_id)
  in_app_sound boolean default true
  push_enabled boolean default true
```

Enable Supabase Realtime (logical replication) on
`spark_tasks.notifications` so Layer A can stream inserts.

## 3. Server surface

- **VAPID**: generate a key pair (env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`). Public key exposed to the client; private key signs pushes.
- tRPC `push.*`: `vapidPublicKey`, `subscribe(sub)`, `unsubscribe(endpoint)`,
  `prefs.get/set`.
- **Sender** `sendPushToUser(locationId, userId, payload)` using the `web-push`
  lib: fan out to the user's subscriptions; on `404/410` delete that dead
  subscription. Called from the SAME places we already insert a `notifications`
  row: `task.assign`, `task.create` (with assignees), `task.bulkUpdate`
  (addAssignees), and the GHL `ingestTaskEvent` assignment path.
- Runs post-response via `after()` (never blocks the mutation); a Trigger.dev
  task is a drop-in later for retries/observability once `TRIGGER_SECRET_KEY`
  exists.

## 4. Client

- **Service Worker** `public/sw.js`: `push` → `showNotification(title, {body,
  icon, tag, data:{taskId}, renotify, silent:false})`; `notificationclick` →
  focus an existing app tab or open the deep link to the task.
- **Opt-in flow**: a "🔔 Enable alerts" control. Because of the iframe
  permission block, it opens a top-level popup on our origin that: requests
  permission → registers the SW → `pushManager.subscribe({vapidPublicKey})` →
  POSTs the subscription (SSO session scopes it to location+user) → closes.
- **In-app real-time (Layer A)**: subscribe to Supabase Realtime for
  `notifications` where `user_id = me`; on insert → toast (existing) + play the
  sound. **Audio unlock:** browsers block autoplay, so on the first user gesture
  we "unlock" the `Audio` element (play+pause) and reuse it thereafter.
- **Sound asset**: bundle a short chime (`public/notify.mp3`); respect the
  in-app sound preference.

## 5. Execution stages & gates

- **Stage 0** — 🤖 generate VAPID keys (env); 🤝 enable Supabase Realtime on
  `spark_tasks.notifications`; add a notification sound asset. **Gate:** keys
  present; realtime replication on.
- **Stage 1 (Layer A)** — 🤖 Supabase Realtime subscription + toast + sound +
  audio-unlock + in-app sound pref. **Gate:** with the module open, a task
  assigned to me pops a toast and plays a sound **instantly** (no 20s wait).
- **Stage 2 (Layer B, subscribe)** — 🤖 Service Worker + top-level opt-in popup
  + `push_subscriptions` table (migration 0008). **Gate:** a user enables
  alerts; a subscription is stored; a **manual test push** shows an OS
  notification with the module closed.
- **Stage 3 (Layer B, deliver)** — 🤖 `sendPushToUser` wired to every
  assignment path (native + GHL) with dead-subscription pruning. **Gate:**
  assigning a task to a user with the browser on another page / closed shows an
  OS notification + system sound; clicking it opens the task.
- **Stage 4** — 🤝 preferences UI (sound on/off, push on/off), cross-browser
  test matrix (Chrome/Edge/Firefox desktop; note iOS limitation), docs/runbook.

## 6. Risks / decisions to confirm

- **Reach vs. effort:** Layer A (in-app instant + sound) is quick and covers the
  common case (agent has GHL open). Layer B (true out-of-app push) is the bulk
  of the work and carries the iframe/permission/iOS caveats. Recommend shipping
  **Layer A first**, then Layer B.
- **The popup opt-in** is the main UX wrinkle (iframe can't prompt directly). If
  GHL can add a `Permissions-Policy: notifications` delegation to our iframe,
  we could prompt inline — but that's outside our control, so we design for the
  popup.
- **Custom sound when fully closed** isn't guaranteed (OS sound only) — set
  expectations accordingly.
- **Do-not-spam:** coalesce bursts (e.g., bulk-assign of many tasks → one
  summary push), and honor per-user prefs / quiet behavior.
