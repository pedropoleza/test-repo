import { qualify } from "./lib/qualify.js";
import { sampleReferrals } from "./data/sample-referrals.js";
import { levels } from "./config/tiers.js";

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const STATUS_LABEL = {
  qualified: "Qualificada",
  "awaiting-time": "Aguardando 30 dias",
  "awaiting-coupon": "Aguardando cupom",
  "awaiting-both": "Aguardando ciclo",
  "awaiting-subaccount": "Aguardando subaccount",
  invalidated: "Cancelada / inválida",
};

function statusDetail(r) {
  if (r.status === "qualified") return "—";
  if (r.status === "invalidated") return "removida da contagem";
  if (r.status === "awaiting-subaccount") return "subaccount não criada";
  if (r.status === "awaiting-coupon") return "cupom pendente de emissão";
  if (r.status === "awaiting-time" || r.status === "awaiting-both") {
    const days = r.daysUntilQualified;
    return `qualifica em ${days} dia${days === 1 ? "" : "s"}`;
  }
  return "";
}

/* ------------------ Animated number counter ------------------ */

function animateCount(el, to, { prefix = "", duration = 1200 } = {}) {
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const value = from + (to - from) * ease(t);
    el.textContent = `${prefix}${Math.round(value).toLocaleString("en-US")}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ------------------ Reveal-on-scroll ------------------ */

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
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
  );
  targets.forEach((el) => io.observe(el));
}

/* ------------------ Ladder builder ------------------ */

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

  // Compute fill width based on overall progress through the ladder
  const idx = visibleLevels.findIndex((l) => l.id === result.level.id);
  const baseSegment = idx >= 0 ? idx / (visibleLevels.length - 1) : 0;
  const segmentSize = 1 / (visibleLevels.length - 1);
  const segmentProgress = result.next ? result.progressToNext : 1;
  const totalProgress = Math.min(
    1,
    baseSegment + (result.next ? segmentSize * segmentProgress : 0),
  );

  // Animate after a tick so the transition fires
  requestAnimationFrame(() => {
    document.getElementById("ladder-fill").style.width =
      `${Math.round(totalProgress * 100)}%`;
  });

  document.getElementById("ladder-msg").textContent = result.next
    ? `Faltam ${result.referralsToNext} indicação(ões) qualificada(s) para ${result.next.name}`
    : "Você atingiu o nível máximo do programa.";
}

/* ------------------ Bars (returns) ------------------ */

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
      <div class="bar__track">
        <div class="bar__fill" data-tone="${t.key}" style="width: 0%"></div>
      </div>
      <div class="bar__value">${fmtUsd(t.value)}</div>
    `;
    bars.appendChild(row);
    requestAnimationFrame(() => {
      row.querySelector(".bar__fill").style.width =
        `${Math.round((t.value / max) * 100)}%`;
    });
  });
}

/* ------------------ Render ------------------ */

function render() {
  const result = qualify(sampleReferrals);

  // Hero
  document.getElementById("hero-level").textContent = result.level.name;
  document.getElementById("hero-qualified").textContent = result.qualifiedCount;
  document.getElementById("hero-once").textContent = fmtUsd(result.discountOnceUsd);
  document.getElementById("hero-monthly").textContent = fmtUsd(result.discountMonthlyUsd);
  document.getElementById("hero-premium").hidden = !result.level.premium;

  // Stat cards
  animateCount(document.getElementById("stat-qualified"), result.qualifiedCount);
  animateCount(document.getElementById("stat-monthly"), result.discountMonthlyUsd, { prefix: "$" });
  animateCount(document.getElementById("stat-return"), Math.round(result.estimatedReturn.medio), { prefix: "$" });

  document.getElementById("stat-qualified-hint").textContent =
    result.next
      ? `+${result.referralsToNext} para ${result.next.name}`
      : "nível máximo atingido";
  document.getElementById("stat-return-hint").textContent =
    `Starter ${fmtUsd(result.estimatedReturn.starter)} · Growth ${fmtUsd(result.estimatedReturn.growth)}`;

  // Ladder
  buildLadder(result);

  // Referrals table
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

  // Bars
  buildBars(result);

  // Levels grid
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
      <div class="tier__threshold">a partir de ${row.minQualifiedReferrals} indicação(ões) qualificada(s)</div>
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

setupReveal();
render();
