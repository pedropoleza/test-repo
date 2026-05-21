/**
 * cursor.js — custom trailing cursor with a small state machine.
 *
 * Zero dependencies. Fine-pointer only (auto no-op on touch). Never hides the
 * keyboard focus ring (we only hide the native cursor visually).
 *
 * HTML: add the cursor node once:
 *   <div class="cursor" aria-hidden="true"><span class="cursor__label"></span></div>
 *
 * Mark interactive targets:
 *   <a href data-cursor="hover">…</a>
 *   <button data-cursor="view" data-cursor-label="View">…</button>
 *   <div data-cursor="drag" data-cursor-label="Drag">…</div>
 *
 * CSS: see motion.css for a starter .cursor block, or:
 *   * { cursor: none; }                      // optional, desktop only
 *   .cursor { position:fixed; top:0; left:0; z-index:9999; pointer-events:none;
 *     width:12px; height:12px; border-radius:50%; background:var(--accent,#fff);
 *     transform:translate(-50%,-50%); mix-blend-mode:difference;
 *     transition:width .3s, height .3s, background .3s, opacity .3s; }
 *   .cursor.is-hover { width:56px; height:56px; }
 *   .cursor.is-label { width:84px; height:84px; background:#fff; color:#000; }
 *   .cursor__label { font-size:12px; opacity:0; transition:opacity .2s; }
 *   .cursor.is-label .cursor__label { opacity:1; }
 *
 *   const c = initCursor(); c.destroy();
 */
export function initCursor(opts = {}) {
  const { ease = 0.18, root = document } = opts;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const cursor = root.querySelector(".cursor");
  if (!finePointer || !cursor) return { destroy() {} };

  const label = cursor.querySelector(".cursor__label");
  let tx = innerWidth / 2, ty = innerHeight / 2, cx = tx, cy = ty, raf = 0;

  const onMove = (e) => { tx = e.clientX; ty = e.clientY; cursor.style.opacity = "1"; };
  const onLeaveWindow = () => (cursor.style.opacity = "0");

  const lerp = (a, b, f) => a + (b - a) * f;
  function loop() {
    cx = lerp(cx, tx, ease);
    cy = lerp(cy, ty, ease);
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    raf = requestAnimationFrame(loop);
  }

  // Delegated state changes for any [data-cursor] target.
  const onOver = (e) => {
    const t = e.target.closest?.("[data-cursor]");
    if (!t) return;
    const state = t.dataset.cursor;            // hover | view | drag | label
    cursor.classList.add("is-hover");
    if (state === "view" || state === "drag" || state === "label") {
      cursor.classList.add("is-label");
      if (label) label.textContent = t.dataset.cursorLabel ?? state;
    }
  };
  const onOut = (e) => {
    if (!e.target.closest?.("[data-cursor]")) return;
    cursor.classList.remove("is-hover", "is-label");
    if (label) label.textContent = "";
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  document.addEventListener("mouseleave", onLeaveWindow);
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("mouseleave", onLeaveWindow);
    },
  };
}

/**
 * magnetic(el, strength) — element leans toward the pointer, springs back.
 * Returns a cleanup fn. Pair with a larger hit area (padding/::before).
 */
export function magnetic(el, strength = 0.4) {
  if (!matchMedia("(pointer: fine)").matches) return () => {};
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};

  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * strength;
    const y = (e.clientY - (r.top + r.height / 2)) * strength;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  const onLeave = () => {
    el.style.transition = "transform .4s cubic-bezier(.34,1.56,.64,1)";
    el.style.transform = "translate(0,0)";
    setTimeout(() => (el.style.transition = ""), 400);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    el.style.transform = "";
  };
}
