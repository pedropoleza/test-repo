import { qualify } from "./lib/qualify.js";
import { sampleReferrals } from "./data/sample-referrals.js";
import { levels } from "./config/tiers.js";

/* ============== Source of referrals ==============
 * Em produção, a lista vem de /api/tier (Etapa 2). ?demo=1 força o
 * dataset estático pra demos. Caso o /api/tier falhe (404, 401), o
 * fallback gracioso é uma lista vazia (empty state aparece).
 */
const params = new URLSearchParams(window.location.search);
const isDemoMode = params.get("demo") === "1";
let activeReferrals = []; // mutável; populado em bootstrap()

/* ============== Session (JWT) =============== */

const SESSION_KEY = "indicacoes:session";

function getSession() {
  if (window.__sparkSession) return window.__sparkSession;
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (v) return v;
  } catch {}
  return null;
}

function setSession(token) {
  if (!token) return;
  window.__sparkSession = token;
  try { sessionStorage.setItem(SESSION_KEY, token); } catch {}
}

// Captura ?session=… do redirect pós-OAuth e limpa da URL.
(function captureSessionFromUrl() {
  const s = params.get("session");
  if (!s) return;
  setSession(s);
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    history.replaceState(null, "", url.toString());
  } catch {}
})();

/* ============== Fetch helpers =============== */

async function fetchTier(locationId) {
  const session = getSession();
  if (!session) throw new Error("no_session");
  const r = await fetch(`/api/tier?locationId=${encodeURIComponent(locationId)}`, {
    headers: { "x-spark-session": session },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`tier_${r.status}: ${body.slice(0, 120)}`);
  }
  return r.json();
}

async function loadReferrals(locationId) {
  if (isDemoMode) return sampleReferrals;
  if (!locationId || locationId === "loc_placeholder" || locationId === "loc_unknown") {
    return [];
  }
  try {
    const data = await fetchTier(locationId);
    return Array.isArray(data?.referrals) ? data.referrals : [];
  } catch (err) {
    console.warn("[tier] fetch falhou, fallback empty:", err?.message || err);
    return [];
  }
}

/* ============== Helpers ============== */

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const $ = (id) => document.getElementById(id);

/* ============== Toasts ============== */

const ICON = { success: "✓", info: "i", warn: "!" };

