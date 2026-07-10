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

## Troubleshooting

- **No pop-ups anywhere**: user hasn't opened the module since the notifier
  shipped (no `st_notify` cookie yet) → open Spark Tasks once.
- **No sound**: WebAudio unlocks after the first click/keypress on the page.
- **401 loops in console**: cookie expired (30d) → open the module again.
- **Third-party cookie settings**: the feed call is cross-site
  (CRM → our origin) with credentials, same dependency as the module's own
  session cookie — if the module works embedded, the notifier works too.
