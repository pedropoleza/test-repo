# 07 — Reference sites & "vibe → recipe" deconstructions

Award-winning sites are remixes of a shared vocabulary of techniques. This file
maps the *feeling* you want to the *techniques* that produce it, using
landonorris.com and its peers as the canonical references. Use it to reverse-
engineer a brief like "make it feel like landonorris.com."

> Note: live sites change. Treat these as archetypes of an *approach*, not
> pixel-exact specs. The point is the technique stack behind each feeling.

---

## The reference set (study these archetypes)

- **landonorris.com** (Build in Amsterdam) — cinematic sport/lifestyle brand
  site: full-bleed imagery, inertial smooth scroll, scrubbed scroll sequences,
  bold oversized type, image reveal masks, refined custom cursor, seamless page
  transitions. The benchmark for "premium athlete/brand storytelling."
- **Build in Amsterdam** (buildinamsterdam.com) — the studio behind that style:
  editorial luxury, restrained palettes, masked image reveals, buttery scroll.
- **Active Theory** — WebGL-heavy, experimental, immersive 3D worlds, audio-
  reactive, bleeding-edge.
- **Lusion** (lusion.co) — jaw-dropping R3F/WebGL, fluid 3D, generative visuals.
- **Cuberto** — playful, magnetic everything, custom-cursor-driven, fluid SVG.
- **Locomotive / Resn / Obys / Igloo / Dogstudio (Tonik)** — the broader Awwwards
  canon worth browsing for patterns.
- Aggregators to mine for current technique: **Awwwards, FWA, Godly, Httpster,
  Land-book, Codrops** (Codrops ships tutorials + source for most of these effects).

---

## The shared technique stack (the "modern award site" recipe)

Nearly all of them combine:
1. **Lenis** inertial smooth scroll (unifies the whole feel). → `03`
2. **GSAP + ScrollTrigger** for scrubbed/pinned scroll choreography. → `03`
3. **Masked image reveals** — image sits in `overflow:hidden`, a `clip-path`/
   scale/translate uncovers it on enter. → snippet below.
4. **Kinetic split-text headlines** rising out of clip masks, staggered. → `04`
5. **Custom cursor** + **magnetic** CTAs and interactive elements. → `04`
6. **Oversized fluid type**, restrained palette, huge negative space. → `01`
7. **Pointer/scroll parallax with lerp** for depth. → `02`
8. **Seamless page transitions** (overlay wipe / View Transitions / shared
   element). → `04`
9. (Top tier) **WebGL/R3F** atmosphere: shader image warps, 3D objects,
   particles. → `05`
10. Meticulous **performance + reduced-motion**. → `06`

---

## Vibe → recipe

### A) "Cinematic brand / athlete" (landonorris.com)
Feeling: confident, premium, slow, immersive, photographic.
- Lenis (`duration ~1.1`, expo-out) + GSAP ScrollTrigger.
- Full-bleed hero image/video; oversized headline that **rises out of a mask**
  on load, word-staggered.
- **Scrubbed, pinned** story sections: as you scroll, an image scales (`1 → 1.3`),
  caption translates, next panel wipes in via `clip-path`.
- Custom cursor (small dot → grows + "view"/"drag" label over media).
- Subtle pointer parallax on hero layers (lerp `~0.06`, heavy/floaty).
- Page transitions: full-screen color curtain wipes between routes.
- Palette: rich near-black + paper + one brand accent. Type does the talking.
- Motion personality: **calm, weighty, expo-out**, durations 0.8–1.2s. No bounce.

### B) "Playful / agency" (Cuberto)
Feeling: fun, bouncy, alive, tactile.
- Magnetic *everything*; custom cursor that morphs into labels/icons.
- Springy easing / tasteful overshoot; SVG blob/fluid transitions.
- Brighter palette, rounded forms, more simultaneous motion (but still staggered).
- Personality: **springy**, faster (0.3–0.6s), `cubic-bezier(.34,1.56,.64,1)`.

### C) "WebGL showcase" (Lusion / Active Theory)
Feeling: futuristic, otherworldly, technical wow.
- R3F/Three.js front and center: fluid sims, particles, shader-warped media,
  3D scenes reacting to scroll (`useScroll`) and pointer.
- Postprocessing bloom, chromatic aberration, noise/grain overlay.
- DOM text minimal, kept accessible; WebGL is the world.
- Mandatory: DPR cap, mobile fallback, offscreen pause. → `05`, `06`
- Personality: **smooth + organic**, continuous ambient motion.

### D) "Editorial luxury" (Build in Amsterdam)
Feeling: refined, quiet, expensive, magazine-like.
- Masked image reveals, generous grids deliberately broken for hero spreads.
- Minimal but exquisite type; tiny tracked-out labels; lots of air.
- Slow, sparse motion — restraint is the aesthetic. One effect per section.
- Personality: **minimal, slow, expo-out**, near-monochrome.

---

## Signature snippet: masked image reveal (used everywhere)

The clip-mask reveal is the most reused move across all these sites.

```css
.reveal-img { position: relative; overflow: hidden; }
.reveal-img img {
  display:block; width:100%; height:100%; object-fit:cover;
  transform: scale(1.25);                 /* start zoomed-in */
  transition: transform 1.2s var(--ease-out-expo);
}
.reveal-img::after {                       /* the curtain */
  content:""; position:absolute; inset:0; background: var(--ink);
  transform: scaleY(1); transform-origin: bottom;
  transition: transform 1s var(--ease-in-out);
}
.reveal-img.is-in img    { transform: scale(1); }      /* settle */
.reveal-img.is-in::after { transform: scaleY(0); transform-origin: top; }
```
Trigger `.is-in` with IntersectionObserver (`assets/reveal.js`) or ScrollTrigger.
Stagger across a gallery for the choreographed feel.

---

## How to apply a reference in practice

1. **Name the vibe** (A–D above) from the brief. If unclear, ask the user to
   pick a reference site they love and identify which archetype it is.
2. **Pull that recipe's technique list**; build the static composition first (`01`).
3. **Add the backbone** (Lenis) → reveals/stagger → the ONE signature moment →
   micro-polish (cursor/magnetic) → transitions.
4. **Match the motion personality** consistently (easing/duration/type).
5. **Performance + reduced-motion pass** (`06`) before shipping.
6. Don't copy 1:1 — steal the *technique*, serve the client's own art direction.
