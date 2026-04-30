import { qualify } from "./lib/qualify.js";
import { sampleReferrals } from "./data/sample-referrals.js";
import { levels } from "./config/tiers.js";

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/* ============== Tabs ============== */

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      panels.forEach((p) => {
        p.hidden = p.dataset.panel !== tab.dataset.tab;
      });
    });
  });
}

/* ============== Reveal-on-scroll ============== */

function setupReveal() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  targets.forEach((el) => io.observe(el));
}

/* ============== Lottie hover-only ============== */

function setupHoverLotties() {
  const ready = () => {
    document.querySelectorAll("[data-lottie-hover]").forEach((host) => {
      const players = host.querySelectorAll("lottie-player");
      players.forEach((p) => {
        try { p.stop?.(); } catch {}
        p.removeAttribute("autoplay");
        p.removeAttribute("loop");
      });
      host.addEventListener("mouseenter", () => {
        players.forEach((p) => {
          try { p.setLooping?.(true); p.play?.(); } catch {}
        });
      });
      host.addEventListener("mouseleave", () => {
        players.forEach((p) => {
          try { p.stop?.(); } catch {}
        });
      });
    });
  };
  if (customElements.get("lottie-player")) ready();
  else customElements.whenDefined("lottie-player").then(ready);
}

/* ============== Ladder ============== */

function buildLadder(result) {
  const container = document.getElementById("ladder-nodes");
  container.innerHTML = "";
  const visibleLevels = levels.filter((l) => l.id !== "none");

  for (const level of visibleLevels) {
    const state =
      level.id === result.level.id
        ? "current"
        : result.qualifiedCount >= level.minQualifiedReferrals
          ? "qualified"
          : "locked";
    const node = document.createElement("div");
    node.className = "ladder__node";
    node.dataset.state = state;
    node.innerHTML = `
      <div class="ladder__dot"></div>
      <div class="ladder__label">${level.name}</div>
      <div class="ladder__sub">${level.minQualifiedReferrals}+ ind.</div>
    `;
    container.appendChild(node);
  }

  const idx = visibleLevels.findIndex((l) => l.id === result.level.id);
  const baseSegment = idx >= 0 ? idx / (visibleLevels.length - 1) : 0;
  const segmentSize = 1 / (visibleLevels.length - 1);
  const totalProgress = Math.min(
    1,
    baseSegment + (result.next ? segmentSize * result.progressToNext : 0),
  );
  requestAnimationFrame(() => {
    document.getElementById("ladder-fill").style.width = `${Math.round(totalProgress * 100)}%`;
  });

  document.getElementById("ladder-msg").innerHTML = result.next
    ? `Faltam <strong>${result.referralsToNext}</strong> indicação(ões) qualificada(s) para <strong>${result.next.name}</strong>`
    : `Você atingiu o nível máximo do programa.`;
}

/* ============== Tier list ============== */

function buildTierList(result) {
  const list = document.getElementById("level-list");
  list.innerHTML = "";
  for (const row of result.rows) {
    if (row.id === "none") continue;
    const node = document.createElement("div");
    node.className = "tier";
    node.dataset.state = row.state;
    if (row.premium) node.dataset.premium = "true";
    const monthly =
      row.discountMonthlyUsd > 0 ? `${fmtUsd(row.discountMonthlyUsd)}/mês` : "—";
    node.innerHTML = `
      <div class="tier__name">
        ${row.name}
        <span class="badge badge--${row.state}">${labelFor(row.state)}</span>
        ${row.premium ? '<span class="badge badge--premium">Premium</span>' : ""}
      </div>
      <div class="tier__threshold">${row.minQualifiedReferrals}+ indicação(ões) qualificada(s)</div>
      <div class="tier__benefits">
        <div><strong>Único</strong><span>${fmtUsd(row.discountOnceUsd)}</span></div>
        <div><strong>Mensal</strong><span>${monthly}</span></div>
      </div>
    `;
    list.appendChild(node);
  }
}

function labelFor(state) {
  if (state === "current") return "Atual";
  if (state === "qualified") return "Liberado";
  return "Bloqueado";
}

/* ============== Location + Coupon ==============
 * Location vem do contexto GHL (iframe SSO). Até a integração entrar,
 * usamos um placeholder. Trocar `getLocation()` para a chamada real.
 *
 * Cupom = primeiro nome da location + "OFF".
 *   "Sparkleads Marketing" -> "SPARKLEADSOFF".
 */

function getLocation() {
  // TODO(integração GHL): substituir por dados do SSO/iframe.
  return { name: "Sparkleads", id: "loc_placeholder" };
}

function deriveCoupon(name) {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const slug = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return slug ? `${slug}OFF` : "—";
}

function applyLocationAndCoupon() {
  const loc = getLocation();
  const code = deriveCoupon(loc.name);

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("location-name", loc.name);
  set("settings-location", loc.name);
  set("coupon-code", code);
  set("coupon-company", loc.name);
  set("settings-coupon", code);

  const heroBtn = document.getElementById("coupon-copy");
  const setBtn = document.getElementById("settings-coupon-copy");
  if (heroBtn) heroBtn.dataset.code = code;
  if (setBtn) setBtn.dataset.code = code;
}

async function copyCode(code, btn, label) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Fallback for blocked clipboard
    const ta = document.createElement("textarea");
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  if (btn) {
    btn.classList.add("is-copied");
    if (label) {
      const original = label.textContent;
      label.textContent = "Copiado!";
      setTimeout(() => {
        label.textContent = original;
        btn.classList.remove("is-copied");
      }, 1400);
    } else {
      const original = btn.textContent;
      btn.textContent = "copiado!";
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("is-copied");
      }, 1400);
    }
  }
}

function setupCoupon() {
  applyLocationAndCoupon();

  document.getElementById("coupon-copy")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    copyCode(btn.dataset.code, btn, document.getElementById("coupon-copy-label"));
  });
  document.getElementById("settings-coupon-copy")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    copyCode(btn.dataset.code, btn);
  });
}

/* ============== Prize per level ============== */

const PRIZE_BY_LEVEL = {
  none:             "🎯",
  iniciante:        "🥉",
  basico:           "🥈",
  intermediario:    "🥇",
  avancado:         "🏆",
  "muito-avancado": "👑",
};

function renderPrize(level) {
  const art = document.querySelector(".hero-level__art");
  const prize = document.getElementById("hero-prize");
  if (art) art.dataset.level = level.id;
  if (prize) prize.textContent = PRIZE_BY_LEVEL[level.id] || PRIZE_BY_LEVEL.none;
}

/* ============== Mouse spotlight on cards ============== */

function setupSpotlight() {
  const targets = document.querySelectorAll(".card, .coupon-card, .tier, .hero-level");
  targets.forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    });
  });
}

/* ============== Render ============== */

function render() {
  const result = qualify(sampleReferrals);

  document.getElementById("hero-level").textContent = result.level.name;
  document.getElementById("hero-qualified").textContent = result.qualifiedCount;
  document.getElementById("hero-once").textContent = fmtUsd(result.discountOnceUsd);
  document.getElementById("hero-monthly").textContent = fmtUsd(result.discountMonthlyUsd);
  document.getElementById("hero-premium-chip").hidden = !result.level.premium;

  renderPrize(result.level);
  buildLadder(result);
  buildTierList(result);
}

setupTabs();
setupReveal();
setupHoverLotties();
setupCoupon();
render();
setupSpotlight();
