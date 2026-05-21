# 06 — Performance & accessibility: the invisible craft

Jank and motion-sickness destroy the premium illusion faster than any visual
flaw. A beautiful site that stutters at 30fps or makes people nauseous is a
failed site. Treat these as design requirements, not afterthoughts.

---

## 1. The 60fps rules (16.6ms per frame budget)

**Only animate `transform` and `opacity`.** These are composited on the GPU and
skip layout + paint. Everything else risks jank.

| Animate this ✅ | Never animate this ❌ (triggers layout/paint) |
|---|---|
| `transform` (translate/scale/rotate) | `top`/`left`/`right`/`bottom` |
| `opacity` | `width`/`height`/`margin`/`padding` |
| `translate`/`scale`/`rotate` (independent props) | `box-shadow` (paint-heavy; fake with a layered pseudo) |
| `filter` (sparingly) | `background-position` on large areas |

- **`will-change: transform`** promotes an element to its own layer — but it
  costs memory. Add it **right before** animating, **remove after**. Never leave
  it on many static elements.
- **`translate3d()` / `translateZ(0)`** forces GPU compositing (the classic hack).
- **Batch DOM reads then writes.** Reading layout (`getBoundingClientRect`,
  `offsetTop`) after a write forces sync reflow ("layout thrash"). In a rAF loop,
  read all, then write all.
- **One rAF loop** for the whole page. Don't spawn a loop per element.
- **Throttle expensive work** (resize, scroll-derived measurements) and debounce
  on resize end.
- **Cap animated element count.** 200 simultaneously transforming nodes will
  jank even with perfect properties — virtualize/limit.

---

## 2. Diagnosing jank

- DevTools **Performance** panel → record → look for long frames (red), forced
  reflows (purple "Layout" after script), and dropped frames.
- **Layers** panel → confirm animated elements are on their own composited layer.
- **Rendering** → enable "Paint flashing" (green = repaint; you want none during
  transform animation) and "Frame rendering stats" (live FPS).
- Test on a **throttled CPU (4–6×)** and a **real mid-range phone**, not just a
  fast laptop.

---

## 3. `prefers-reduced-motion` — required, done well

Don't just kill all motion (that can break functionality and feels broken).
Provide a **reduced variant**: keep meaning, drop the vestibular triggers
(large transl/scale/parallax/auto-scroll). Cross-fades and instant states are
fine.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
  /* But keep essential opacity transitions so things don't pop harshly: */
  [data-reveal] { opacity: 1 !important; transform: none !important; }
}
```
```js
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
function init() {
  if (reduce.matches) { /* skip parallax/lerp/WebGL; show static */ return; }
  startParallax(); startScrollChoreo();
}
reduce.addEventListener("change", () => location.reload()); // re-init cleanly
```

Disable: pointer/scroll parallax, large entrance transforms, auto-playing
WebGL/video, infinite background motion, scroll-snapping pins.

---

## 4. Other accessibility musts

- **Keyboard:** every interactive element reachable & operable; visible
  `:focus-visible` (don't remove outlines without replacing them). Custom cursor
  must not hide focus rings.
- **Contrast:** maintain WCAG AA (4.5:1 text) even over moving/gradient
  backgrounds — add a scrim/overlay behind text on busy backdrops.
- **Semantics:** real headings/landmarks/buttons/links. WebGL content needs DOM
  equivalents or `aria` labels; canvases are invisible to AT.
- **Don't trap scroll** or hijack it so users can't control pace/direction.
- **Motion intensity:** avoid rapid flashing (seizure risk) and extreme parallax
  (nausea). Keep large-area motion gentle.
- **Respect `prefers-reduced-data`/save-data** if you can — skip heavy media.

---

## 5. Loading & asset performance

- **Lazy-load** offscreen images/video (`loading="lazy"`, IntersectionObserver
  for WebGL/heavy modules). Code-split the 3D bundle.
- Serve **modern formats** (AVIF/WebP), responsive `srcset`, and explicit
  `width`/`height` (or `aspect-ratio`) to prevent layout shift (CLS).
- **Preload** the hero font + hero image; `font-display: swap` (or `optional`).
- Keep the **first meaningful paint** fast — the cinematic intro should never be
  the reason content is slow. Mask load with a purposeful (not artificial) loader.
- Self-host fonts; subset them. Variable fonts often save bytes vs many weights.

---

## 6. The pre-ship checklist

- [ ] Steady 60fps on the hero + scroll on a mid-range phone.
- [ ] Only `transform`/`opacity` animated; no paint-flashing during motion.
- [ ] `will-change` added/removed around animations, not left global.
- [ ] `prefers-reduced-motion` gives a clean, usable, non-nauseating experience.
- [ ] Keyboard-navigable; `:focus-visible` everywhere; custom cursor doesn't break it.
- [ ] Text contrast holds over moving/gradient backgrounds.
- [ ] No CLS (sized media), fast LCP, lazy-loaded heavy assets.
- [ ] WebGL has a static fallback + pauses offscreen + capped DPR.
- [ ] Resize / route change re-inits or refreshes scroll triggers cleanly.
- [ ] Works (degraded but fine) with JS errors in one module not killing the page.
