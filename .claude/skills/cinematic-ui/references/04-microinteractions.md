# 04 — Microinteractions: cursor, magnetic, hover, kinetic type, loaders

The macro moments make people screenshot a site; the **micro** moments make it
*feel* expensive in the hand. These are the tactile details visitors sense even
when they can't name them.

---

## 1. Custom cursor

A custom cursor is the single most recognizable "premium site" signal. Keep it
accessible: it must lag-follow smoothly, change state on interactive elements,
and never hide the real focus ring for keyboard users.

```css
* { cursor: none; }                    /* hide native (desktop, fine-pointer only) */
.cursor {
  position: fixed; top: 0; left: 0; z-index: 9999; pointer-events: none;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--accent);
  transform: translate(-50%, -50%);
  transition: width .3s var(--ease-ui), height .3s var(--ease-ui),
              background .3s, opacity .3s;
  mix-blend-mode: difference;          /* auto-contrast over any bg */
}
.cursor.is-hover { width: 56px; height: 56px; background: #fff; }
```
```js
let tx = 0, ty = 0, cx = 0, cy = 0;
addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; });
(function loop() {
  cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;     // lerp = trailing feel
  cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`;
  requestAnimationFrame(loop);
})();
document.querySelectorAll("a, button, [data-cursor]").forEach((el) => {
  el.addEventListener("pointerenter", () => cursor.classList.add("is-hover"));
  el.addEventListener("pointerleave", () => cursor.classList.remove("is-hover"));
});
```

**Only enable on `(pointer: fine)` devices.** Full version with state machine
(grow / text label / "drag" / "view") and touch guard in `assets/cursor.js`.

---

## 2. Magnetic elements (CTA pulls toward cursor)

The button leans toward the pointer within a radius, then springs back.

```js
function magnetic(el, strength = 0.4) {
  const r = () => el.getBoundingClientRect();
  el.addEventListener("pointermove", (e) => {
    const b = r();
    const x = (e.clientX - (b.left + b.width / 2)) * strength;
    const y = (e.clientY - (b.top + b.height / 2)) * strength;
    el.style.transform = `translate(${x}px, ${y}px)`;
  });
  el.addEventListener("pointerleave", () => {
    el.style.transform = "translate(0,0)";
    el.style.transition = "transform .4s var(--ease-overshoot)"; // springy return
    setTimeout(() => (el.style.transition = ""), 400);
  });
}
```
Make the *hit area* larger than the visual (padding/pseudo) so the magnet
engages before the cursor touches the edge. Add lerp for extra smoothness.

---

## 3. Hover states that feel designed

- **Link underline sweep** (wipe in from left, out to right):
```css
.link { position: relative; }
.link::after {
  content:""; position:absolute; left:0; bottom:-2px; height:1px; width:100%;
  background: currentColor; transform: scaleX(0); transform-origin: right;
  transition: transform .4s var(--ease-out-expo);
}
.link:hover::after { transform: scaleX(1); transform-origin: left; }
```
- **Image hover:** scale the image *inside* a fixed `overflow:hidden` frame so
  the frame stays put and only the photo zooms (`img { transition: transform
  .6s var(--ease-out-expo) } .frame:hover img { transform: scale(1.06) }`).
- **Button fill sweep, icon nudge, label crossfade** — pick ONE per button and
  keep it consistent site-wide.

---

## 4. Kinetic typography (split + animate by line/word/char)

The signature "headline assembles itself" reveal. Split text into spans, clip
each line, stagger the rise.

```js
// Split into words wrapped in a clip mask
function splitLines(el) {
  el.innerHTML = el.textContent
    .split(" ")
    .map((w) => `<span class="word"><span class="word__in">${w}</span></span>`)
    .join(" ");
}
```
```css
.word { display:inline-block; overflow:hidden; vertical-align:top; }
.word__in {
  display:inline-block; transform: translateY(110%);
  transition: transform .9s var(--ease-out-expo);
  transition-delay: calc(var(--i,0) * 60ms);
}
.is-in .word__in { transform: translateY(0); }
```
Set `--i` per word for stagger. For production-grade splitting (handles wrapping,
nested markup, resize) use **GSAP SplitText** or **Splitting.js**. Variable fonts
let you also animate `font-weight`/width on scroll for kinetic effects.

`assets/reveal.js` includes a lightweight split-and-reveal helper.

---

## 5. Loaders & intro sequences

A loader is only worth it if it *masks real work* or sets the tone — never add
artificial delay. Patterns:
- **Counter** `0 → 100%` tied to real asset progress, then a curtain wipe reveals
  the hero (overlay `clip-path` / `transform: translateY(-100%)`).
- **Logo draw-on** (SVG `stroke-dashoffset` animation) during preload.
- **First-paint hero reveal:** even with no loader, animate the hero in on load
  with staggered kinetic type so the entrance feels authored.

```css
.curtain { position:fixed; inset:0; z-index:1000; background:var(--ink);
  transform: translateY(0); transition: transform 1s var(--ease-in-out); }
.loaded .curtain { transform: translateY(-100%); }
```

---

## 6. Page / route transitions

Hard navigations break the cinematic illusion. Mask them:
- **Overlay wipe:** cover the screen → swap content → reveal (works with View
  Transitions API or a manual overlay + History API / framework router).
- **View Transitions API** (native, progressively enhanced):
```css
@view-transition { navigation: auto; }
::view-transition-old(root){ animation: fade .3s both; }
::view-transition-new(root){ animation: fade .4s both reverse; }
```
- **Shared element transitions:** give a thumbnail and its detail-page hero the
  same `view-transition-name` so it morphs between pages.
- **Framer Motion** `AnimatePresence` for exit animations in React SPAs.

---

## 7. Microinteraction rules

- Feedback ≤ 300ms; reveals/entrances 600–1200ms. Hover should feel instant-ish,
  reveals luxurious.
- Every interactive element gets a hover AND a focus-visible state.
- Custom cursor: fine-pointer only, never kills keyboard focus visibility.
- One signature hover treatment, reused — not a different one per component.
- Springs/overshoot for playful brands; clean expo-out for luxury/serious ones.
- Sound (if any) must be opt-in and muteable.
