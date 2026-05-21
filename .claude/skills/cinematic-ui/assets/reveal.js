/**
 * reveal.js — scroll reveals (IntersectionObserver) + lightweight split-text.
 *
 * Zero dependencies. Reduced-motion aware (reveals show instantly, no transform).
 *
 * --- Scroll reveals ---
 * HTML:  <div data-reveal>…</div>
 *        <ul><li data-reveal data-reveal-group>…</li>…</ul>  <!-- auto-stagger -->
 * CSS:   see motion.css (.is-in toggles the animation).
 *
 *   const r = initReveal(); r.destroy();
 *
 * --- Split text ---
 *   splitText(el, "word");   // wraps each word in clip-masked spans + sets --i
 *   splitText(el, "char");   // per character
 *   // then add `data-reveal` to the element (or toggle .is-in yourself).
 */
export function initReveal(opts = {}) {
  const { threshold = 0.15, rootMargin = "0px 0px -10% 0px", once = true } = opts;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = [...document.querySelectorAll("[data-reveal]")];

  // Assign stagger index within each group (or globally if ungrouped).
  const groups = new Map();
  targets.forEach((el) => {
    const key = el.dataset.revealGroup ?? el.parentElement ?? "global";
    const arr = groups.get(key) ?? [];
    el.style.setProperty("--i", arr.length);
    arr.push(el);
    groups.set(key, arr);
  });

  if (reduce) {
    targets.forEach((el) => el.classList.add("is-in"));
    return { destroy() {} };
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        if (once) io.unobserve(e.target);
      } else if (!once) {
        e.target.classList.remove("is-in");
      }
    });
  }, { threshold, rootMargin });

  targets.forEach((el) => io.observe(el));
  return { destroy() { io.disconnect(); } };
}

/**
 * splitText(el, mode) — wrap words/chars in clip-masked spans for kinetic
 * reveals. Sets --i per piece for staggering. Preserves spaces.
 *   mode: "word" (default) | "char"
 */
export function splitText(el, mode = "word") {
  const text = el.textContent;
  el.setAttribute("aria-label", text);   // keep it readable to AT
  el.textContent = "";

  const pieces = mode === "char" ? [...text] : text.split(/(\s+)/);
  let i = 0;
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) { el.appendChild(document.createTextNode(piece)); continue; }
    const mask = document.createElement("span");
    mask.className = "split-mask";
    mask.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.className = "split-inner";
    inner.style.setProperty("--i", i++);
    inner.textContent = piece;
    mask.appendChild(inner);
    el.appendChild(mask);
  }
  return el;
}
