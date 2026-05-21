/**
 * smooth-scroll.js — Lenis inertial smooth scroll + optional GSAP ScrollTrigger
 * bridge. Reduced-motion aware (skips smoothing, keeps native scroll).
 *
 * Install:  npm i lenis            (and gsap if you use ScrollTrigger)
 *
 * Basic:
 *   import { initSmoothScroll } from "./smooth-scroll.js";
 *   const lenis = initSmoothScroll();
 *   // anchor links:  lenis.scrollTo("#section", { offset: -80 });
 *
 * With GSAP ScrollTrigger:
 *   import gsap from "gsap";
 *   import ScrollTrigger from "gsap/ScrollTrigger";
 *   gsap.registerPlugin(ScrollTrigger);
 *   const lenis = initSmoothScroll({ gsap, ScrollTrigger });
 */
import Lenis from "lenis";

export function initSmoothScroll(opts = {}) {
  const { gsap, ScrollTrigger, ...lenisOpts } = opts;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reduced motion: don't smooth-scroll (vestibular triggers). Return a shim
  // so callers can still use scrollTo.
  if (reduce) {
    return {
      scrollTo: (target, o = {}) => {
        const el = typeof target === "string" ? document.querySelector(target) : target;
        if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
      },
      destroy() {},
      raf() {},
      on() {},
    };
  }

  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
    smoothWheel: true,
    // Native touch usually feels best; uncomment to smooth touch too:
    // smoothTouch: false,
    ...lenisOpts,
  });

  // Bridge to GSAP ScrollTrigger if provided (keeps scrub synced to inertia).
  if (gsap && ScrollTrigger) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }

  return lenis;
}