function toast({ title, sub, tone = "info", duration = 3200 } = {}) {
  const root = $("toasts");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast toast--${tone}`;
  el.innerHTML = `
    <span class="toast__icon">${ICON[tone] || "•"}</span>
    <div>
      <div class="toast__title">${title || ""}</div>
      ${sub ? `<div class="toast__sub">${sub}</div>` : ""}
    </div>
  `;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 260);
  }, duration);
}

/* ============== Confetti ============== */

function fireConfetti() {
  if (typeof confetti !== "function") return;
  const defaults = {
    spread: 80,
    ticks: 80,
    gravity: 0.9,
    decay: 0.92,
    startVelocity: 35,
    colors: ["#155EEF", "#6366f1", "#22c55e", "#f59e0b", "#06b6d4"],
  };
  confetti({ ...defaults, particleCount: 60, origin: { y: 0.3, x: 0.45 } });
  setTimeout(() => confetti({ ...defaults, particleCount: 40, origin: { y: 0.4, x: 0.55 } }), 180);
  setTimeout(() => confetti({ ...defaults, particleCount: 50, origin: { y: 0.35, x: 0.50 } }), 360);
}

/* ============== Tooltip portal (single instance, body-mounted) ============== */

function setupTooltips() {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let active = null;

  function position(el) {
    const r = el.getBoundingClientRect();
    const tipR = tip.getBoundingClientRect();
    const cx = r.left + r.width / 2;

    // Decide above/below based on available space.
    const spaceAbove = r.top;
    const below = spaceAbove < tipR.height + 16;

    tip.classList.toggle("is-below", below);
    tip.style.left = `${cx}px`;
    tip.style.top = below ? `${r.bottom}px` : `${r.top}px`;
  }

  function show(el) {
    const text = el.dataset.tip;
    if (!text) return;
    tip.textContent = text;
    tip.classList.add("is-visible");
    active = el;
    requestAnimationFrame(() => position(el));
  }
  function hide() {
    tip.classList.remove("is-visible");
    active = null;
  }

  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t && t !== active) show(t);
  });
  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t && active === t && !t.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t) show(t);
  });
  document.addEventListener("focusout", () => hide());
  window.addEventListener("scroll", () => active && position(active), true);
  window.addEventListener("resize", () => active && position(active));
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

/* ============== Tabs (sliding indicator) ============== */

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  const indicator = $("tabs-indicator");

  function moveIndicator(activeTab) {
    if (!indicator || !activeTab) return;
    const r = activeTab.getBoundingClientRect();
    const parent = activeTab.parentElement.getBoundingClientRect();
    indicator.style.transform = `translateX(${r.left - parent.left}px)`;
    indicator.style.width = `${r.width}px`;
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      panels.forEach((p) => {
        p.hidden = p.dataset.panel !== tab.dataset.tab;
      });
      moveIndicator(tab);
    });
  });

  // Initial position (after fonts/layout settle)
  requestAnimationFrame(() => {
    moveIndicator(document.querySelector(".tab.is-active"));
  });
  window.addEventListener("resize", () => {
    moveIndicator(document.querySelector(".tab.is-active"));
  });
}

/* ============== Hover-only lotties ============== */

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
        players.forEach((p) => { try { p.setLooping?.(true); p.play?.(); } catch {} });
      });
      host.addEventListener("mouseleave", () => {
        players.forEach((p) => { try { p.stop?.(); } catch {} });
      });
    });
  };
  if (customElements.get("lottie-player")) ready();
  else customElements.whenDefined("lottie-player").then(ready);
}

/* ============== Animated counter ============== */

function animateCount(el, to, { prefix = "", duration = 900 } = {}) {
  if (!el) return;
  const from = Number(el.dataset.value || 0);
  if (from === to) {
    el.textContent = `${prefix}${Math.round(to).toLocaleString("en-US")}`;
    return;
  }
  el.dataset.value = String(to);
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const value = from + (to - from) * ease(t);
    el.textContent = `${prefix}${Math.round(value).toLocaleString("en-US")}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ============== Location + Coupon ============== */

/**
 * Pede o contexto do usuário ao parent via postMessage (handshake
 * documentado pela GHL para Custom Page apps em iframe). O parent
 * responde com `REQUEST_USER_DATA_RESPONSE` cujo `payload` é uma
 * string criptografada (crypto-js AES) com o Shared Secret Key.
 * Mandamos pro backend decodificar e retornar os campos normalizados.
 */
function requestGhlContext(timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", handler);
      clearTimeout(timer);
      fn(arg);
    };

    const handler = async (e) => {
      const data = e?.data;
      if (!data || typeof data !== "object") return;
      if (data.message !== "REQUEST_USER_DATA_RESPONSE") return;
      try {
        const r = await fetch("/api/auth/ghl-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encrypted: data.payload }),
        });
        if (!r.ok) throw new Error(`http_${r.status}`);
        finish(resolve, await r.json());
      } catch (err) {
        finish(reject, err);
      }
    };

    window.addEventListener("message", handler);
    const timer = setTimeout(
      () => finish(reject, new Error("ghl_iframe_timeout")),
      timeoutMs,
    );
    try {
      window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
    } catch (err) {
      finish(reject, err);
    }
  });
}

/**
 * Trata strings tipo "{{location.id}}" (placeholders Liquid não
 * substituídos pelo GHL) como ausência de valor.
 */
function cleanParam(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.startsWith("{{") && s.endsWith("}}")) return null;
  if (s === "undefined" || s === "null") return null;
  return s;
}

const LOC_CACHE_KEY = "indicacoes:lastLocation";

function readCachedLocation() {
  try {
    const raw = localStorage.getItem(LOC_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.id && obj.name) return obj;
  } catch {}
  return null;
}

function writeCachedLocation(loc) {
  try { localStorage.setItem(LOC_CACHE_KEY, JSON.stringify(loc)); } catch {}
}

/**
 * Resolve a location atual. Ordem de fontes (mais autoritativa primeiro):
 *   1. Iframe SSO via postMessage — verdade vinda do GHL
 *   2. Query string — locationId/Name explícitos na URL
 *   3. Cache do localStorage — última location vista neste browser
 *   4. Placeholder "Sparkleads" — último recurso (acesso direto inicial)
 */
