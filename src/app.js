import { qualify } from "./lib/qualify.js";
import { sampleReferrals } from "./data/sample-referrals.js";
import { levels } from "./config/tiers.js";

/* ============== Formatters ============== */

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtRelative = (d) => {
  const now = new Date();
  const t = new Date(d);
  const diff = Math.floor((now - t) / 86400000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff < 7) return `há ${diff} dias`;
  if (diff < 30) return `há ${Math.floor(diff / 7)} sem`;
  return `há ${Math.floor(diff / 30)} mês${diff < 60 ? "" : "es"}`;
};

const STATUS_LABEL = {
  qualified: "Qualificada",
  "awaiting-time": "Aguardando 30 dias",
  "awaiting-coupon": "Aguardando cupom",
  "awaiting-both": "Aguardando ciclo",
  "awaiting-subaccount": "Aguardando subaccount",
  invalidated: "Cancelada",
};

function statusDetail(r) {
  if (r.status === "qualified") return "—";
  if (r.status === "invalidated") return "removida da contagem";
  if (r.status === "awaiting-coupon") return "cupom pendente de emissão";
  if (r.status === "awaiting-time" || r.status === "awaiting-both")
    return `qualifica em ${r.daysUntilQualified} dia${r.daysUntilQualified === 1 ? "" : "s"}`;
  return "";
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

/* ============== Lottie hover-only ==============
 * Lotties trazem `hover` no markup como hint; aqui interceptamos
 * o hover do container `[data-lottie-hover]` para tocar e parar
 * cada player aninhado. Sem autoplay, sem loop infinito.
 */
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
  // Player web component is loaded with `defer`; wait for it.
  if (customElements.get("lottie-player")) ready();
  else customElements.whenDefined("lottie-player").then(ready);
}

/* ============== Animated counter ============== */

function animateCount(el, to, { prefix = "", duration = 1100 } = {}) {
  const from = Number(el.dataset.value || 0);
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

/* ============== Sparklines (synthetic series) ============== */

function buildSparkPath(values) {
  if (!values.length) return { line: "", area: "" };
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const w = 100, h = 30, pad = 2;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - pad * 2) + pad;
    const y = h - ((v - min) / range) * (h - pad * 2) - pad;
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return { line, area };
}

