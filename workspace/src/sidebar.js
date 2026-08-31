/**
 * Sidebar do workspace (§5): árvore hierárquica com favoritos, páginas
 * privadas, compartilhadas e lixeira.
 *
 * A árvore inteira vem no bootstrap (só metadados), então expandir um nó
 * não dispara request. Conteúdo de página é que carrega sob demanda.
 */
import {
  getState, childrenOf, pagesInSection, pageById, isFavorite, isExpanded, toggleExpanded,
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
    onDrop: ({ id, targetId, place, targetEl }) => {
      const target = pageById(targetId);
      if (!target) return;
      if (place === "inside") return handlers.onMove(id, { parentPageId: targetId });
      // Solta ao lado de uma página de raiz: herda a seção dela.
      const sectionId = target.parent_page_id
        ? undefined
        : (targetEl?.closest("[data-section-id]")?.dataset.sectionId || null);
      return handlers.onMove(id, {
        parentPageId: target.parent_page_id || null,
        ...(sectionId !== undefined ? { sectionId } : {}),
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

    // Seções vêm do banco: o usuário cria, renomeia e reordena as suas.
    state.sections.forEach((sec, index) => {
      const pages = pagesInSection(sec.id);
      root.appendChild(
        section(sec.name, pages.map((p) => item(p, 0)), {
          sectionId: sec.id,
          isDefault: sec.is_default,
          isFirst: index === 0,
          isLast: index === state.sections.length - 1,
          icon: sec.icon_type ? { type: sec.icon_type, value: sec.icon_value } : null,
          action: {
            label: `Nova página em ${sec.name}`,
            onClick: () => handlers.onCreate(null, { sectionId: sec.id }),
          },
          empty: "Nenhuma página aqui.",
        }),
      );
    });

    // CRM: dados que vivem no GHL, não no workspace. Fica numa seção
    // própria, sem menu de página, porque não é conteúdo editável aqui.
    const crm = document.createElement("div");
    crm.className = "ws-tree__section";
    for (const [id, label, icon] of [
      ["contacts", "Leads", "👥"],
      ["opportunities", "Oportunidades", "💰"],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ws-tree__row ws-tree__row--static${
        getState().crmView === id ? " is-current" : ""}`;
      const ic = document.createElement("span");
      ic.className = "ws-tree__icon";
      ic.textContent = icon;
      const lb = document.createElement("span");
      lb.className = "ws-tree__label";
      lb.textContent = label;
      btn.append(ic, lb);
      btn.addEventListener("click", () => handlers.onOpenCrm(id));
      crm.appendChild(btn);
    }
    const crmHead = document.createElement("div");
    crmHead.className = "ws-tree__section-head";
    const crmLabel = document.createElement("span");
    crmLabel.textContent = "CRM";
    crmHead.appendChild(crmLabel);
    crm.insertBefore(crmHead, crm.firstChild);
    root.appendChild(crm);

    const newSection = document.createElement("button");
    newSection.type = "button";
    newSection.className = "ws-tree__new-section";
    newSection.textContent = "+ Nova seção";
    newSection.addEventListener("click", () => handlers.onCreateSection());
    root.appendChild(newSection);

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

    if (options.sectionId) wrap.dataset.sectionId = options.sectionId;

    if (title) {
      const head = document.createElement("div");
      head.className = "ws-tree__section-head";

      if (options.sectionId) {
        const label = document.createElement("button");
        label.type = "button";
        label.className = "ws-tree__section-name";
        if (options.icon) {
          label.appendChild(renderIcon(options.icon.type, options.icon.value, { size: 13 }));
        }
        const labelText = document.createElement("span");
        labelText.textContent = title;
        label.appendChild(labelText);
        label.setAttribute("aria-label", `Ações da seção ${title}`);
        label.addEventListener("click", () => {
          openMenu({
            anchor: label,
            width: 220,
            items: [
              { id: "new-page", label: "Nova página aqui", icon: "+" },
              { id: "rename", label: "Renomear e trocar ícone", icon: "✎" },
              { separator: true },
              { id: "move-up", label: "Mover para cima", icon: "↑", disabled: options.isFirst },
              { id: "move-down", label: "Mover para baixo", icon: "↓", disabled: options.isLast },
              { separator: true },
              {
                id: "delete",
                label: options.isDefault ? "Seção padrão (fixa)" : "Excluir seção",
                icon: "🗑",
                danger: !options.isDefault,
                disabled: options.isDefault,
              },
            ],
            onSelect: (id) => handlers.onSectionAction(id, options.sectionId, title),
          });
        });
        head.appendChild(label);
      } else {
        const label = document.createElement("span");
        label.textContent = title;
        head.appendChild(label);
      }

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
        { id: "move-to-section", label: "Mover para seção…", icon: "⇄" },
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
