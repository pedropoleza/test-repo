/* =============================================================
   Spark Admin — FX engine
   Animation utilities: count-up, ripple, toast, confetti,
   tab-switch background pulse, progress bar, stagger reveal.
   ============================================================= */

const prefersReduced =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 1. Number count-up ---------- */
export function countUp(el, target, { duration = 900, prefix = "", suffix = "" } = {}) {
  if (!el) return;
  target = Number(target) || 0;
  if (prefersReduced) {
    el.textContent = `${prefix}${target.toLocaleString("en-US")}${suffix}`;
    return;
  }
  const start = performance.now();
  const from = 0;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const val = Math.round(from + (target - from) * eased);
    el.textContent = `${prefix}${val.toLocaleString("en-US")}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------- 2. Material ripple on click ---------- */
export function attachRipple(el) {
  if (!el || el.__rippleBound) return;
  el.__rippleBound = true;
  el.style.position = el.style.position || "relative";
  el.style.overflow = "hidden";
  el.addEventListener("click", (e) => {
    if (prefersReduced) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    ripple.className = "fx-ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  });
}
export function attachRippleAll(selector) {
  document.querySelectorAll(selector).forEach(attachRipple);
}

/* ---------- 3. Background pulse on tab switch ---------- */
export function backgroundPulse(originEl) {
  if (prefersReduced) return;
  let x = window.innerWidth / 2;
  let y = window.innerHeight - 60;
  if (originEl) {
    const r = originEl.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  spawnBgPulse(x, y);
  triggerHalftone(x, y, "halftone--pulse");
}

/* Spawna o ripple radial de fundo a partir de (x,y) */
function spawnBgPulse(x, y, strong = true) {
  const pulse = document.createElement("div");
  pulse.className = strong ? "fx-bg-pulse" : "fx-bg-pulse fx-bg-pulse--soft";
  pulse.style.left = `${x}px`;
  pulse.style.top = `${y}px`;
  document.body.appendChild(pulse);
  setTimeout(() => pulse.remove(), 900);
}

/* Dispara reação do halftone com origem no ponto (x,y) */
function triggerHalftone(x, y, cls) {
  const halftone = document.querySelector(".halftone");
  if (!halftone) return;
  const ox = (x / window.innerWidth) * 100;
  const oy = (y / window.innerHeight) * 100;
  halftone.style.transformOrigin = `${ox}% ${oy}%`;
  halftone.classList.remove("halftone--wave", "halftone--pulse");
  void halftone.offsetWidth; // reflow restart
  halftone.classList.add(cls);
  // limpa a classe ao terminar pra não bloquear próximas
  setTimeout(() => halftone.classList.remove(cls), 1000);
}

/* ---------- 3b. Halftone reage a QUALQUER clique ---------- */
let lastReact = 0;
export function setupHalftoneClickReaction() {
  if (prefersReduced) return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const now = Date.now();
      if (now - lastReact < 120) return; // throttle
      lastReact = now;
      // Cliques na nav já disparam o pulse forte (tab switch) — evita dobrar
      if (e.target.closest(".bottom-nav")) return;
      spawnBgPulse(e.clientX, e.clientY, false);
      triggerHalftone(e.clientX, e.clientY, "halftone--wave");
    },
    { passive: true },
  );
}

/* ---------- 4. Toast notifications ---------- */
let toastWrap = null;
export function toast(msg, { type = "info", duration = 3600, title = null } = {}) {
  if (!toastWrap) {
    toastWrap = document.createElement("div");
    toastWrap.className = "fx-toasts";
    document.body.appendChild(toastWrap);
  }
  const t = document.createElement("div");
  t.className = `fx-toast fx-toast--${type}`;
  t.innerHTML = `
    <div class="fx-toast__icon">${toastIcon(type)}</div>
    <div class="fx-toast__body">
      ${title ? `<div class="fx-toast__title">${escapeHtml(title)}</div>` : ""}
      <div class="fx-toast__msg">${escapeHtml(msg)}</div>
    </div>`;
  toastWrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  setTimeout(() => {
    t.classList.remove("is-in");
    setTimeout(() => t.remove(), 400);
  }, duration);
}
function toastIcon(type) {
  const icons = {
    success: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/><circle cx="12" cy="12" r="10"/></svg>',
  };
  return icons[type] || icons.info;
}

/* ---------- 5. Top loading progress bar ---------- */
let progressBar = null;
let activeRequests = 0;
function ensureProgressBar() {
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.className = "fx-progress";
    document.body.appendChild(progressBar);
  }
}
export function progressStart() {
  ensureProgressBar();
  activeRequests++;
  progressBar.classList.add("is-active");
  progressBar.style.transform = "scaleX(0.3)";
  requestAnimationFrame(() => {
    progressBar.style.transform = "scaleX(0.7)";
  });
}
export function progressDone() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0 && progressBar) {
    progressBar.style.transform = "scaleX(1)";
    setTimeout(() => {
      progressBar.classList.remove("is-active");
      progressBar.style.transform = "scaleX(0)";
    }, 250);
  }
}

/* ---------- 6. Confetti burst ---------- */
export function confetti({ count = 80 } = {}) {
  if (prefersReduced) return;
  const colors = ["#155EEF", "#1d4ed8", "#22c55e", "#fbbf24", "#f97316", "#7c3aed"];
  const wrap = document.createElement("div");
  wrap.className = "fx-confetti";
  document.body.appendChild(wrap);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const c = colors[Math.floor(Math.random() * colors.length)];
    p.style.background = c;
    p.style.left = `${50 + (Math.random() - 0.5) * 30}%`;
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 600}px`);
    p.style.setProperty("--dy", `${-200 - Math.random() * 400}px`);
    p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    p.style.setProperty("--delay", `${Math.random() * 0.15}s`);
    p.style.width = p.style.height = `${6 + Math.random() * 6}px`;
    if (Math.random() > 0.5) p.style.borderRadius = "50%";
    wrap.appendChild(p);
  }
  setTimeout(() => wrap.remove(), 2200);
}

/* ---------- 7. Stagger reveal ---------- */
export function staggerReveal(container, selector = ":scope > *", baseDelay = 60) {
  if (!container) return;
  const items = container.querySelectorAll(selector);
  items.forEach((el, i) => {
    if (prefersReduced) { el.style.opacity = "1"; return; }
    el.style.opacity = "0";
    el.style.transform = "translateY(12px)";
    el.style.transition = "opacity 420ms cubic-bezier(.4,0,.2,1), transform 420ms cubic-bezier(.4,0,.2,1)";
    setTimeout(() => {
      el.style.opacity = "1";
      el.style.transform = "none";
    }, i * baseDelay + 40);
  });
}

/* ---------- 8. Sliding nav indicator ---------- */
export function moveNavIndicator(navEl, activeBtn) {
  if (!navEl || !activeBtn) return;
  let indicator = navEl.querySelector(".fx-nav-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "fx-nav-indicator";
    navEl.appendChild(indicator);
  }
  const navRect = navEl.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  indicator.style.width = `${btnRect.width}px`;
  indicator.style.height = `${btnRect.height}px`;
  indicator.style.transform = `translateX(${btnRect.left - navRect.left - 6}px)`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