async function getLocation() {
  // 1) Iframe SSO
  if (window.parent && window.parent !== window) {
    try {
      const ctx = await requestGhlContext();
      if (ctx && (ctx.locationName || ctx.locationId)) {
        if (ctx.sessionToken) window.__sparkSession = ctx.sessionToken;
        console.info("[location] iframe SSO →", ctx.locationName, ctx.locationId);
        const loc = {
          source: "iframe-sso",
          name: ctx.locationName || "Location",
          id: ctx.locationId || "loc_unknown",
          userId: ctx.userId,
          userName: ctx.userName,
          email: ctx.email,
        };
        writeCachedLocation(loc);
        return loc;
      }
    } catch (err) {
      console.warn("[location] iframe SSO fallback:", err?.message || err);
    }
  }

  // 2) Query string (incluindo location_id auto-injetado pelo GHL Custom Menu Link)
  const p = new URLSearchParams(window.location.search);
  const urlName =
    cleanParam(p.get("locationName")) ||
    cleanParam(p.get("companyName")) ||
    cleanParam(p.get("name"));
  const urlId =
    cleanParam(p.get("locationId")) ||
    cleanParam(p.get("location_id")) ||
    cleanParam(p.get("id"));
  if (urlId || urlName) {
    const loc = {
      source: "url",
      name: urlName || "Location",
      id: urlId || "loc_unknown",
    };
    console.info("[location] url →", loc.name, loc.id);
    writeCachedLocation(loc);
    return loc;
  }

  // 3) Cache do localStorage
  const cached = readCachedLocation();
  if (cached) {
    console.info("[location] cache →", cached.name, cached.id);
    return { ...cached, source: "cache" };
  }

  // 4) Fallback total
  console.info("[location] placeholder fallback");
  return { source: "placeholder", name: "Sparkleads", id: "loc_placeholder" };
}

function deriveCoupon(name) {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const slug = first.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return slug ? `${slug}OFF` : "—";
}

// Estado atual, exposto para outros módulos via window.__sparkLocation
let currentLocation = null;

async function applyLocationAndCoupon() {
  const loc = await getLocation();
  const code = deriveCoupon(loc.name);
  currentLocation = loc;
  window.__sparkLocation = loc;

  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  setText("location-name", loc.name);
  setText("settings-location", loc.name);
  setText("coupon-code", code);
  setText("coupon-company", loc.name);
  setText("settings-coupon", code);

  // Tooltip do pill mostra id + fonte (iframe-sso / url / cache)
  const pill = $("location-pill");
  if (pill) {
    pill.dataset.tip =
      `Location ID: ${loc.id}` +
      (loc.source ? ` · fonte: ${loc.source}` : "");
  }

  // Drop skeleton classes once data is in
  document
    .querySelectorAll(".skeleton")
    .forEach((el) => el.classList.remove("skeleton"));

  const heroBtn = $("coupon-copy");
  const setBtn = $("settings-coupon-copy");
  if (heroBtn) heroBtn.dataset.code = code;
  if (setBtn) setBtn.dataset.code = code;
  $("share-code") && ($("share-code").textContent = code);
  return { loc, code };
}

async function copyCode(code, btn, label) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast({ title: "Cupom copiado!", sub: code, tone: "success" });
  if (btn) {
    btn.classList.add("is-copied");
    if (label) {
      const original = label.textContent;
      label.textContent = "Copiado!";
      setTimeout(() => { label.textContent = original; btn.classList.remove("is-copied"); }, 1400);
    } else {
      const original = btn.textContent;
      btn.textContent = "copiado!";
      setTimeout(() => { btn.textContent = original; btn.classList.remove("is-copied"); }, 1400);
    }
  }
}

/* ============== Share modal ============== */

function shareLinkFor(code) {
  // Replace with the public landing once it exists.
  return `https://app.gohighlevel.com/?coupon=${encodeURIComponent(code)}`;
}

function shareTextFor(code) {
  return `Use o cupom ${code} pra ganhar desconto na sua subaccount GoHighLevel.`;
}

function setupShare() {
  const modal = $("share-modal");
  const open = () => {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  };
  const close = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    $("qr-area").hidden = true;
  };

  $("coupon-share")?.addEventListener("click", open);
  $("empty-share")?.addEventListener("click", open);
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });

  $("share-whatsapp")?.addEventListener("click", () => {
    const code = $("coupon-copy").dataset.code;
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareTextFor(code)} ${shareLinkFor(code)}`)}`;
    window.open(url, "_blank", "noopener");
  });
  $("share-email")?.addEventListener("click", () => {
    const code = $("coupon-copy").dataset.code;
    const subject = encodeURIComponent("Cupom de desconto GoHighLevel");
    const body = encodeURIComponent(`${shareTextFor(code)}\n\n${shareLinkFor(code)}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
  $("share-link")?.addEventListener("click", async (e) => {
    const code = $("coupon-copy").dataset.code;
    await copyCode(shareLinkFor(code), e.currentTarget);
  });
  $("share-qr")?.addEventListener("click", () => {
    const code = $("coupon-copy").dataset.code;
    const url = shareLinkFor(code);
    const img = $("qr-img");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(url)}`;
    $("qr-area").hidden = false;
  });
}

