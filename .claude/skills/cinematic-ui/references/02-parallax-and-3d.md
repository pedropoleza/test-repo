# 02 — Parallax & 3D depth

The core idea: **different layers respond at different rates**, and movement is
**interpolated (lerped)** toward its target so it has weight and lag. Instant
1:1 movement is the #1 "cheap" tell.

---

## 1. The golden rule: one rAF lerp loop

Never write `element.style.transform` directly inside a `mousemove`/`scroll`
handler. Those events fire faster than frames and produce robotic, janky motion.
Instead: handlers only **record the target**; a single `requestAnimationFrame`
loop **eases current → target** every frame.

```js
// Linear interpolation: move a fraction of the remaining distance each frame.
const lerp = (current, target, factor) => current + (target - current) * factor;

let mouseX = 0, mouseY = 0;        // target (set by events)
let curX = 0, curY = 0;            // current (animated)

window.addEventListener("mousemove", (e) => {
  mouseX = (e.clientX / innerWidth  - 0.5) * 2;   // -1 .. 1
  mouseY = (e.clientY / innerHeight - 0.5) * 2;
});

function raf() {
  curX = lerp(curX, mouseX, 0.08);   // 0.05–0.12: lower = heavier/laggier
  curY = lerp(curY, mouseY, 0.08);

  layers.forEach((el) => {
    const depth = parseFloat(el.dataset.depth);     // e.g. 0.2 bg … 1.4 fg
    const x = curX * depth * 40;                     // px range scales w/ depth
    const y = curY * depth * 40;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
```

`assets/parallax.js` is the production version (pointer + scroll, reduced-motion
aware, cleanup). Use it rather than re-deriving this.

**The lerp factor IS the personality.** `0.04` = dreamy/heavy/floaty;
`0.1` = responsive; `0.2+` = snappy/technical. Tune to the brand.

---

## 2. CRITICAL: separate mouse-translate from CSS transforms

If JS sets `transform: translate3d(...)` and CSS *also* animates
`transform: rotate(...)` on the same element, they overwrite each other and you
get stutter. **Compose them on different properties / different elements:**

- Put the **JS pointer movement** on the `translate` property:
  `el.style.translate = '20px 10px'`
- Leave **CSS keyframe animations** on `transform` (`rotate`, `scale`).
- They now multiply cleanly instead of clobbering.

```css
.floaty { animation: bob 6s var(--ease-in-out) infinite; } /* uses transform */
@keyframes bob { 50% { transform: translateY(-14px) rotate(2deg); } }
```
```js
// JS only touches `translate`, never `transform` → no conflict
el.style.translate = `${x}px ${y}px`;
```

Alternatively, nest: outer element gets JS translate, inner gets CSS transform.

---

## 3. 3D tilt cards (perspective + rotateX/Y)

The "card leans toward your cursor" effect. Real depth needs `perspective` on the
parent and `preserve-3d`.

```css
.tilt-wrap { perspective: 1000px; }           /* smaller = more dramatic */
.tilt {
  transform-style: preserve-3d;
  transition: transform .4s var(--ease-ui);     /* smooth return on leave */
  will-change: transform;
}
.tilt__layer { transform: translateZ(40px); }  /* lift children for parallax-in-card */
.tilt__glare {                                  /* moving specular highlight */
  position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background: radial-gradient(circle at var(--gx,50%) var(--gy,50%),
              rgba(255,255,255,.35), transparent 45%);
  opacity:0; transition:opacity .3s;
}
.tilt:hover .tilt__glare { opacity:1; }
```
```js
card.addEventListener("pointermove", (e) => {
  const r = card.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width  - 0.5;  // -.5 .. .5
  const py = (e.clientY - r.top)  / r.height - 0.5;
  card.style.transform =
    `rotateY(${px * 16}deg) rotateX(${-py * 16}deg)`;
  card.style.setProperty("--gx", `${(px + 0.5) * 100}%`);
  card.style.setProperty("--gy", `${(py + 0.5) * 100}%`);
});
card.addEventListener("pointerleave", () => { card.style.transform = ""; });
```

Lift inner content with `translateZ()` so it floats above the card face → real
parallax-within-the-card. `assets/tilt.js` adds lerp smoothing + a gyroscope
fallback for mobile.

---

## 4. Scroll parallax (depth layers on scroll)

Background drifts slower than foreground as you scroll. Two ways:

**A) Native CSS (zero JS) — `transform: translateZ` + perspective scroll:**
```css
.parallax-root {
  height: 100vh; overflow-y: auto; overflow-x: hidden;
  perspective: 8px; perspective-origin: 0 0;
}
.layer       { transform-origin: 0 0; }
.layer--back { transform: translateZ(-6px) scale(1.75); }  /* far → slow */
.layer--mid  { transform: translateZ(-2px) scale(1.25); }
.layer--front{ transform: translateZ(0); }                 /* near → 1:1 */
```
Cheap and smooth, but constrains layout (needs the scroll container).

**B) JS, driven by scroll progress (more control), inside the rAF loop:**
```js
function onFrame() {
  const y = window.scrollY;
  bg.style.transform   = `translate3d(0, ${y *  0.15}px, 0)`; // slow
  mid.style.transform  = `translate3d(0, ${y *  0.4}px, 0)`;
  fg.style.transform   = `translate3d(0, ${y * -0.1}px, 0)`;  // counter-move
  requestAnimationFrame(onFrame);
}
```
Best combined with **Lenis** smooth scroll (see `03`) so the parallax inherits
inertial motion. For scrubbed, pinned, or section-locked parallax use **GSAP
ScrollTrigger** — it's purpose-built and handles the math + cleanup.

---

## 5. Atmospheric depth (fake 3D cheaply)

Real depth perception isn't just position offset — add these per layer:
- **Scale:** farther layers slightly larger & move less; near layers smaller
  range but faster.
- **Blur:** `filter: blur(2–6px)` on far background layers → depth-of-field.
- **Opacity / desaturation:** distance fades and de-saturates.
- **A drifting light source** (slow-moving radial gradient / aurora) behind
  everything so the "space" feels lit and alive even when still.

```css
.aurora {
  position:fixed; inset:-20%; z-index:-1; filter: blur(80px); opacity:.5;
  background:
    radial-gradient(40% 40% at 30% 30%, var(--accent), transparent 60%),
    radial-gradient(50% 50% at 70% 60%, #3b5bff, transparent 60%);
  animation: drift 40s var(--ease-in-out) infinite alternate;
}
@keyframes drift { to { transform: translate3d(6%, -4%, 0) scale(1.1); } }
```

---

## 6. Depth performance rules

- Only animate `transform`/`opacity`/`translate` — they're GPU-composited.
- `transform: translate3d()` / `translateZ(0)` promotes to its own layer.
- Add `will-change: transform` **just before** animating, remove after; never
  leave it on dozens of elements (memory blowup).
- Cap pointer parallax range (≤ ~50px) so it reads as depth, not chaos.
- Disable / reduce parallax under `prefers-reduced-motion` and on small screens.
- One rAF loop for the whole page, not one per element.
