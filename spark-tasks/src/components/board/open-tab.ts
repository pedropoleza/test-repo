/**
 * Open a new browser tab for a URL that is resolved asynchronously.
 *
 * The app runs inside a GHL iframe, so links to the CRM (the white-label
 * domain, e.g. app.sparkleads.pro) must NOT open in the iframe — the CRM sends
 * X-Frame-Options / frame-ancestors and the load is refused (the "error" users
 * saw when clicking a contact). A new top-level tab (_blank) avoids that.
 *
 * Two gotchas this handles:
 *  - `window.open(url, "_blank", "noopener")` returns `null` per spec, so the
 *    reference was unusable and the blank tab never navigated. We omit
 *    `noopener` to keep the handle, then sever `opener` manually for security.
 *  - The URL needs an async fetch, but popup blockers require window.open to
 *    run inside the user gesture. So we open a blank tab synchronously first,
 *    then point it at the resolved URL once the promise settles.
 */
export async function openResolvedTab(resolve: () => Promise<string>) {
  const w = window.open("about:blank", "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      // cross-origin / blocked — ignore
    }
  }
  try {
    const url = await resolve();
    if (w) w.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    if (w) w.close();
  }
}