/* ============== Email notifications (preferences) ============== */

// Storage helpers chaveados por locationId — cada location tem suas
// preferências e estado próprios neste browser.
function locKey(suffix) {
  const id = (currentLocation && currentLocation.id) || "loc_placeholder";
  return `indicacoes:${id}:${suffix}`;
}

function setupNotifPrefs() {
  const ids = ["notif-qualified", "notif-levelup", "notif-cancelled"];
  // Inicializa após location resolver — chamado de novo no fim do bootstrap.
  function hydrate() {
    const stored = JSON.parse(localStorage.getItem(locKey("notifs")) || "{}");
    ids.forEach((id) => {
      const cb = $(id);
      if (!cb) return;
      if (id in stored) cb.checked = !!stored[id];
    });
  }
  ids.forEach((id) => {
    const cb = $(id);
    if (!cb) return;
    cb.addEventListener("change", () => {
      const key = locKey("notifs");
      const next = { ...JSON.parse(localStorage.getItem(key) || "{}"), [id]: cb.checked };
      localStorage.setItem(key, JSON.stringify(next));
      toast({ title: "Preferência salva", tone: "success" });
    });
  });
  window.__sparkHydrateNotifs = hydrate;
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
  const prize = $("hero-prize");
  if (art) art.dataset.level = level.id;
  if (prize) prize.textContent = PRIZE_BY_LEVEL[level.id] || PRIZE_BY_LEVEL.none;
}

/* ============== Progress ring ============== */

const RING_CIRCUMFERENCE = 2 * Math.PI * 46; // r=46 in viewBox 100

function renderRing(progress01) {
  const ring = $("ring-fg");
  const pct = $("ring-pct");
  if (!ring) return;
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress01)));
  ring.style.strokeDashoffset = String(offset);
  if (pct) pct.textContent = `${Math.round(progress01 * 100)}%`;
}

/* ============== Ladder ============== */

function buildLadder(result) {
  const container = $("ladder-nodes");
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
    $("ladder-fill").style.width = `${Math.round(totalProgress * 100)}%`;
  });

  $("ladder-msg").innerHTML = result.next
    ? `Faltam <strong>${result.referralsToNext}</strong> indicação(ões) qualificada(s) para <strong>${result.next.name}</strong>`
    : `Você atingiu o nível máximo do programa.`;
}

/* ============== Tier list ============== */

