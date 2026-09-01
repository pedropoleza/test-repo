/**
 * Sidebar do workspace (§5): árvore hierárquica com favoritos, páginas
 * privadas, compartilhadas e lixeira.
 *
 * A árvore inteira vem no bootstrap (só metadados), então expandir um nó
 * não dispara request. Conteúdo de página é que carrega sob demanda.
 */
import {
  getState, childrenOf, pagesInSection, pageById, isFavorite, isExpanded, toggleExpanded,
  isSectionCollapsed, toggleSectionCollapsed, setAllSectionsCollapsed, collapseSectionOnce,
} from "./store.js";
import { renderIcon } from "./icon-picker.js";
import { ehFichaDeContato, renderAvatar } from "./crm/photo.js";
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
    // Soltar na seção: leva a página para o fim dela. É o caminho para
    // uma seção VAZIA, onde não há vizinho para servir de alvo.
    containerSelector: "[data-section-id]",
    onDropContainer: ({ id, containerEl }) => {
      const sectionId = containerEl?.dataset?.sectionId;
      if (!sectionId) return;
      const pagina = pageById(id);
      if (!pagina || pagina.section_id === sectionId) return;
      handlers.onMove(id, { parentPageId: null, sectionId });
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
      const fichas = pages.filter(ehFicha);
      // Seção de fichas nasce recolhida: ela cresce uma linha por contato
      // aberto e, aberta, empurra o resto da navegação para fora da tela.
      if (fichas.length) collapseSectionOnce(sec.id);
      root.appendChild(
        section(sec.name, pages.map((p) => item(p, 0)), {
          sectionId: sec.id,
          // Seção de fichas: recolhida ela mostra os últimos contatos
          // abertos, em vez de um "N páginas" que não leva a lugar nenhum.
          previaRecolhida: fichas.length ? () => ultimosContatos(fichas) : null,
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
      ["renewals", "Renovações", "🔄"],
      ["tasks", "Tarefas", "✓"],
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
    // Listas salvas: recortes de pipeline/estágio que a pessoa criou, e a
    // de Apólices que já nasce pronta. Ficam abaixo das abas fixas porque
    // são conteúdo dela, não do produto.
    for (const lista of getState().crmLists || []) {
      // div com role, e não <button>: a linha carrega o ⋯ dentro dela, e
      // botão dentro de botão é HTML inválido — o clique no ⋯ não chega.
      // É o mesmo formato das linhas de página, logo acima.
      const row = document.createElement("div");
      row.className = `ws-tree__row ws-tree__row--static${
        getState().crmListId === lista.id ? " is-current" : ""}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const abrir = () => handlers.onOpenCrmList(lista.id);
      row.addEventListener("click", abrir);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); abrir(); }
      });

      const ic = document.createElement("span");
      ic.className = "ws-tree__icon";
      ic.textContent = lista.icon_value || "📋";
      const lb = document.createElement("span");
      lb.className = "ws-tree__label";
      lb.textContent = lista.name;

      const acoes = document.createElement("span");
      acoes.className = "ws-tree__actions";
      const mais = document.createElement("button");
      mais.type = "button";
      mais.className = "ws-tree__action";
      mais.textContent = "⋯";
      mais.setAttribute("aria-label", `Ações de ${lista.name}`);
      mais.addEventListener("click", (event) => {
        event.stopPropagation();               // não abrir a lista ao pedir o menu
        openMenu({
          anchor: mais,
          width: 220,
          items: [
            { id: "rename", label: "Renomear", icon: "✏️" },
            { id: "delete", label: "Remover lista", icon: "🗑", danger: true },
          ],
          onSelect: (id) => handlers.onCrmListAction(id, lista),
        });
      });
      acoes.appendChild(mais);

      row.append(ic, lb, acoes);
      crm.appendChild(row);
    }

    const novaLista = document.createElement("button");
    novaLista.type = "button";
    novaLista.className = "ws-tree__new-list";
    novaLista.textContent = "+ Nova lista";
    novaLista.title = "Uma aba com todo mundo de uma pipeline ou estágio";
    novaLista.addEventListener("click", () => handlers.onCreateCrmList());
    crm.appendChild(novaLista);

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
    const collapsed = options.sectionId ? isSectionCollapsed(options.sectionId) : false;

    if (title) {
      const head = document.createElement("div");
      head.className = "ws-tree__section-head";

      if (options.sectionId) {
        // Minimizar a seção: com muitas fichas de contato a navegação
        // vira uma lista sem fim se tudo ficar sempre aberto.
        const caret = document.createElement("button");
        caret.type = "button";
        caret.className = "ws-tree__section-caret";
        caret.textContent = collapsed ? "▸" : "▾";
        caret.setAttribute("aria-expanded", collapsed ? "false" : "true");
        caret.setAttribute("aria-label", collapsed ? `Expandir ${title}` : `Recolher ${title}`);
        caret.addEventListener("click", () => toggleSectionCollapsed(options.sectionId));
        head.appendChild(caret);
      }

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
              { id: "collapse-all", label: "Recolher todas as seções", icon: "⌃" },
              { id: "expand-all", label: "Expandir todas as seções", icon: "⌄" },
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
            onSelect: (id) => {
              if (id === "collapse-all") return setAllSectionsCollapsed(true);
              if (id === "expand-all") return setAllSectionsCollapsed(false);
              return handlers.onSectionAction(id, options.sectionId, title);
            },
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

    if (collapsed) {
      const previa = options.previaRecolhida?.();
      if (previa) {
        // Recolher não pode ser esconder: a seção de fichas tem centenas
        // de itens e precisa ficar fechada, mas os últimos abertos são
        // justamente os que se volta a usar. O contador de antes ocupava
        // a mesma linha sem levar a lugar nenhum.
        wrap.appendChild(previa);
      } else if (children.length) {
        const count = document.createElement("span");
        count.className = "ws-tree__collapsed-count";
        count.textContent = `${children.length} ${children.length === 1 ? "página" : "páginas"}`;
        wrap.appendChild(count);
      }
      return wrap;
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

  const ehFicha = (page) => ehFichaDeContato(page);

  /**
   * Os últimos contatos abertos, em linha compacta e clicável.
   *
   * Quatro porque é o que cabe sem a seção voltar a ser uma lista, e
   * porque na prática se alterna entre poucas fichas por vez. Quem some
   * daqui continua a um clique em "Ver todos", que expande a seção.
   */
  function ultimosContatos(fichas, quantos = 4) {
    const state = getState();
    const ordem = new Map(
      (state.recent || []).map((r, i) => [r.target_id, i]),   // já vem do mais recente
    );
    const vistas = fichas
      .filter((p) => ordem.has(p.id))
      .sort((a, b) => ordem.get(a.id) - ordem.get(b.id))
      .slice(0, quantos);

    const box = document.createElement("div");
    box.className = "ws-tree__recent";

    if (!vistas.length) {
      const vazio = document.createElement("p");
      vazio.className = "ws-tree__empty";
      vazio.textContent = `${fichas.length} ${fichas.length === 1 ? "ficha" : "fichas"}. `
        + "Abra uma para ela aparecer aqui.";
      box.appendChild(vazio);
    }

    for (const page of vistas) {
      // Embrulhada em .ws-tree__item com data-page-id, como as linhas
      // completas: é o que o arrasto reconhece. Sem isso daqui não dava
      // para levar a ficha recém-aberta a outra seção sem antes expandir
      // a lista inteira.
      const item = document.createElement("div");
      item.className = "ws-tree__item";
      item.dataset.pageId = page.id;

      const row = document.createElement("div");
      row.className = `ws-tree__row ws-tree__row--mini${
        state.currentPageId === page.id ? " is-current" : ""}`;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.draggable = true;

      const ic = document.createElement("span");
      ic.className = "ws-tree__icon";
      ic.appendChild(renderAvatar(page, { size: 18 }));
      const lb = document.createElement("span");
      lb.className = "ws-tree__label";
      lb.textContent = page.title || "Sem título";
      row.append(ic, lb);
      row.title = page.title || "Sem título";
      row.addEventListener("click", () => handlers.onOpen(page.id));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlers.onOpen(page.id);
        }
      });

      item.appendChild(row);
      box.appendChild(item);
    }

    const todos = document.createElement("button");
    todos.type = "button";
    todos.className = "ws-tree__new-list";
    todos.textContent = `Ver todos (${fichas.length})`;
    todos.addEventListener("click", () => {
      const sectionId = todos.closest("[data-section-id]")?.dataset.sectionId;
      if (sectionId) toggleSectionCollapsed(sectionId, false);
    });
    box.appendChild(todos);
    return box;
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
    // Ficha de contato mostra o rosto (ou as iniciais); página comum, o
    // ícone dela.
    icon.appendChild(ehFicha(page)
      ? renderAvatar(page, { size: 16 })
      : renderIcon(page.icon_type, page.icon_value, { size: 15 }));

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
