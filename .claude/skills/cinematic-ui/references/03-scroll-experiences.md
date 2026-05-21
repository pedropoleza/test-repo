# 03 — Scroll experiences: smooth scroll, scrubbing, pinning, reveals

Scroll is the primary interaction on a long-form site. The award-winning feel
comes from (a) **inertial smooth scroll** unifying everything, and (b) **scroll
choreography** — content that reveals, pins, scrubs, and transforms as a
timeline tied to scroll position.

---

## 1. Smooth scroll with Lenis (the backbone)

Almost every modern Awwwards site uses smooth/inertial scroll. Lenis is the
standard (~3KB, no scroll-jacking, accessible).

```js
import Lenis from "lenis";

const lenis = new Lenis({
  duration: 1.1,                                  // inertia length (s)
  easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)), // expo-out
  smoothWheel: true,
  // Leave touch native unless you have a strong reason — feels best on mobile.
});

function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
requestAnimationFrame(raf);
```

Full setup + GSAP bridge in `assets/smooth-scroll.js`.

**Why it matters:** once scroll has inertia, your parallax, pinning, and reveals
inherit that smoothness for free. Design every other scroll effect *against*
Lenis, not the native scrollbar.

> Caveats: don't break anchor links (`lenis.scrollTo('#id')`), keep
> keyboard/space/page-down working (Lenis does by default), and disable it under
> `prefers-reduced-motion`.

---

## 2. GSAP ScrollTrigger — the choreography engine

For anything beyond "fade in on enter", use GSAP + ScrollTrigger. It maps scroll
position to animation timelines and handles pinning, scrubbing, snapping, and
cleanup.

**Reveal on enter (with stagger):**
```js
gsap.from(".reveal", {
  y: 60, opacity: 0, duration: 1, ease: "expo.out",
  stagger: 0.08,
  scrollTrigger: { trigger: ".section", start: "top 80%" },
});
```

**Scrubbed timeline (animation tied 1:1 to scroll, scrubs both ways):**
```js
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".panel",
    start: "top top",
    end: "+=150%",
    scrub: 1,        // number = smoothing lag; `true` = exact
    pin: true,       // freeze the section while the timeline plays
  },
});
tl.to(".panel__img", { scale: 1.4, ease: "none" })
  .to(".panel__title", { yPercent: -120, ease: "none" }, 0)
  .from(".panel__caption", { opacity: 0 }, 0.3);
```

**Pinned section** = the section sticks while inner content animates through a
scroll "budget" (the `end`). This is how those "scroll to advance the story"
sequences work.

**Sync Lenis ↔ ScrollTrigger** (so scrub matches inertial scroll):
```js
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
```

Always `ScrollTrigger.getAll().forEach(t => t.kill())` + `ScrollTrigger.refresh()`
on route change / resize in SPAs.

---

## 3. Horizontal scroll section (vertical wheel → horizontal travel)

```js
const track = document.querySelector(".h-track");
gsap.to(track, {
  x: () => -(track.scrollWidth - innerWidth),
  ease: "none",
  scrollTrigger: {
    trigger: ".h-wrap",
    pin: true,
    scrub: 1,
    end: () => "+=" + (track.scrollWidth - innerWidth),
  },
});
```
Use sparingly and signal it (a progress bar, a hint). Forced horizontal scroll
that hijacks the whole page frustrates users if overused.

---

## 4. Native CSS scroll-driven animations (no JS)

Modern browsers support tying `@keyframes` to scroll/visibility natively. Great
for progressive enhancement; degrade gracefully where unsupported.

```css
/* Progress bar tied to page scroll */
.progress {
  transform-origin: left; transform: scaleX(0);
  animation: grow linear both;
  animation-timeline: scroll(root block);
}
@keyframes grow { to { transform: scaleX(1); } }

/* Reveal as element enters the viewport */
.reveal {
  animation: fade-up linear both;
  animation-timeline: view();
  animation-range: entry 0% cover 35%;
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(40px); }
  to   { opacity: 1; transform: translateY(0); }
}
@supports not (animation-timeline: view()) {
  .reveal { opacity: 1; transform: none; } /* graceful fallback */
}
```

Pair with `@property` for animatable custom properties (e.g. animate a gradient
angle or a number).

---

## 5. Reveal-on-scroll without a library (IntersectionObserver)

When you don't want GSAP, this is the lightweight pattern (see `assets/reveal.js`):

```js
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add("is-in");
      io.unobserve(e.target);            // reveal once
    }
  });
}, { threshold: 0.15, rootMargin: "0px 0px -10% 0px" });

document.querySelectorAll("[data-reveal]").forEach((el, i) => {
  el.style.setProperty("--i", i);        // for CSS stagger
  io.observe(el);
});
```
```css
[data-reveal] {
  opacity: 0; transform: translateY(40px);
  transition: opacity .8s var(--ease-out-expo), transform .8s var(--ease-out-expo);
  transition-delay: calc(var(--i, 0) * var(--stagger));
}
[data-reveal].is-in { opacity: 1; transform: none; }
```

---

## 6. Scroll-experience design rules

- **Stagger reveals** (40–90ms). Never reveal a group simultaneously.
- **Don't fight the user.** Smooth scroll = inertia, NOT scroll-jacking. Keep
  natural speed and direction; never trap them in a section.
- **Reveal once** for content (re-animating on every pass is distracting);
  scrub freely for decorative/sticky elements.
- **Budget pinned sections** carefully — too long and users feel stuck.
- **Mobile:** keep native touch scrolling; simplify or drop heavy scrubbed
  pins on small screens.
- Always handle resize/route changes: refresh ScrollTrigger, recompute widths.
