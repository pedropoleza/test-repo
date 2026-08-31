/**
 * Sidebar do workspace (§5): árvore hierárquica com favoritos, páginas
 * privadas, compartilhadas e lixeira.
 *
 * A árvore inteira vem no bootstrap (só metadados), então expandir um nó
 * não dispara request. Conteúdo de página é que carrega sob demanda.
 */
import {
  getState, childrenOf, pageById, isFavorite, isExpanded, toggleExpanded,
} from "./store.js";
import { renderIcon } from "./icon-picker.js";
import { openMenu } from "./ui/menu.js";
import { initDnd } from "./editor/dnd.js";

export function createSidebar(root, handlers) {
  initDnd(root, {
    itemSelector: ".ws-tree__item",
    handleSelector: ".ws-tree__row",
    allowNest: () => true,
    isDescendant: (candidateId, rootId) => {
      let cur = pageById(candidateId);
      const seen = new Set();
      while (cur?.parent_page_id && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.parent_page_id === rootId) return true;
        cur = pageById(cur.parent_page_id);
      }
      return false;
    },
    onDrop: ({ id, targetId, place }) => {
      const target = pageById(targetId);
      if (!target) return;
      if (place === "inside") return handlers.onMove(id, { parentPageId: targetId });
      return handlers.onMove(id, {
        parentPageId: target.parent_page_id || null,
        ...(place === "before" ? { beforeId: targetId } : { afterId: targetId }),
      });
    },
  });

  function render() {
    const state = getState();
    root.replaceChildren();

    const favorites = state.favorites
      .map((f) => pageById(f.target_id))
      .filter((p) => p && !p.is_archived);
    if (favorites.length) {
      root.appendChild(section("Favoritos", favorites.map((p) => item(p, 0, { flat: true }))));
    }

    const priv = childrenOf(null).filter((p) => p.visibility !== "shared");
    const shared = childrenOf(null).filter((p) => p.visibility === "shared");

    root.appendChild(
      section("Privado", priv.map((p) => item(p, 0)), {
        action: { label: "Nova página privada", onClick: () => handlers.onCreate(null, "private") },
        empty: "Nenhuma página ainda.",
      }),
    );

    root.appendChild(
      section("Compartilhado", shared.map((p) => item(p, 0)), {
        action: { label: "Nova página compartilhada", onClick: () => handlers.onCreate(null, "shared") },
        empty: "Nada compartilhado com o time.",
      }),
    );

    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "ws-tree__row ws-tree__row--static";
    trash.addEventListener("click", () => handlers.onOpenTrash());
    const trashIcon = document.createElement("span");
    trashIcon.className = "ws-tree__icon";
    trashIcon.textContent = "🗑";
    const trashLabel = document.createElement("span");
    trashLabel.className = "ws-tree__label";
    trashLabel.textContent = "Lixeira";
    trash.append(trashIcon, trashLabel);
    root.appendChild(section("", [trash]));
  }

  function section(title, children, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "ws-tree__section";

    if (title) {
      const head = document.createElement("div");
      head.className = "ws-tree__section-head";
      const label = document.createElement("span");
      label.textContent = title;
      head.appendChild(label);

      if (options.action) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "ws-tree__section-add";
        add.setAttribute("aria-label", options.action.label);
        add.title = options.action.label;
        add.textContent = "+";
        add.addEventListener("click", options.action.onClick);
        head.appendChild(add);
      }
      wrap.appendChild(head);
    }

    if (!children.length && options.empty) {
      const empty = document.createElement("p");
      empty.className = "ws-tree__empty";
      empty.textContent = options.empty;
      wrap.appendChild(empty);
    }
    children.forEach((child) => wrap.appendChild(child));
    return wrap;
  }

  function item(page, depth, { flat = false } = {}) {
    const state = getState();
    const wrap = document.createElement("div");
    wrap.className = "ws-tree__item";
    wrap.dataset.pageId = page.id;

    const kids = flat ? [] : childrenOf(page.id);
    const expanded = isExpanded(page.id);

    const row = document.createElement("div");
    row.className = `ws-tree__row${state.currentPageId === page.id ? " is-current" : ""}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.tabIndex = 0;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", state.currentPageId === page.id ? "true" : "false");
    if (kids.length) row.setAttribute("aria-expanded", expanded ? "true" : "false");
    row.draggable = true;

    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = `ws-tree__caret${kids.length ? "" : " is-hidden"}`;
    caret.setAttribute("aria-label", expanded ? "Recolher" : "Expandir");
    caret.textContent = expanded ? "▾" : "▸";
    caret.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpanded(page.id);
    });

    const icon = document.createElement("span");
    icon.className = "ws-tree__icon";
    icon.appendChild(renderIcon(page.icon_type, page.icon_value, { size: 15 }));

    const label = document.createElement("span");
    label.className = "ws-tree__label";
    label.textContent = page.title || "Sem título";

    const actions = document.createElement("span");
    actions.className = "ws-tree__actions";

    const more = document.createElement("button");
    more.type = "button";
    more.className = "ws-tree__action";
    more.setAttribute("aria-label", `Ações de ${page.title || "página sem título"}`);
    more.textContent = "⋯";
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      openPageMenu(more, page);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ws-tree__action";
    add.setAttribute("aria-label", `Nova subpágina em ${page.title || "página sem título"}`);
    add.textContent = "+";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpanded(page.id, true);
      handlers.onCreate(page.id, page.visibility);
    });

    actions.append(more, add);
    row.append(caret, icon, label, actions);

    row.addEventListener("click", () => handlers.onOpen(page.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handlers.onOpen(page.id);
      } else if (event.key === "ArrowRight" && kids.length) {
        toggleExpanded(page.id, true);
      } else if (event.key === "ArrowLeft" && kids.length && isExpanded(page.id)) {
        toggleExpanded(page.id, false);
      }
    });

    wrap.appendChild(row);

    if (kids.length && expanded) {
      const group = document.createElement("div");
      group.className = "ws-tree__children";
      group.setAttribute("role", "group");
      kids.forEach((child) => group.appendChild(item(child, depth + 1)));
      wrap.appendChild(group);
    }
    return wrap;
  }

  function openPageMenu(anchor, page) {
    const favorited = isFavorite(page.id);
    openMenu({
      anchor,
      width: 230,
      items: [
        { id: "rename", label: "Renomear", icon: "✎" },
        { id: "favorite", label: favorited ? "Remover dos favoritos" : "Adicionar aos favoritos", icon: "★" },
        { id: "duplicate", label: "Duplicar", icon: "⧉" },
        { id: "visibility", label: page.visibility === "shared" ? "Tornar privada" : "Compartilhar com o time", icon: "👥" },
        { separator: true },
        { id: "copy-link", label: "Copiar link", icon: "🔗" },
        { separator: true },
        { id: "archive", label: "Mover para a lixeira", icon: "🗑", danger: true },
      ],
      onSelect: (id) => handlers.onPageAction(id, page),
    });
  }

  return { render };
}
