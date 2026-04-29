import { qualify } from "./lib/qualify.js";

const fmtMoney = (n) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function render(mrr) {
  const result = qualify(mrr);

  document.getElementById("current-tier").textContent = result.current.name;
  document.getElementById("current-discount").textContent =
    `${result.cappedDiscount}%`;
  document.getElementById("discount-duration").textContent =
    `${result.durationInMonths} ${result.durationInMonths === 1 ? "mês" : "meses"}`;

  const nextEl = document.getElementById("next-tier");
  if (result.next) {
    const remaining = result.next.thresholdMRR - mrr;
    nextEl.textContent =
      `Faltam ${fmtMoney(Math.max(0, remaining))} para ${result.next.name} (${result.next.discountPct}%)`;
  } else {
    nextEl.textContent = "Você atingiu o tier máximo.";
  }

  document.getElementById("progress-bar").style.width =
    `${Math.round(result.progressToNext * 100)}%`;

  const list = document.getElementById("tier-list");
  list.innerHTML = "";
  for (const tier of result.states) {
    const node = document.createElement("div");
    node.className = "tier";
    node.dataset.state = tier.state;
    node.innerHTML = `
      <div class="tier__name">
        ${tier.name}
        <span class="badge badge--${tier.state}">${labelFor(tier.state)}</span>
      </div>
      <div class="tier__threshold">a partir de ${fmtMoney(tier.thresholdMRR)} MRR</div>
      <div class="tier__discount">${Math.min(tier.discountPct, 50)}%</div>
    `;
    list.appendChild(node);
  }
}

function labelFor(state) {
  if (state === "current") return "Atual";
  if (state === "qualified") return "Liberado";
  return "Bloqueado";
}

const input = document.getElementById("mrr-input");
input.addEventListener("input", (e) => {
  const value = Number(e.target.value) || 0;
  render(value);
});
render(Number(input.value) || 0);
