# 05 — WebGL & Three.js: the top tier of immersive web

This is the landonorris.com / Lusion / Active Theory / Build in Amsterdam tier:
real 3D scenes, shader-warped imagery, fluid/particle fields, generative visuals.
Powerful but heavy — **only reach for WebGL when the concept genuinely needs
organic distortion, true 3D, or GPU-scale particle counts.** A CSS/GSAP site can
look 90% as premium for 10% of the cost.

---

## 1. When WebGL is worth it (and when it isn't)

Use WebGL for:
- Image-as-texture **hover distortion / displacement** (the "liquid" image warp).
- **Real 3D** objects/scenes the user orbits or that react to scroll.
- **Fluid, smoke, particles** (thousands of points), generative/noise visuals.
- Full-screen shader backgrounds (gradients that flow like ink).

Don't use WebGL for: layout, text, normal parallax, simple reveals — DOM/CSS is
lighter, accessible, and SEO-friendly. Keep real content in the DOM; let WebGL
be the *atmosphere* layered behind/around it.

---

## 2. Minimal Three.js scene

```js
import * as THREE from "three";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // cap DPR — perf!
document.body.appendChild(renderer.domElement);

const mesh = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 64),
  new THREE.MeshStandardMaterial({ color: 0xff4d2e, roughness: 0.25 })
);
scene.add(mesh);
scene.add(new THREE.DirectionalLight(0xffffff, 2).translateZ(5));
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const clock = new THREE.Clock();
let mx = 0, my = 0;
addEventListener("pointermove", (e) => {
  mx = (e.clientX/innerWidth - .5); my = (e.clientY/innerHeight - .5);
});
(function tick() {
  const t = clock.getElapsedTime();
  mesh.rotation.y += 0.003;
  // lerp camera toward pointer for parallax depth
  camera.position.x += (mx * 1.5 - camera.position.x) * 0.05;
  camera.position.y += (-my * 1.5 - camera.position.y) * 0.05;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
})();
addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
```

---

## 3. Shader image plane + hover displacement (the signature effect)

A textured plane whose UVs are pushed by a displacement map / noise on hover —
the "liquid image" you see on agency sites. Core fragment idea:

```glsl
// fragment (concept)
uniform sampler2D uTexture;
uniform sampler2D uDisp;     // displacement / noise map
uniform float uHover;        // 0 → 1 eased on enter/leave
uniform vec2  uMouse;        // local uv of cursor
varying vec2  vUv;

void main() {
  float d = texture2D(uDisp, vUv).r;
  vec2 distortion = vec2(d) * uHover * 0.15;     // strength
  // optional: pull toward cursor
  distortion += (uMouse - vUv) * uHover * 0.08;
  vec3 color = texture2D(uTexture, vUv + distortion).rgb;
  gl_FragColor = vec4(color, 1.0);
}
```
Drive `uHover` with GSAP (`gsap.to(uniforms.uHover, {value:1, duration:.8,
ease:"expo.out"})`). RGB-split the channels by slightly different offsets for a
chromatic-aberration glitch flavor.

---

## 4. React Three Fiber (R3F) — the React way

```jsx
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Environment } from "@react-three/drei";
import { useRef } from "react";

function Blob() {
  const ref = useRef();
  useFrame((_, dt) => (ref.current.rotation.y += dt * 0.3));
  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={1.5}>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.4, 64]} />
        <meshStandardMaterial color="#ff4d2e" roughness={0.2} />
      </mesh>
    </Float>
  );
}
export default function Scene() {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 5], fov: 45 }}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={2} />
      <Blob />
      <Environment preset="city" />
    </Canvas>
  );
}
```
`@react-three/drei` gives ready-made helpers: `Float`, `MeshTransmissionMaterial`
(glass), `Environment`, `ScrollControls`/`useScroll` (scroll-driven 3D),
`Text3D`, `Sparkles`, postprocessing. **drei + postprocessing bloom** is most of
the "glowy 3D" look.

---

## 5. WebGL performance & fallback (mandatory)

WebGL can melt phones. Discipline is not optional:

- **Cap `pixelRatio`** at 2 (often 1.5 on mobile). This is the #1 perf lever.
- **Lower geometry detail & disable AA / heavy postprocessing on mobile.**
- **Pause the render loop when offscreen/tab hidden** (`IntersectionObserver`,
  `visibilitychange`) — don't burn GPU on an unseen canvas.
- **Lazy-load** the WebGL bundle; show a static poster image first, upgrade after.
- **Always ship a non-WebGL fallback:** detect support; if absent or
  `prefers-reduced-motion`, render a beautiful static image/gradient instead.
- Keep DOM content real (not baked into the canvas) for a11y & SEO; WebGL is the
  backdrop, not the content.
- Dispose geometries/materials/textures on unmount (R3F does most automatically).

```js
const gl = document.createElement("canvas").getContext("webgl2")
        || document.createElement("canvas").getContext("webgl");
const canUseWebGL = !!gl &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!canUseWebGL) showStaticHero();
```

> Rule: if the WebGL adds a "wow" but the site is unusable on a $200 phone, you
> shipped a demo, not a product. Progressive enhancement always.
