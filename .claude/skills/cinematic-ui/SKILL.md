---
name: cinematic-ui
description: >-
  Design immersive, award-winning web experiences — 3D parallax, scroll-driven
  motion, WebGL/Three.js, custom cursors, kinetic typography, page transitions,
  and premium microinteractions in the style of Awwwards / FWA sites like
  landonorris.com, Build in Amsterdam, Active Theory, and Lusion. Use whenever
  the work centers on VISUAL EXPERIENCE and MOTION: hero sections, landing
  pages, product showcases, portfolios, brand sites, interactive storytelling,
  loaders, cursor effects, hover/scroll choreography, depth/3D layouts, or any
  request to make a UI feel "premium", "cinematic", "alive", "high-end", or
  "like an award-winning site". Covers vanilla JS/CSS, GSAP + Lenis, React/
  Next.js, and Three.js / React Three Fiber. Not for CRUD dashboards, data
  tables, or backend logic.
---

# Cinematic UI — Immersive Design, 3D, Parallax & Motion

A complete playbook for building the kind of web experiences that win Awwwards
Site of the Day: deep, tactile, motion-rich interfaces where every scroll,
hover, and transition feels intentional and physical. This skill is opinionated
about the *craft* — the timing curves, the layering, the restraint — not just
the APIs.

> The goal is never "add animations." The goal is a **coherent feeling**:
> weight, depth, momentum, and polish. One great transition beats twenty
> twitchy ones.

---

## How to use this skill

1. **Read this file fully first.** It contains the philosophy, the decision
   tree (which tech stack), and the non-negotiable quality bar.
2. **Then open only the reference files you need** for the current task. They
   contain deep, copy-paste-ready implementations:

   | File | When to read it |
   |------|-----------------|
   | `references/01-foundations.md` | Always, before building. Design principles, the "feel" of premium sites, layout, type, color, spacing. |
   | `references/02-parallax-and-3d.md` | Mouse/scroll parallax, 3D tilt cards, perspective layers, depth, the lerp render loop. |
   | `references/03-scroll-experiences.md` | Smooth scroll (Lenis), GSAP ScrollTrigger, pinning, scroll-driven CSS, reveal-on-scroll, horizontal scroll. |
   | `references/04-microinteractions.md` | Buttons, magnetic elements, custom cursor, hover states, text/letter animation, loaders. |
   | `references/05-webgl-three.md` | Three.js / React Three Fiber, shader image planes, hover distortion, particle fields, when WebGL is worth it. |
   | `references/06-performance-and-a11y.md` | 60fps rules, GPU compositing, `prefers-reduced-motion`, mobile, the things that break. |
   | `references/07-reference-sites.md` | Deconstructions of landonorris.com & peers — what techniques produce which feelings, with a recipe per "vibe". |

3. **Pull working code from `assets/`** — these are dependency-light modules you
   can drop in and adapt:
   - `assets/parallax.js` — pointer + scroll parallax with a single rAF lerp loop
   - `assets/tilt.js` — 3D tilt card with glare, gyroscope-aware
   - `assets/smooth-scroll.js` — Lenis setup + GSAP ScrollTrigger bridge
   - `assets/cursor.js` — custom cursor with magnetic targets & state
   - `assets/reveal.js` — IntersectionObserver scroll reveals + split-text
   - `assets/motion.css` — easing tokens, keyframes, reduced-motion scaffold

4. **Verify in a real browser** before declaring done. Motion bugs (jank,
   overshoot, layout thrash) are invisible in code review. Check the golden
   path, then resize, then scroll fast, then toggle reduced-motion.

---

## The quality bar (non-negotiable)

These are the differences between "has animations" and "feels designed". Apply
all of them.

1. **Everything eases. Nothing is linear** (except continuous loops like
   marquees/spinners). Default to custom cubic-beziers, not `ease`. The house
   curves:
   - Entrances / reveals: `cubic-bezier(0.16, 1, 0.3, 1)` ("expo out" — fast
     start, long luxurious settle). This single curve carries 80% of premium feel.
   - UI feedback (hover, press): `cubic-bezier(0.4, 0, 0.2, 1)` ~200–300ms.
   - Playful / springy: a real spring (Framer Motion `type:"spring"`) or
     `cubic-bezier(0.34, 1.56, 0.64, 1)` for a tasteful overshoot.

2. **Motion follows the pointer/scroll with momentum, never instantly.** Raw
   `mousemove → transform` feels cheap and robotic. Interpolate toward the
   target every frame (lerp) so movement has weight and lag. This is the single
   biggest "expensive vs cheap" tell. See `assets/parallax.js`.

3. **Layer for depth.** Parallax means *different layers move at different
   rates*. Foreground moves most, background least. Pair with subtle scale,
   blur, and opacity gradients to fake atmospheric depth.

4. **Stagger grouped elements.** Never reveal a list/grid all at once. Offset
   each child 40–90ms. Stagger is what makes a reveal read as choreography
   instead of a flash.

