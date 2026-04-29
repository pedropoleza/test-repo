import { qualify } from "./lib/qualify.js";
import { sampleReferrals } from "./data/sample-referrals.js";

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

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
  "awaiting-both": "Aguardando 30 dias + cupom",
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

function render() {
  const result = qualify(sampleReferrals);

  document.getElementById("level-name").textContent = result.level.name;
  document.getElementById("qualified-count").textContent = result.qualifiedCount;
  document.getElementById("discount-once").textContent = fmtUsd(
    result.discountOnceUsd,
  );
  document.getElementById("discount-monthly").textContent = fmtUsd(
    result.discountMonthlyUsd,
  );
  document.getElementById("return-starter").textContent = fmtUsd(
    result.estimatedReturn.starter,
  );
  document.getElementById("return-medio").textContent = fmtUsd(
    result.estimatedReturn.medio,
  );
  document.getElementById("return-growth").textContent = fmtUsd(
    result.estimatedReturn.growth,
  );
  document.getElementById("premium-flag").hidden = !result.level.premium;

  const nextEl = document.getElementById("next-msg");
  if (result.next) {
    const monthlyJump =
      result.next.discountMonthlyUsd - result.discountMonthlyUsd;
    const onceJump = result.next.discountOnceUsd - result.discountOnceUsd;
    const parts = [];
    if (onceJump > 0) parts.push(`+${fmtUsd(onceJump)} desconto único`);
    if (monthlyJump > 0) parts.push(`+${fmtUsd(monthlyJump)}/mês`);
    const benefit = parts.length ? ` (${parts.join(", ")})` : "";
    nextEl.textContent = `Faltam ${result.referralsToNext} indicação(ões) qualificada(s) para ${result.next.name}${benefit}.`;
  } else {
    nextEl.textContent = "Você atingiu o nível máximo do programa.";
  }

  document.getElementById("progress-bar").style.width =
    `${Math.round(result.progressToNext * 100)}%`;

  const tbody = document.getElementById("referrals-tbody");
  tbody.innerHTML = "";
  for (const r of result.referrals) {
    const tr = document.createElement("tr");
    tr.dataset.status = r.status;
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${fmtDate(r.subaccountAddedAt)}</td>
      <td>${r.couponIssued ? "Emitido" : "Pendente"}</td>
      <td><span class="badge badge--${r.status}">${STATUS_LABEL[r.status]}</span></td>
      <td class="muted">${statusDetail(r)}</td>
    `;
    tbody.appendChild(tr);
  }

  const list = document.getElementById("level-list");
  list.innerHTML = "";
  for (const row of result.rows) {
    if (row.id === "none") continue;
    const node = document.createElement("div");
    node.className = "tier";
    node.dataset.state = row.state;
    if (row.premium) node.dataset.premium = "true";
    const monthly =
      row.discountMonthlyUsd > 0
        ? `${fmtUsd(row.discountMonthlyUsd)}/mês`
        : "—";
    node.innerHTML = `
      <div class="tier__name">
        ${row.name}
        <span class="badge badge--${row.state}">${labelFor(row.state)}</span>
        ${row.premium ? '<span class="badge badge--premium">Premium</span>' : ""}
      </div>
      <div class="tier__threshold">a partir de ${row.minQualifiedReferrals} indicação(ões) qualificada(s)</div>
      <div class="tier__benefits">
        <div><strong>Único:</strong> ${fmtUsd(row.discountOnceUsd)}</div>
        <div><strong>Mensal:</strong> ${monthly}</div>
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

render();