function renderSpark(svgId, values, gradId) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const { line, area } = buildSparkPath(values);
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${gradId})" />
    <path d="${line}" class="line" />
  `;
}

/* Series synthesized from current state for visual interest. */
function seriesEndingAt(end, points = 12) {
  const out = [];
  let v = Math.max(0, end * 0.4);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const noise = Math.sin(i * 1.3) * (end * 0.06);
    v = end * (0.45 + 0.55 * t) + noise;
    out.push(Math.max(0, v));
  }
  out[out.length - 1] = end;
  return out;
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
}

/* ============== Bars (returns) ============== */

function buildBars(result) {
  const bars = document.getElementById("bars");
  bars.innerHTML = "";
  const tones = [
    { key: "starter", label: "Starter", value: result.estimatedReturn.starter },
    { key: "medio",   label: "Médio",   value: result.estimatedReturn.medio },
    { key: "growth",  label: "Growth",  value: result.estimatedReturn.growth },
  ];
  const max = Math.max(...tones.map((t) => t.value), 1);
  tones.forEach((t) => {
    const row = document.createElement("div");
    row.className = "bar";
    row.innerHTML = `
      <div class="bar__label">${t.label}</div>
      <div class="bar__track"><div class="bar__fill" data-tone="${t.key}" style="width:0%"></div></div>
      <div class="bar__value">${fmtUsd(t.value)}</div>
    `;
    bars.appendChild(row);
    requestAnimationFrame(() => {
      row.querySelector(".bar__fill").style.width = `${Math.round((t.value / max) * 100)}%`;
    });
  });
}

/* ============== Funnel ============== */

function buildFunnel(result) {
  const funnel = document.getElementById("funnel");
  const buckets = {
    qualified: 0,
    waiting: 0,
    invalidated: 0,
  };
  for (const r of result.referrals) {
    if (r.status === "qualified") buckets.qualified++;
    else if (r.status === "invalidated") buckets.invalidated++;
    else buckets.waiting++;
  }
  const total = Math.max(1, result.referrals.length);
  const cells = [
    { label: "Qualificadas", value: buckets.qualified, tone: "info" },
    { label: "Aguardando", value: buckets.waiting, tone: "warn" },
    { label: "Inválidas", value: buckets.invalidated, tone: "danger" },
  ];
  funnel.innerHTML = cells
    .map(
      (c) => `
      <div class="funnel__cell" data-tone="${c.tone}">
        <div class="funnel__label">${c.label}</div>
        <div class="funnel__value">${c.value}</div>
        <div class="funnel__bar"><span style="width:0%"></span></div>
      </div>
    `,
    )
    .join("");
  requestAnimationFrame(() => {
    funnel.querySelectorAll(".funnel__cell").forEach((cell, i) => {
      const pct = (cells[i].value / total) * 100;
      cell.querySelector(".funnel__bar > span").style.width = `${Math.round(pct)}%`;
    });
  });
}

/* ============== Activity feed (synthesized) ============== */

function buildFeed(result) {
  const items = [];
  const qualified = result.referrals.filter((r) => r.status === "qualified");
  const waiting = result.referrals.filter((r) => r.status === "awaiting-time");
  const invalid = result.referrals.filter((r) => r.status === "invalidated");

  if (qualified.length) {
    const r = qualified[qualified.length - 1];
    const qualifiedAt = new Date(r.qualifiesOn || r.subaccountAddedAt);
    items.push({
      tone: "success",
      title: `${r.name} qualificou`,
      sub: `Cupom emitido — desconto liberado no próximo ciclo`,
      time: fmtRelative(qualifiedAt),
      icon: "check",
    });
  }
  if (waiting.length) {
    const r = waiting[0];
    items.push({
      tone: "warn",
      title: `${r.name} entrou no ciclo de qualificação`,
      sub: `Subaccount criada · faltam ${r.daysUntilQualified} dia(s)`,
      time: fmtRelative(r.subaccountAddedAt),
      icon: "clock",
    });
  }
  items.push({
    tone: "info",
    title: `Nível ${result.level.name} ativo`,
    sub: result.next
      ? `Faltam ${result.referralsToNext} para ${result.next.name}`
      : `Nível máximo · multiplicador 1.2x`,
    time: "agora",
    icon: "trophy",
  });
  if (invalid.length) {
    items.push({
      tone: "danger",
      title: `${invalid[0].name} foi removida`,
      sub: "Subaccount cancelada · contagem recalculada",
      time: fmtRelative(invalid[0].subaccountAddedAt),
      icon: "x",
    });
  }

  const ICONS = {
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    trophy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 01-10 0V4z"/><path d="M21 5h-4M3 5h4"/></svg>',
    x:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  const feed = document.getElementById("feed");
  feed.innerHTML = items
    .map(
      (it) => `
      <div class="feed__item" data-tone="${it.tone}">
        <div class="feed__icon">${ICONS[it.icon] || ""}</div>
        <div>
          <div class="feed__title">${it.title}</div>
          <div class="feed__sub">${it.sub}</div>
        </div>
        <div class="feed__time">${it.time}</div>
      </div>
    `,
    )
    .join("");
}

/* ============== Coupons (derived from qualified referrals) ============== */

function buildCoupons(result) {
  const coupons = result.referrals
    .filter((r) => r.status === "qualified" && r.couponIssued)
    .slice(-5)
    .reverse()
    .map((r) => ({
      code: `REF-${r.name.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase()}`,
      name: r.name,
      date: r.qualifiesOn || r.subaccountAddedAt,
      amount: result.discountOnceUsd,
    }));
  const root = document.getElementById("coupons");
  if (!coupons.length) {
    root.innerHTML = `<div class="coupon" style="justify-content:center; color: var(--gray-500);">Nenhum cupom emitido ainda</div>`;
    return;
  }
  root.innerHTML = coupons
    .map(
      (c) => `
      <div class="coupon">
        <span class="coupon__code">${c.code}</span>
        <div>
          <div class="coupon__name">${c.name}</div>
          <div class="coupon__date">emitido ${fmtRelative(c.date)}</div>
        </div>
        <span class="coupon__amt">${fmtUsd(c.amount)}</span>
      </div>
    `,
    )
    .join("");
}

/* ============== Filter chips ============== */

function buildFilters(result) {
  const root = document.getElementById("filters");
  const counts = {
    all: result.referrals.length,
    qualified: result.referrals.filter((r) => r.status === "qualified").length,
    waiting: result.referrals.filter((r) =>
      ["awaiting-time", "awaiting-coupon", "awaiting-both"].includes(r.status),
    ).length,
    invalidated: result.referrals.filter((r) => r.status === "invalidated").length,
  };
  const chips = [
    { id: "all", label: "Todas" },
    { id: "qualified", label: "Qualificadas" },
    { id: "waiting", label: "Aguardando" },
    { id: "invalidated", label: "Inválidas" },
  ];
  root.innerHTML = chips
    .map(
      (c) => `
      <button class="filter-chip ${c.id === "all" ? "is-active" : ""}" data-filter="${c.id}">
        ${c.label} <span class="count">${counts[c.id]}</span>
      </button>
    `,
    )
    .join("");

  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    root.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("is-active"));
    btn.classList.add("is-active");
    applyFilter(btn.dataset.filter, result);
  });
}

function applyFilter(id, result) {
  const tbody = document.getElementById("referrals-tbody");
  tbody.querySelectorAll("tr").forEach((tr) => {
    const s = tr.dataset.status;
    let show = true;
    if (id === "qualified") show = s === "qualified";
    else if (id === "waiting")
      show = ["awaiting-time", "awaiting-coupon", "awaiting-both", "awaiting-subaccount"].includes(s);
    else if (id === "invalidated") show = s === "invalidated";
    tr.style.display = show ? "" : "none";
  });
}

/* ============== Table ============== */

function buildTable(result) {
  const tbody = document.getElementById("referrals-tbody");
  tbody.innerHTML = "";
  for (const r of result.referrals) {
    const tr = document.createElement("tr");
    tr.dataset.status = r.status;
    tr.innerHTML = `
      <td><span class="ref-name">${r.name}</span></td>
      <td>${fmtDate(r.subaccountAddedAt)}</td>
      <td>${r.couponIssued ? "Emitido" : "<span class='muted'>Pendente</span>"}</td>
      <td><span class="badge badge--${r.status}">${STATUS_LABEL[r.status]}</span></td>
      <td class="muted">${statusDetail(r)}</td>
    `;
    tbody.appendChild(tr);
  }
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

/* ============== Render ============== */

function render() {
  const result = qualify(sampleReferrals);

  // Hero
  document.getElementById("hero-level").textContent = result.level.name;
  document.getElementById("hero-qualified").textContent = result.qualifiedCount;
  document.getElementById("hero-once").textContent = fmtUsd(result.discountOnceUsd);
  document.getElementById("hero-monthly").textContent = fmtUsd(result.discountMonthlyUsd);
  document.getElementById("hero-premium-chip").hidden = !result.level.premium;

  // KPIs
  const total = result.referrals.length;
  const qualified = result.qualifiedCount;
  animateCount(document.getElementById("kpi-total"), total);
  animateCount(document.getElementById("kpi-qualified"), qualified);
  animateCount(document.getElementById("kpi-monthly"), result.discountMonthlyUsd, { prefix: "$" });
  animateCount(document.getElementById("kpi-return"), Math.round(result.estimatedReturn.medio), { prefix: "$" });

  document.getElementById("kpi-total-delta").textContent = `${Math.max(1, Math.round(total * 0.18))}`;
  document.getElementById("kpi-qualified-delta").textContent = `${Math.max(1, Math.round(qualified * 0.25))}`;
  document.getElementById("kpi-return-extra").innerHTML =
    `<span class="muted">Starter ${fmtUsd(result.estimatedReturn.starter)} · Growth ${fmtUsd(result.estimatedReturn.growth)}</span>`;

  // Sparklines
  renderSpark("spark-total",     seriesEndingAt(total),                   "g-tot");
  renderSpark("spark-qualified", seriesEndingAt(qualified),               "g-qua");
  renderSpark("spark-monthly",   seriesEndingAt(result.discountMonthlyUsd), "g-mon");
  renderSpark("spark-return",    seriesEndingAt(result.estimatedReturn.medio), "g-ret");

  buildLadder(result);
  buildFeed(result);
  buildFunnel(result);
  buildBars(result);
  buildTable(result);
  buildFilters(result);
  buildCoupons(result);
  buildTierList(result);
}

setupReveal();
setupHoverLotties();
render();
