/**
 * parallax.js — pointer + scroll parallax via ONE rAF lerp loop.
 *
 * Zero dependencies. Framework-agnostic. Reduced-motion aware.
 *
 * Usage (HTML):
 *   <div data-parallax data-depth="0.2"  data-axis="xy"></div>  <!-- far/slow -->
 *   <div data-parallax data-depth="1.4"  data-axis="xy"></div>  <!-- near/fast -->
 *   <div data-parallax data-depth="0.6"  data-scroll="0.3"></div> <!-- + scroll drift -->
 *
 * data-depth  : pointer reaction multiplier (0 = static, ~1.5 = strong).
 * data-axis   : "xy" (default), "x", or "y" — constrain pointer movement.
 * data-scroll : scroll drift factor (px per px scrolled). Optional.
 *
 * IMPORTANT: this sets the CSS `translate` property (NOT `transform`), so your
 * elements can ALSO run CSS keyframe animations on `transform` without conflict.
 *
 *   const p = initParallax();        // start
 *   p.destroy();                     // stop + cleanup (SPA route change)
 */
export function initParallax(opts = {}) {
  const {
    ease = 0.08,          // lerp factor: lower = heavier/laggier/floatier
    maxShift = 40,        // px cap for pointer-driven shift at depth 1
    root = document,
  } = opts;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const els = [...root.querySelectorAll("[data-parallax]")].map((el) => ({
    el,
    depth: parseFloat(el.dataset.depth ?? "0.5"),
    axis: el.dataset.axis ?? "xy",
    scroll: parseFloat(el.dataset.scroll ?? "0"),
  }));

  if (reduce || !els.length) return { destroy() {} };

  let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0;

  const onMove = (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;   // -1 .. 1
    ty = (e.clientY / innerHeight - 0.5) * 2;
  };
  const onScroll = () => { sy = window.scrollY; };

  const lerp = (a, b, f) => a + (b - a) * f;

  function frame() {
    cx = lerp(cx, tx, ease);
    cy = lerp(cy, ty, ease);
    for (const { el, depth, axis, scroll } of els) {
      const x = axis === "y" ? 0 : cx * depth * maxShift;
      const yPointer = axis === "x" ? 0 : cy * depth * maxShift;
      const y = yPointer + (scroll ? sy * scroll : 0);
      el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  if (els.some((e) => e.scroll)) {
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      els.forEach(({ el }) => (el.style.translate = ""));
    },
  };
}