5. **Respect momentum and continuity.** Page/route transitions should feel like
   one continuous space, not hard cuts. Shared-element transitions, overlay
   wipes, or a brief loader that masks the load. Smooth scroll (Lenis) unifies
   the whole feel.

6. **Restraint and hierarchy.** One hero moment per viewport. Don't animate
   everything simultaneously — the eye needs an anchor. Negative space is a
   feature. Big type + lots of air reads as confident/expensive; dense + busy
   reads as cheap.

7. **Performance is part of the design.** Jank kills the illusion instantly.
   Animate only `transform` and `opacity`. Keep the main thread free. 60fps or
   it's broken. See `references/06`.

8. **Accessibility is part of the design.** Honour `prefers-reduced-motion`
   with a real reduced variant (cross-fades, no large transforms), keep focus
   states visible, ensure content is readable without the motion. A site that
   makes people sick is not award-winning.

9. **Detail in the small stuff.** Custom cursor, magnetic buttons, link
   underline sweeps, image hover scale, number count-ups, a considered loader.
   The micro-polish is what visitors *feel* even if they can't name it.

10. **Coherent art direction.** Pick a motion personality (calm & floaty vs
    snappy & technical vs bold & kinetic) and apply it consistently to timing,
    easing, type, and color. Mixed personalities feel amateur.

---

## Decision tree — which stack?

Match the technique to the actual need. More tech ≠ better; reach for the
lightest tool that achieves the feeling.

```
Is it mostly layout, depth, hover, reveals, simple parallax?
└─ YES → Vanilla CSS + a tiny JS lerp loop. (assets/parallax, tilt, reveal)
         Add Lenis for smooth scroll. No framework needed.

Do you need scroll choreography: pinning, timelines, scrubbed sequences,
horizontal sections, complex sync?
└─ YES → GSAP + ScrollTrigger + Lenis. The industry standard for this.
         (references/03)

Already in React/Next?
└─ Use Framer Motion for component motion + variants/stagger/layout, and
   GSAP/Lenis for page-level scroll. They coexist well. (references/03, 04)

Do you need real 3D, organic distortion, fluid/particles, image-as-texture
hover warps, generative/shader visuals?
└─ YES → Three.js (vanilla) or React Three Fiber + drei (React).
         This is the landonorris.com / Lusion / Active Theory tier.
         (references/05). Heavy — only when the concept demands it.

Just want one section to pop without dependencies?
└─ CSS scroll-driven animations (animation-timeline: view()/scroll()) +
   @property. Native, zero JS. Progressive-enhance it. (references/03)
```

**Library cheat-sheet**
- **Lenis** — smooth/inertial scroll. The backbone of nearly every modern
  award site. ~3KB, framework-agnostic.
- **GSAP (+ ScrollTrigger, SplitText)** — the motion workhorse. Timelines,
  scrubbing, pinning, text splitting. Unmatched control.
- **Framer Motion** — declarative React motion: `variants`, `stagger`,
  `layout`, `whileInView`, springs, `AnimatePresence` for exit/route.
- **Three.js / React Three Fiber + @react-three/drei** — WebGL/3D.
- **Theatre.js** — visual keyframing for complex sequenced/3D animation.
- **Matter.js / Rapier** — 2D/3D physics when you want true collisions/gravity.

---

## Default build workflow

1. **Establish the system first** (before any animation): type scale, spacing
   rhythm, color, the easing + duration tokens (`assets/motion.css`). Motion
   without a visual system just decorates chaos.
2. **Build it static and beautiful.** It must look great with zero motion.
   Motion enhances a strong composition; it cannot rescue a weak one.
3. **Add smooth scroll** (Lenis) early — it changes how every other scroll
   interaction feels, so design against it from the start.
4. **Layer in scroll reveals** with stagger (`assets/reveal.js`).
5. **Add the signature moment** — the one hero interaction people remember
   (a 3D scene, a kinetic headline, a scrubbed sequence). Spend your budget here.
6. **Add micro-polish** — cursor, magnetic CTAs, hover detail, loader.
7. **Pass for performance** (transform/opacity only, will-change discipline,
   throttle/RAF) and **accessibility** (`prefers-reduced-motion`, focus, semantics).
8. **Test on a real mid-range phone.** Desktop-only motion is a common failure.

---

## Anti-patterns (instant "amateur" tells)

- Linear easing on UI motion. Raw `mousemove`-to-transform with no lerp.
- Animating `width/height/top/left/margin` (layout-triggering) instead of
  `transform`. Causes jank.
- Everything fading in at once with the same 0.3s. No stagger, no hierarchy.
- Overshoot/bounce on serious/luxury brands (mismatched personality).
- Parallax so strong it detaches from content / induces motion sickness.
- `scroll-jacking` that fights the user's scroll speed and traps them.
- Auto-playing heavy WebGL on mobile with no fallback → battery/heat/jank.
- `will-change` left on everywhere permanently (memory blowup) — add before,
  remove after.
- Ignoring `prefers-reduced-motion`. Tiny hit areas on custom cursors.
- Loaders that are slower than just showing the content.

When in doubt: **fewer, slower, smoother, more intentional.**