function buildTierList(result) {
  const list = $("level-list");
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

/* ============== Achievements / Badges ============== */

const BADGES = [
  { id: "first",    icon: "🎯", name: "Primeiro indicado",   desc: "Sua primeira indicação qualificada", needs: (r) => r.qualifiedCount >= 1 },
  { id: "trio",     icon: "🥈", name: "Trio formado",        desc: "Atingiu 3 indicações qualificadas",  needs: (r) => r.qualifiedCount >= 3 },
  { id: "monthly",  icon: "💸", name: "Recorrente",          desc: "Desbloqueou desconto mensal",        needs: (r) => r.discountMonthlyUsd > 0 },
  { id: "ten",      icon: "🏆", name: "10 indicações",       desc: "Chegou ao topo da tabela",           needs: (r) => r.qualifiedCount >= 10, tone: "amber" },
  { id: "year",     icon: "🎖️", name: "1 ano no programa",   desc: "Membro ativo há 12 meses",           needs: () => false /* TODO: usar memberSince do GHL */ },
  { id: "share",    icon: "📣", name: "Divulgador",          desc: "Compartilhou o cupom",               needs: () => !!localStorage.getItem(locKey("shared")) },
];

function buildBadges(result) {
  const root = $("badges");
  root.innerHTML = "";
  for (const b of BADGES) {
    const unlocked = !!b.needs(result);
    const node = document.createElement("span");
    node.className = "badge-pill";
    node.dataset.unlocked = unlocked ? "true" : "false";
    if (b.tone) node.dataset.tone = b.tone;
    node.dataset.tip = `${b.name} — ${b.desc}${unlocked ? "" : " (bloqueada)"}`;
    node.textContent = b.icon;
    root.appendChild(node);
  }
}

/* ============== Render + Skeleton phase ============== */

let lastLevelId = null;
let historyFilter = "all"; // 'all' | 'qualified' | 'awaiting' | 'invalidated'

/* ============== History tab ============== */

const HISTORY_STATUS_LABEL = {
  qualified: "Qualificada",
  "awaiting-time": "Aguardando 30 dias",
  "awaiting-coupon": "Aguardando cupom",
  "awaiting-both": "Aguardando ciclo",
  "awaiting-subaccount": "Aguardando subaccount",
  invalidated: "Inválida",
};

function fmtDateBR(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtRelativePast(d) {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem`;
  if (days < 365) return `há ${Math.floor(days / 30)} mês${days < 60 ? "" : "es"}`;
  return `há ${Math.floor(days / 365)} ano(s)`;
}

function statusDetail(r) {
  if (r.status === "qualified") return fmtRelativePast(r.qualifiesOn || r.subaccountAddedAt);
  if (r.status === "invalidated") return "removida da contagem";
  if (r.status === "awaiting-coupon") return "cupom pendente de emissão";
  if (r.status === "awaiting-subaccount") return "subaccount não criada";
  if (r.status === "awaiting-time" || r.status === "awaiting-both") {
    const d = r.daysUntilQualified;
    if (typeof d === "number") {
      return `<span class="countdown">qualifica em ${d} dia${d === 1 ? "" : "s"}</span>`;
    }
  }
  return "—";
}

function buildHistoryFilters(result) {
  const root = $("history-filters");
  if (!root) return;
  const counts = {
    all: result.referrals.length,
    qualified: result.referrals.filter((r) => r.status === "qualified").length,
    awaiting: result.referrals.filter((r) =>
      ["awaiting-time", "awaiting-coupon", "awaiting-both", "awaiting-subaccount"].includes(r.status),
    ).length,
    invalidated: result.referrals.filter((r) => r.status === "invalidated").length,
  };
  const chips = [
    { id: "all",         label: "Todas" },
    { id: "qualified",   label: "Qualificadas" },
    { id: "awaiting",    label: "Aguardando" },
    { id: "invalidated", label: "Inválidas" },
  ];
  root.innerHTML = chips
    .map(
      (c) => `
      <button class="filter-chip ${c.id === historyFilter ? "is-active" : ""}" data-filter="${c.id}">
        ${c.label} <span class="count">${counts[c.id]}</span>
      </button>`,
    )
    .join("");
}

function buildHistoryTable(result) {
  const tbody = $("history-tbody");
  const empty = $("history-empty");
  const wrap = $("history-table");
  if (!tbody) return;

  if (!result.referrals.length) {
    empty.hidden = false;
    if (wrap) wrap.style.display = "none";
    tbody.innerHTML = "";
    return;
  }
  empty.hidden = true;
  if (wrap) wrap.style.display = "";

  const rows = result.referrals.filter((r) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "qualified") return r.status === "qualified";
    if (historyFilter === "awaiting")
      return ["awaiting-time", "awaiting-coupon", "awaiting-both", "awaiting-subaccount"].includes(r.status);
    if (historyFilter === "invalidated") return r.status === "invalidated";
    return true;
  });

  tbody.innerHTML = rows
    .map((r) => `
      <tr data-status="${r.status}">
        <td><span class="ref-name">${escapeHtml(r.name || "Indicação")}</span></td>
        <td>${fmtDateBR(r.subaccountAddedAt)}</td>
        <td><span class="badge badge--${r.status}">${HISTORY_STATUS_LABEL[r.status] || r.status}</span></td>
        <td class="muted">${statusDetail(r)}</td>
      </tr>`)
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHistory(result) {
  buildHistoryFilters(result);
  buildHistoryTable(result);
}

function setupHistoryFilters() {
  const root = $("history-filters");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    historyFilter = btn.dataset.filter;
    // Re-render: precisa do result atual; usa qualify(activeReferrals).
    buildHistory(qualify(activeReferrals));
  });
}

function countPending(result) {
  return (result.referrals || []).filter((r) =>
    ["awaiting-time", "awaiting-coupon", "awaiting-both"].includes(r.status),
  ).length;
}

function renderEmpty(result) {
  const pending = countPending(result);
  const empty = $("empty-state");
  if (result.qualifiedCount > 0) {
    empty.hidden = true;
    return;
  }
  empty.hidden = false;

  // Estado vazio com diferenciação: tem alguém esperando? ainda
  // não chegou ninguém?
  const art = $("empty-state-art");
  const title = $("empty-state-title");
  const sub = $("empty-state-sub");
  if (pending > 0) {
    if (art) art.textContent = "⏳";
    if (title) title.textContent =
      `${pending} indicação${pending === 1 ? "" : "ões"} aguardando o ciclo de 30 dias`;
    if (sub) sub.innerHTML =
      "Boas notícias: você já tem indicações no caminho. Elas viram " +
      "<strong>qualificadas</strong> automaticamente após 30 dias do primeiro " +
      "pagamento confirmado. Continue compartilhando seu cupom.";
  } else {
    if (art) art.textContent = "🎉";
    if (title) title.textContent = "Você ainda não tem indicações qualificadas";
    if (sub) sub.innerHTML =
      "Compartilhe seu cupom para começar. A primeira indicação já libera " +
      "<strong>$30 de desconto único</strong>.";
  }
}

function render() {
  const result = qualify(activeReferrals);

  $("hero-level").textContent = result.level.name;

  // Animated count-up on hero numbers
  animateCount($("hero-qualified"), result.qualifiedCount);

  const pending = countPending(result);
  const pendWrap = $("hero-pending-wrap");
  if (pendWrap) pendWrap.hidden = pending === 0;
  animateCount($("hero-pending"), pending);

  // Animated count-up for currency-prefixed values
  const onceEl = $("hero-once");
  const monthlyEl = $("hero-monthly");
  const fromOnce = Number(onceEl.dataset.value || 0);
  const fromMon  = Number(monthlyEl.dataset.value || 0);
  const animUsd = (el, from, to) => {
    el.dataset.value = String(to);
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) {
      const t = Math.min(1, (now - start) / 900);
      const v = from + (to - from) * ease(t);
      el.textContent = fmtUsd(v);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };
  animUsd(onceEl, fromOnce, result.discountOnceUsd);
  animUsd(monthlyEl, fromMon, result.discountMonthlyUsd);

  $("hero-premium-chip").hidden = !result.level.premium;

  renderPrize(result.level);
  renderRing(result.progressToNext);
  buildLadder(result);
  buildTierList(result);
  buildBadges(result);
  renderEmpty(result);
  buildHistory(result);

  // Level-up detection
  if (lastLevelId !== null && result.level.id !== lastLevelId && result.level.id !== "none") {
    fireConfetti();
    toast({
      title: `Você desbloqueou ${result.level.name}!`,
      sub: result.discountMonthlyUsd > 0
        ? `Novo desconto: ${fmtUsd(result.discountMonthlyUsd)}/mês`
        : `Desconto único de ${fmtUsd(result.discountOnceUsd)} liberado`,
      tone: "success",
      duration: 5000,
    });
  }
  lastLevelId = result.level.id;
}

async function bootstrap() {
  // Baseline counters so animateCount has a from-value to animate from.
  $("hero-once").dataset.value = "0";
  $("hero-monthly").dataset.value = "0";
  $("hero-qualified").dataset.value = "0";
  $("hero-once").textContent = "$0";
  $("hero-monthly").textContent = "$0";
  $("hero-qualified").textContent = "0";

  // Iframe SSO has its own latency (postMessage round-trip + decrypt
  // backend call). The skeleton stays visible until applyLocation
  // resolves; not a fixed delay.
  try {
    await applyLocationAndCoupon();
  } catch (err) {
    console.error("[bootstrap] location load failed:", err);
  }
  // Re-hidrata preferências chaveadas por locationId, após a location resolver
  if (typeof window.__sparkHydrateNotifs === "function") {
    window.__sparkHydrateNotifs();
  }
  // Carrega referrals reais (ou sample em ?demo=1)
  try {
    activeReferrals = await loadReferrals(currentLocation?.id);
  } catch (err) {
    console.error("[bootstrap] referrals load failed:", err);
    activeReferrals = [];
  }
  lastLevelId = "none"; // baseline so first render fires confetti
  render();
}

/* ============== Boot ============== */

setupTabs();
setupHistoryFilters();
setupReveal();
setupTooltips();
setupHoverLotties();
setupNotifPrefs();
setupShare();

// Wire copy buttons (handlers persist; data-code is updated when data loads)
$("coupon-copy")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.code) copyCode(btn.dataset.code, btn, $("coupon-copy-label"));
});
$("settings-coupon-copy")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.code) copyCode(btn.dataset.code, btn);
});

// Mark "share" badge as earned when modal opens (per-location)
$("coupon-share")?.addEventListener("click", () => {
  localStorage.setItem(locKey("shared"), "1");
});

bootstrap();
