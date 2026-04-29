import { qualify } from "./lib/qualify.js";

const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

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

  document.getElementById("current-discount").textContent = fmtUsd(
    result.discountUsd,
  );
  document.getElementById("applies-to").textContent = result.appliesTo;
  document.getElementById("active-count").textContent = result.activeCount;

  const nextEl = document.getElementById("next-tier");
  if (result.next) {
    const remaining = result.next.activeReferrals - result.activeCount;
    nextEl.textContent =
      `Faltam ${Math.max(0, remaining)} indicado(s) ativo(s) para subir o desconto a ${fmtUsd(result.next.discountUsd)}.`;
  } else {
    nextEl.textContent = "Você atingiu o desconto máximo da tabela atual.";
  }

  document.getElementById("progress-bar").style.width =
    `${Math.round(result.progressToNext * 100)}%`;

  const list = document.getElementById("tier-list");
  list.innerHTML = "";
  for (const row of result.rows) {
    const node = document.createElement("div");
    node.className = "tier";
    node.dataset.state = row.state;
    node.innerHTML = `
      <div class="tier__name">
        ${row.activeReferrals} indicado(s)
        <span class="badge badge--${row.state}">${labelFor(row.state)}</span>
      </div>
      <div class="tier__discount">${fmtUsd(row.discountUsd)}</div>
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
