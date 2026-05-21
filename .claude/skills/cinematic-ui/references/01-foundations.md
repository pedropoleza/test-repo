# 01 — Foundations: the visual system behind premium feel

Motion is the last 20%. The first 80% of "this looks expensive" is composition,
type, color, and space. Get this right and even subtle motion will sing.

---

## 1. The premium "feel" — what actually creates it

When people say a site (landonorris.com, Build in Amsterdam, Cuberto, Lusion)
"feels high-end", they're responding to a measurable set of choices:

- **Generous negative space.** Confidence is shown by what you leave out.
  Crowded = cheap. Let hero type breathe with huge margins.
- **Oversized typography.** Display headlines at `clamp(3rem, 9vw, 12rem)`.
  Big type is the cheapest way to look expensive.
- **A tight, restrained palette.** Often near-monochrome + one accent. Rich
  neutrals (warm off-blacks `#0a0a0b`, paper off-whites `#f4f1ea`) read more
  premium than pure `#000`/`#fff`.
- **Considered, slow motion.** Durations 600–1200ms on big moments, expo-out
  easing. Nothing snaps.
- **Tactility.** Hover feedback everywhere, magnetic CTAs, a custom cursor,
  images that scale slightly on hover. The site feels *responsive to touch*.
- **Cohesion.** One type system, one motion personality, one spatial logic.
- **Surprise + delight, sparingly.** One memorable interaction, not ten.

---

## 2. Typography

Type does most of the heavy lifting on motion-forward sites.

```css
:root {
  /* Fluid type scale (clamp = min, preferred-vw, max) */
  --fs-display: clamp(3.5rem, 9vw, 12rem);
  --fs-h1:      clamp(2.5rem, 6vw, 6rem);
  --fs-h2:      clamp(2rem, 4vw, 3.5rem);
  --fs-h3:      clamp(1.5rem, 2.5vw, 2.25rem);
  --fs-body:    clamp(1rem, 1.1vw, 1.125rem);
  --fs-small:   0.8125rem;

  --lh-tight: 0.95;   /* display headlines: lead negative-ish */
  --lh-snug:  1.1;
  --lh-body:  1.6;

  --ls-display: -0.03em; /* tighten big type */
  --ls-caps:    0.08em;  /* track-out small caps/eyebrows */
}

.display {
  font-size: var(--fs-display);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-display);
  font-weight: 600;
  text-wrap: balance;
}
.eyebrow {
  font-size: var(--fs-small);
  text-transform: uppercase;
  letter-spacing: var(--ls-caps);
  font-weight: 500;
}
```

Rules of thumb:
- **Display headlines: tighten** tracking (`-0.02` to `-0.04em`) and line-height
  (`0.9–1.0`). **Eyebrows/labels: track out** (`+0.06` to `+0.12em`), uppercase.
- **Variable fonts** unlock the best kinetic type (animate `font-weight`,
  `font-variation-settings`) cheaply. Great pairing with scroll.
- Pair a characterful **display** face with a neutral, highly legible **body**
  face. Keep body line length ~60–75ch.
- `text-wrap: balance` on headings, `pretty` on paragraphs.

---

## 3. Color & light

```css
:root {
  /* Rich neutrals beat pure black/white */
  --ink:   #0a0a0b;   /* warm near-black */
  --paper: #f5f3ee;   /* warm off-white  */
  --accent: #ff4d2e;  /* one confident accent */

  /* Elevation via subtle, layered surfaces (dark theme) */
  --surface-0: #0a0a0b;
  --surface-1: #141416;
  --surface-2: #1d1d20;
}
```

- **Depth comes from light, not just stacking.** Soft layered gradients, gentle
  vignettes, and a faint moving glow/aurora behind content imply 3D space.
- **Contrast for hierarchy:** the hero gets the most contrast; secondary content
  recedes (lower contrast, smaller, blurred-back layers).
- **One accent**, used intentionally (CTA, active state, hover). Multiple accents
  dilute.
- For glass/translucency: `backdrop-filter: blur(20px) saturate(140%)` + a
  semi-transparent surface + a 1px hairline border (`rgba(255,255,255,.08)`).

---

## 4. Spacing & layout rhythm

```css
:root {
  /* 8px base, geometric-ish scale */
  --space-1: .25rem; --space-2: .5rem;  --space-3: .75rem;
  --space-4: 1rem;   --space-6: 1.5rem; --space-8: 2rem;
  --space-12: 3rem;  --space-16: 4rem;  --space-24: 6rem;
  --space-32: 8rem;  --space-48: 12rem;

  --maxw: 1440px;
  --gutter: clamp(1.25rem, 5vw, 6rem);
}
.section { padding-block: clamp(4rem, 12vh, 12rem); }
.container { max-width: var(--maxw); margin-inline: auto; padding-inline: var(--gutter); }
```

- **Vertical rhythm:** big, consistent section padding (`clamp(6rem, 14vh, 12rem)`)
  gives the slow, cinematic pacing. Cramped sections feel cheap.
- **Break the grid intentionally** for hero moments — full-bleed media,
  asymmetry, overlap. A predictable grid everywhere is safe but forgettable;
  the best sites establish a grid then deliberately violate it once or twice.
- **Overlap layers** (`margin-top: -10vh`, negative offsets, `z-index`) to create
  depth and momentum between sections.

---

## 5. Motion tokens (define once, reuse everywhere)

This is what makes the whole site feel like one hand made it. See
`assets/motion.css` for the full file.

```css
:root {
  /* Durations */
  --dur-fast:   .2s;
  --dur-base:   .4s;
  --dur-slow:   .8s;
  --dur-grand: 1.2s;   /* hero moments */

  /* Easings — the house curves */
  --ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1);   /* THE reveal curve */
  --ease-in-out:    cubic-bezier(0.65, 0, 0.35, 1);
  --ease-ui:        cubic-bezier(0.4, 0, 0.2, 1);     /* hover/press */
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);/* tasteful spring-ish */

  --stagger: 70ms;     /* base offset between grouped children */
}
```

Pick durations + easings up front, then *never* hand-type a magic number again.
Consistency here is 90% of "feels designed."

---

## 6. Composition checklist (per section)

- [ ] Is there ONE clear focal point / entry for the eye?
- [ ] Enough negative space that it breathes?
- [ ] Type scale obviously hierarchical (display ≫ body)?
- [ ] Depth implied (light, layering, overlap, parallax)?
- [ ] Does it still read beautifully with motion disabled?
- [ ] Does motion *reinforce* hierarchy (focal point leads, supports follow)?
- [ ] Consistent with the chosen motion personality?
