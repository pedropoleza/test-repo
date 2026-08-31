/** Toasts do workspace — mesma linguagem visual do Hub. */
let host = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "ws-toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

export function toast(message, { tone = "info", timeout = 4000 } = {}) {
  const el = document.createElement("div");
  el.className = `ws-toast ws-toast--${tone}`;
  el.textContent = message;
  ensureHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 220);
  }, timeout);
  return el;
}
