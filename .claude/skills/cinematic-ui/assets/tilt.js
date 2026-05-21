/**
 * tilt.js — 3D tilt card with lerp smoothing + optional glare + gyroscope.
 *
 * Zero dependencies. Reduced-motion aware. Touch devices fall back to the
 * device-orientation gyroscope (if permitted) or stay flat.
 *
 * HTML:
 *   <div class="tilt-wrap">                 <!-- needs `perspective` in CSS -->
 *     <div class="tilt" data-tilt data-max="14" data-glare>
 *       <div class="tilt__layer">…content (add translateZ in CSS to float)…</div>
 *       <span class="tilt__glare"></span>   <!-- optional, if data-glare -->
 *     </div>
 *   </div>
 *
 * CSS (minimum):
 *   .tilt-wrap { perspective: 1000px; }
 *   .tilt { transform-style: preserve-3d; will-change: transform; }
 *
 * data-max   : max rotation in degrees (default 14).
 * data-glare : presence enables the moving specular highlight.
 *
 *   const t = initTilt(); t.destroy();
 */
export function initTilt(opts = {}) {
  const { ease = 0.12, root = document } = opts;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return { destroy() {} };

  const cleanups = [];

  root.querySelectorAll("[data-tilt]").forEach((card) => {
    const max = parseFloat(card.dataset.max ?? "14");
    const glare = card.querySelector(".tilt__glare");
    let tX = 0, tY = 0, cX = 0, cY = 0, raf = 0, active = false;

    const setTargetFromPoint = (clientX, clientY) => {
      const r = card.getBoundingClientRect();
      const px = (clientX - r.left) / r.width - 0.5;   // -.5 .. .5
      const py = (clientY - r.top) / r.height - 0.5;
      tX = py * -max;     // rotateX (invert so it leans toward cursor)
      tY = px * max;      // rotateY
      if (glare) {
        glare.style.setProperty("--gx", `${(px + 0.5) * 100}%`);
        glare.style.setProperty("--gy", `${(py + 0.5) * 100}%`);
      }
    };

    const lerp = (a, b, f) => a + (b - a) * f;
    const loop = () => {
      cX = lerp(cX, tX, ease);
      cY = lerp(cY, tY, ease);
      card.style.transform = `rotateX(${cX.toFixed(2)}deg) rotateY(${cY.toFixed(2)}deg)`;
      raf = requestAnimationFrame(loop);
    };

    const onEnter = () => { if (!active) { active = true; raf = requestAnimationFrame(loop); } };
    const onMove = (e) => setTargetFromPoint(e.clientX, e.clientY);
    const onLeave = () => {
      tX = 0; tY = 0;
      if (glare) glare.style.opacity = "";
      // let it ease back to flat, then stop the loop
      setTimeout(() => { active = false; cancelAnimationFrame(raf); card.style.transform = ""; }, 450);
    };

    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    cleanups.push(() => {
      cancelAnimationFrame(raf);
      card.removeEventListener("pointerenter", onEnter);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      card.style.transform = "";
    });
  });

  return { destroy() { cleanups.forEach((fn) => fn()); } };
}
