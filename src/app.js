import { qualify } from "./lib/qualify.js";

function makeReferrals(active, inactive) {
  return [
    ...Array.from({ length: active }, (_, i) => ({
      id: `a${i}`,
      active: true,
    })),
    ...Array.from({ length: inactive }, (_, i) => ({
      id: `i${i}`,
      active: false,
    })),
  ];
}

function render() {
  const active = Number(document.getElementById("active-input").value) || 0;
  const inactive = Number(document.getElementById("inactive-input").value) || 0;
  const result = qualify(makeReferrals(active, inactive));

  document.getElementById("current-tier").textContent = result.current.name;
  document.getElementById("current-discount").textContent =
    `${result.discountPct}%`;
  document.getElementById("applies-to").textContent = result.appliesTo;
  document.getElementById("active-count").textContent = result.activeCount;

  const nextEl = document.getElementById("next-tier");
  if (result.next) {
    const remaining = result.next.minActiveReferrals - result.activeCount;
    nextEl.textContent =
      `Faltam ${Math.max(0, remaining)} indicado(s) ativo(s) para ${result.next.name} (${result.next.discountPct}%).`;
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
      <div class="tier__threshold">
        a partir de ${tier.minActiveReferrals} indicado(s) ativo(s)
      </div>
      <div class="tier__discount">${tier.discountPct}%</div>
    `;
    list.appendChild(node);
  }
}

function labelFor(state) {
  if (state === "current") return "Atual";
  if (state === "qualified") return "Liberado";
  return "Bloqueado";
}

for (const id of ["active-input", "inactive-input"]) {
  document.getElementById(id).addEventListener("input", render);
}
render();
