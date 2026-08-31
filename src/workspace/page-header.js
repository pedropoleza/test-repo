/**
 * Cabeçalho da página: breadcrumbs, capa, ícone e título (§6, §7, §8).
 *
 * Os controles ("Adicionar capa", "Adicionar ícone", "Reposicionar")
 * aparecem só no hover ou no foco — nada de barra de botões permanente
 * (§71).
 */
import { paintCover, openCoverPicker } from "./cover.js";
import { openIconPicker, renderIcon } from "./icon-picker.js";
import { toast } from "./ui/toast.js";

export function createPageHeader(root, handlers) {
  let repositioning = null;

  function render(page, breadcrumbs) {
    root.replaceChildren();
    if (!page) return;

    root.appendChild(renderBreadcrumbs(breadcrumbs, page));

    if (page.cover_type) root.appendChild(renderCover(page));

    const head = document.createElement("div");
    head.className = `ws-page__head ws-page__head--${page.layout_width}`;
    if (page.cover_type) head.classList.add("has-cover");

    head.appendChild(renderIconSlot(page));
    head.appendChild(renderControls(page));
    head.appendChild(renderTitle(page));
    root.appendChild(head);
  }

  function renderBreadcrumbs(breadcrumbs, page) {
    const nav = document.createElement("nav");
    nav.className = "ws-breadcrumbs";
    nav.setAttribute("aria-label", "Caminho da página");

    const trail = (breadcrumbs || []).length ? breadcrumbs : [page];
    trail.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "ws-breadcrumbs__sep";
        sep.textContent = "/";
        nav.appendChild(sep);
      }
      const isLast = index === trail.length - 1;
      const node = document.createElement(isLast ? "span" : "button");
      node.className = "ws-breadcrumbs__crumb";
      if (!isLast) {
        node.type = "button";
        node.addEventListener("click", () => handlers.onNavigate(crumb.id));
      } else {
        node.setAttribute("aria-current", "page");
      }
      node.appendChild(renderIcon(crumb.icon_type, crumb.icon_value, { size: 14 }));
      const label = document.createElement("span");
      label.textContent = crumb.title || "Sem título";
      node.appendChild(label);
      nav.appendChild(node);
    });
    return nav;
  }

  function renderCover(page) {
    const wrap = document.createElement("div");
    wrap.className = "ws-cover";
    // Altura reservada antes de qualquer imagem carregar: sem CLS (§7).
    wrap.style.height = `${page.cover_height || 220}px`;
    paintCover(wrap, page);

    const actions = document.createElement("div");
    actions.className = "ws-cover__actions";

    actions.appendChild(
      coverButton("Trocar capa", async () => {
        const picked = await openCoverPicker({ hasCover: true });
        if (picked) handlers.onPatch(coverPatch(picked));
      }),
    );

    if (page.cover_type === "image") {
      actions.appendChild(
        coverButton("Reposicionar", () => startReposition(wrap, page)),
      );
    }

    actions.appendChild(
      coverButton("Remover", () => handlers.onPatch({ cover_type: null, cover_value: null })),
    );

    wrap.appendChild(actions);
    return wrap;
  }

  function coverButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-cover__btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  /** Arrasta verticalmente para escolher o enquadramento da capa. */
  function startReposition(wrap, page) {
    if (repositioning) return;
    wrap.classList.add("is-repositioning");

    let current = page.cover_position_y ?? 50;
    const startY = { value: null };

    const onMove = (event) => {
      const clientY = event.touches ? event.touches[0].clientY : event.clientY;
      if (startY.value === null) {
        startY.value = clientY;
        return;
      }
      const delta = ((clientY - startY.value) / wrap.offsetHeight) * 100;
      startY.value = clientY;
      current = Math.min(100, Math.max(0, current - delta));
      wrap.style.backgroundPosition = `center ${current}%`;
    };

    const finish = () => {
      wrap.classList.remove("is-repositioning");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", finish);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", finish);
      bar.remove();
      repositioning = null;
      handlers.onPatch({ cover_position_y: Math.round(current) });
    };

    const bar = document.createElement("div");
    bar.className = "ws-cover__reposition";
    const hint = document.createElement("span");
    hint.textContent = "Arraste para reposicionar";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "ws-btn ws-btn--primary ws-btn--sm";
    done.textContent = "Salvar posição";
    done.addEventListener("click", finish);
    bar.append(hint, done);
    wrap.appendChild(bar);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", finish, { once: false });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", finish);
    repositioning = { finish };
  }

  function renderIconSlot(page) {
    const slot = document.createElement("div");
    slot.className = "ws-page__icon-slot";
    if (!page.icon_type) return slot;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-page__icon";
    button.setAttribute("aria-label", "Trocar ícone da página");
    button.appendChild(renderIcon(page.icon_type, page.icon_value, { size: 56 }));
    button.addEventListener("click", async () => {
      const picked = await openIconPicker({ hasIcon: true });
      if (picked) handlers.onPatch({ icon_type: picked.type, icon_value: picked.value || null });
    });
    slot.appendChild(button);
    return slot;
  }

  function renderControls(page) {
    const bar = document.createElement("div");
    bar.className = "ws-page__controls";

    if (!page.icon_type) {
      bar.appendChild(
        control("Adicionar ícone", async () => {
          const picked = await openIconPicker({ hasIcon: false });
          if (picked?.type) handlers.onPatch({ icon_type: picked.type, icon_value: picked.value });
        }),
      );
    }
    if (!page.cover_type) {
      bar.appendChild(
        control("Adicionar capa", async () => {
          const picked = await openCoverPicker({ hasCover: false });
          if (picked?.type) handlers.onPatch(coverPatch(picked));
        }),
      );
    }
    bar.appendChild(
      control(
        page.layout_width === "full" ? "Largura normal" : "Largura total",
        () => handlers.onPatch({
          layout_width: page.layout_width === "full" ? "normal" : "full",
        }),
      ),
    );
    return bar;
  }

  function control(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-page__control";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderTitle(page) {
    const title = document.createElement("h1");
    title.className = "ws-page__title";
    title.contentEditable = "true";
    title.spellcheck = true;
    title.dataset.placeholder = "Sem título";
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", "Título da página");
    title.textContent = page.title || "";
    if (!page.title) title.classList.add("is-empty");

    title.addEventListener("input", () => {
      title.classList.toggle("is-empty", !title.textContent);
      handlers.onTitleInput(title.textContent || "");
    });
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handlers.onTitleCommit();
      }
    });
    title.addEventListener("blur", () => handlers.onTitleCommit());
    // Colagem no título é sempre texto puro.
    title.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
      document.execCommand("insertText", false, text);
    });
    return title;
  }

  function coverPatch(picked) {
    if (!picked.type) return { cover_type: null, cover_value: null };
    if (picked.type === "image" && !picked.value) {
      toast("Imagem inválida.", { tone: "warn" });
      return {};
    }
    return { cover_type: picked.type, cover_value: picked.value, cover_position_y: 50 };
  }

  return { render };
}
