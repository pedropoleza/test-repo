# CRM-wide Notifier (GHL Custom JS) — install & ops

Shows Spark Tasks pop-ups + chime on **every CRM page** (outside the module
iframe), no extension. Served from `public/crm-notify.js`.

## Install (GHL Agency → Settings → Company → White Label → Custom JavaScript)

⚠️ This field accepts **raw JavaScript only** — pasting an HTML `<script>` tag
breaks the whole field (including existing presets). Append this self-contained
block AFTER any existing code, without touching it:

```js
/* ===== Spark Tasks – CRM Notify ===== */
(function () {
  if (document.querySelector('script[src="https://spark-tasks-sigma.vercel.app/crm-notify.js"]')) return;
  var s = document.createElement("script");
  s.src = "https://spark-tasks-sigma.vercel.app/crm-notify.js";
  s.defer = true;
  // Optional — limit to specific subaccounts (comma-separated location ids):
  // s.setAttribute("data-locations", "locId1,locId2");
  document.head.appendChild(s);
})();
/* ===== END ===== */
```

For fields that accept **HTML** (e.g. funnel/site footer tracking code), use
the plain tag instead:

```html
<script src="https://spark-tasks-sigma.vercel.app/crm-notify.js" defer></script>
```

## How it works

- Agency-level Custom JS applies to **all subaccounts** (GHL has no native
  per-subaccount custom JS); the `data-locations` attribute scopes it in-script
  by matching the location id in the CRM URL.
- Auth: the SSO handshake sets a signed, httpOnly, 30-day `st_notify` cookie
  path-pinned to `/api/crm-notify` (read-only feed — cannot act as a session).
  Each user must open the Spark Tasks module once to mint it; it renews on
  every open.
- The script polls the feed every 25s (`?since=` cursor), dedupes via
  localStorage, renders branded pop-ups (title, text, ✕) and plays a WebAudio
  chime (after the first user interaction on the page, per autoplay rules).
  Backs off after repeated 401s.
- CORS on the feed reflects only trusted origins (`*.gohighlevel.com`,
  `*.leadconnectorhq.com`, `*.msgsndr.com`, `*.sparkleads.pro`) with
  credentials.

## Tenant-isolation guarantees (audited)

Reminders can only ever reach users of their own location. Enforcement is
layered — no single point of failure:

1. **Identity is server-minted.** `{locationId, userId}` come exclusively from
   the GHL SSO payload decrypted with the agency secret; they are HMAC-signed
   into the httpOnly `st_notify` cookie. The script cannot read or forge it.
2. **Feed query is double-scoped.** RLS (FORCED, non-superuser role) pins the
   transaction to the cookie's location; the query additionally filters
   `user_id = cookie.userId`. A tampered cookie fails signature verification →
   401.
3. **Viewing-location match (hard guard).** The script reports the location id
   of the CRM page being viewed (`?loc=`); the server returns an EMPTY feed
   unless it equals the cookie's location. Browsing any other subaccount —
   related or not — renders nothing. Agency-level pages (no location in the
   URL) are silent by design.
4. **Notification rows themselves are tenant-scoped.** They are only created
   by assignment events inside a location (RLS-scoped writes), keyed to a
   recipient user id of that location.
5. **CORS with credentials only for trusted CRM origins** (GHL + white-label
   allowlist, extensible via `EXTRA_FRAME_ANCESTORS`). Arbitrary websites
   cannot read the feed even with the cookie present.
6. **No-cookie = no-op.** In subaccounts whose users never opened Spark Tasks,
   the script gets 401s and stands down after a few attempts. It renders
   nothing and calls nothing else.

## Distribution (every agency that installs the app)

Agency-level Custom JS is per-agency: each agency that installs Spark Tasks
pastes the loader block once in THEIR Settings → Company → Custom JavaScript
(make it part of the app's install/onboarding instructions). Their white-label
domain must be added to the CORS allowlist via the `EXTRA_FRAME_ANCESTORS`
env var (also used for iframe embedding — one list, two protections).
In-app pop-ups and desktop Web Push work automatically for every install with
no extra setup.

## Troubleshooting

- **No pop-ups anywhere**: user hasn't opened the module since the notifier
  shipped (no `st_notify` cookie yet) → open Spark Tasks once.
- **No sound**: WebAudio unlocks after the first click/keypress on the page.
- **401 loops in console**: cookie expired (30d) → open the module again.
- **Third-party cookie settings**: the feed call is cross-site
  (CRM → our origin) with credentials, same dependency as the module's own
  session cookie — if the module works embedded, the notifier works too.
