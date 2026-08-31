/**
 * Cabeçalho da página: breadcrumbs, capa, ícone e título (§6, §7, §8).
 *
 * Os controles ("Adicionar capa", "Adicionar ícone", "Reposicionar")
 * aparecem só no hover ou no foco — nada de barra de botões permanente
 * (§71).
 */
import { paintCover, openCoverPicker } from "./cover.js";
import { openIconPicker, renderIcon } from "./icon-picker.js";
import { openMenu } from "./ui/menu.js";
import { toast } from "./ui/toast.js";

export function createPageHeader(root, handlers) {
  let repositioning = null;
  // Rótulo do próprio breadcrumb, atualizado enquanto se digita o título.
  // Re-renderizar o cabeçalho inteiro a cada tecla tiraria o foco do H1.
  let ownCrumbLabel = null;

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
    ownCrumbLabel = null;
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
      if (isLast) ownCrumbLabel = label;
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
      coverButton("Altura", (event) => {
        const atual = page.cover_height || 220;
        openMenu({
          anchor: event.currentTarget,
          width: 180,
          placement: "top-start",
          items: [
            { id: "160", label: "Baixa",  icon: atual === 160 ? "✓" : " " },
            { id: "220", label: "Média",  icon: atual === 220 ? "✓" : " " },
            { id: "320", label: "Alta",   icon: atual === 320 ? "✓" : " " },
            { id: "420", label: "Máxima", icon: atual === 420 ? "✓" : " " },
          ],
          onSelect: (id) => handlers.onPatch({ cover_height: Number(id) }),
        });
      }),
    );

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

  /**
   * Modo de reposicionamento da capa.
   *
   * Antes isto usava mouseup no document para encerrar, e o próprio clique
   * no botão "Reposicionar" já disparava o encerramento — o modo terminava
   * antes de o usuário arrastar qualquer coisa. Agora o arrasto e a saída
   * do modo são eventos separados: pointerdown/move/up movem, e só
   * "Salvar" ou "Cancelar" (ou Esc) encerram.
   */
  function startReposition(wrap, page) {
    if (repositioning) return;

    const original = page.cover_position_y ?? 50;
    let current = original;
    let dragging = false;
    let lastY = 0;

    wrap.classList.add("is-repositioning");

    const onDown = (event) => {
      if (event.target.closest(".ws-cover__reposition")) return; // barra não arrasta
      dragging = true;
      lastY = event.clientY;
      wrap.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onMove = (event) => {
      if (!dragging) return;
      const delta = ((event.clientY - lastY) / wrap.offsetHeight) * 100;
      lastY = event.clientY;
      current = Math.min(100, Math.max(0, current - delta));
      wrap.style.backgroundPosition = `center ${current}%`;
      readout.textContent = `${Math.round(current)}%`;
      event.preventDefault();
    };
    const onUp = () => { dragging = false; };

    const exit = (save) => {
      wrap.classList.remove("is-repositioning");
      wrap.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey, true);
      bar.remove();
      repositioning = null;
      if (save) handlers.onPatch({ cover_position_y: Math.round(current) });
      else wrap.style.backgroundPosition = `center ${original}%`;
    };

    const onKey = (event) => {
      // Teclado também reposiciona: arrastar não pode ser o único caminho.
      if (event.key === "Escape") { event.preventDefault(); exit(false); return; }
      if (event.key === "Enter")  { event.preventDefault(); exit(true);  return; }
      const step = event.shiftKey ? 10 : 2;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        current = Math.min(100, Math.max(0, current + (event.key === "ArrowUp" ? -step : step)));
        wrap.style.backgroundPosition = `center ${current}%`;
        readout.textContent = `${Math.round(current)}%`;
      }
    };

    const bar = document.createElement("div");
    bar.className = "ws-cover__reposition";

    const hint = document.createElement("span");
    hint.className = "ws-cover__hint";
    hint.textContent = "Arraste a capa ou use ↑ ↓";

    const readout = document.createElement("span");
    readout.className = "ws-cover__readout";
    readout.textContent = `${Math.round(current)}%`;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ws-btn ws-btn--ghost ws-btn--sm";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", () => exit(false));

    const save = document.createElement("button");
    save.type = "button";
    save.className = "ws-btn ws-btn--primary ws-btn--sm";
    save.textContent = "Salvar posição";
    save.addEventListener("click", () => exit(true));

    bar.append(hint, readout, cancel, save);
    wrap.appendChild(bar);

    wrap.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKey, true);
    repositioning = { exit };
    save.focus();
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
    // Página sem capa e sem ícone: mostra os controles direto. Esconder a
    // única forma de adicioná-los atrás de um hover é fricção pura (§71
    // pede contextual, não invisível).
    if (!page.cover_type && !page.icon_type) bar.classList.add("is-visible");

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

  return {
    render,
    /** Mantém o breadcrumb em dia enquanto o título é digitado. */
    updateTitle(title) {
      if (ownCrumbLabel) ownCrumbLabel.textContent = title || "Sem título";
    },
  };
}
