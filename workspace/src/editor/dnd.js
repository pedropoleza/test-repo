/**
 * Drag and drop com indicador de destino (§11).
 *
 * Um único módulo serve blocos e a árvore da sidebar: as duas listas têm
 * a mesma semântica — soltar antes, depois ou dentro de um item. O
 * resultado é sempre expresso em vizinhos (`before`/`after`/`inside`),
 * nunca em índice absoluto: quem calcula a posição é o servidor, com
 * fractional indexing.
 */

const NEST_THRESHOLD_PX = 36;

export function initDnd(root, {
  itemSelector,
  handleSelector,
  allowNest = () => false,
  isDescendant = () => false,
  onDrop,
}) {
  let draggingId = null;
  let indicator = null;
  let lastTarget = null;

  function ensureIndicator() {
    if (indicator) return indicator;
    indicator = document.createElement("div");
    indicator.className = "ws-drop-indicator";
    document.body.appendChild(indicator);
    return indicator;
  }

  function clearIndicator() {
    indicator?.remove();
    indicator = null;
    lastTarget?.classList.remove("is-drop-inside");
    lastTarget = null;
  }

  function idOf(el) {
    return el?.dataset?.blockId || el?.dataset?.pageId || null;
  }

  root.addEventListener("dragstart", (event) => {
    const handle = event.target.closest?.(handleSelector);
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    draggingId = idOf(item);
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    // Firefox exige payload para iniciar o arrasto.
    event.dataTransfer.setData("text/plain", draggingId || "");
  });

  root.addEventListener("dragend", () => {
    root.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
    draggingId = null;
    clearIndicator();
  });

  root.addEventListener("dragover", (event) => {
    if (!draggingId) return;
    const item = event.target.closest?.(itemSelector);
    if (!item) return;

    const targetId = idOf(item);
    if (!targetId || targetId === draggingId || isDescendant(targetId, draggingId)) {
      clearIndicator();
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const rect = item.getBoundingClientRect();
    const place = placementFor(event, rect, targetId);
    item.dataset.dropPlace = place;

    lastTarget?.classList.remove("is-drop-inside");
    lastTarget = item;

    const line = ensureIndicator();
    if (place === "inside") {
      item.classList.add("is-drop-inside");
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.style.width = `${rect.width}px`;
    line.style.left = `${rect.left}px`;
    line.style.top = `${place === "before" ? rect.top : rect.bottom}px`;
  });

  function placementFor(event, rect, targetId) {
    const offsetY = event.clientY - rect.top;
    const nestable = allowNest(targetId);
    // Recuo horizontal grande = intenção de aninhar (mesma convenção do
    // Tab no editor).
    if (nestable && event.clientX - rect.left > NEST_THRESHOLD_PX && offsetY > rect.height * 0.25) {
      return "inside";
    }
    return offsetY < rect.height / 2 ? "before" : "after";
  }

  root.addEventListener("drop", (event) => {
    if (!draggingId) return;
    const item = event.target.closest?.(itemSelector);
    if (!item) return;
    event.preventDefault();

    const targetId = idOf(item);
    const place = item.dataset.dropPlace || "after";
    delete item.dataset.dropPlace;

    const moved = draggingId;
    draggingId = null;
    clearIndicator();
    root.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));

    if (!targetId || targetId === moved) return;
    onDrop?.({ id: moved, targetId, place, targetEl: item });
  });

  root.addEventListener("dragleave", (event) => {
    if (event.target === root) clearIndicator();
  });

  return { cancel: clearIndicator };
}
