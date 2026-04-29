import { qualify } from "./lib/qualify.js";

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function makeReferrals(qualified, pending, refunded) {
  const out = [];
  for (let i = 0; i < qualified; i++) out.push({ status: "qualified" });
  for (let i = 0; i < pending; i++) out.push({ status: "pending" });
  for (let i = 0; i < refunded; i++)
    out.push({ status: "qualified", refunded: true });
  return out;
}

function read(id) {
  return Number(document.getElementById(id).value) || 0;
}

function render() {
  const referrals = makeReferrals(
    read("qualified-input"),
    read("pending-input"),
    read("refunded-input"),
  );
  const result = qualify(referrals);

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

  const premiumEl = document.getElementById("premium-flag");
  premiumEl.hidden = !result.level.premium;

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

for (const id of ["qualified-input", "pending-input", "refunded-input"]) {
  document.getElementById(id).addEventListener("input", render);
}
render();
