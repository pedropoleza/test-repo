/**
 * Primitivas de overlay: menu ancorado e modal.
 *
 * Requisitos de acessibilidade do §76 vivem aqui, uma vez só: navegação
 * por teclado, Escape fecha, foco preso no modal e devolvido ao elemento
 * de origem no fechamento.
 */

let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.el.remove();
  document.removeEventListener("mousedown", activeMenu.onOutside, true);
  document.removeEventListener("keydown", activeMenu.onKey, true);
  window.removeEventListener("resize", activeMenu.onResize, true);
  window.removeEventListener("scroll", activeMenu.onScroll, true);
  const returnTo = activeMenu.returnFocusTo;
  activeMenu = null;
  if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
}

/**
 * items: [{ id, label, hint, icon, danger, disabled, section }]
 * Um item com `section` inicia um grupo rotulado.
 */
export function openMenu({ anchor, items, onSelect, placement = "bottom-start", width = 220 }) {
  closeMenu();

  const el = document.createElement("div");
  el.className = "ws-menu";
  el.setAttribute("role", "menu");
  el.style.width = `${width}px`;

  let lastSection = null;
  for (const item of items) {
    if (item.section && item.section !== lastSection) {
      lastSection = item.section;
      const label = document.createElement("div");
      label.className = "ws-menu__section";
      label.textContent = item.section;
      el.appendChild(label);
    }
    if (item.separator) {
      const hr = document.createElement("div");
      hr.className = "ws-menu__sep";
      el.appendChild(hr);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ws-menu__item${item.danger ? " is-danger" : ""}`;
    button.setAttribute("role", "menuitem");
    button.disabled = !!item.disabled;
    button.dataset.id = item.id;

    if (item.icon) {
      const icon = document.createElement("span");
      icon.className = "ws-menu__icon";
      icon.textContent = item.icon;
      button.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "ws-menu__label";
    label.textContent = item.label;
    button.appendChild(label);

    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "ws-menu__hint";
      hint.textContent = item.hint;
      button.appendChild(hint);
    }

    button.addEventListener("click", () => {
      closeMenu();
      onSelect?.(item.id, item);
    });
    el.appendChild(button);
  }

  document.body.appendChild(el);
  position(el, anchor, placement);

  const onOutside = (event) => {
    if (!el.contains(event.target)) closeMenu();
  };

  /**
   * Rolar a página não fecha o menu: ele acompanha a âncora.
   *
   * Fechar era o comportamento antigo e atrapalhava justamente onde o
   * menu é mais longo — a lista de estágios e os filtros de coluna, em
   * que a pessoa rola para achar a opção e perdia o menu no caminho. O
   * motivo original de fechar era o menu ficar "solto" longe da célula;
   * reposicionar resolve isso sem tirar nada da pessoa.
   *
   * Só fecha quando a âncora sai de vista: aí não há mais a que se
   * ancorar, e um menu flutuando sozinho não diz de onde veio.
   */
  const onScroll = (event) => {
    if (event.target === el || el.contains(event.target)) return;   // rolagem do próprio menu
    // Âncora fora do documento: o editor repinta os blocos e troca o nó
    // sob o menu. Fechar aqui matava o menu que a pessoa acabou de abrir,
    // de forma intermitente — só quando um scroll acontecia no intervalo.
    // Sem âncora não há o que acompanhar, então ele fica onde está.
    if (!document.contains(anchor)) return;
    const rect = anchor.getBoundingClientRect();
    const foraDeVista = rect.bottom < 0 || rect.top > window.innerHeight
      || rect.right < 0 || rect.left > window.innerWidth;
    if (foraDeVista) closeMenu();
    else position(el, anchor, placement);
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [...el.querySelectorAll(".ws-menu__item:not([disabled])")];
    if (!options.length) return;
    const current = options.indexOf(document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % options.length
        : (current - 1 + options.length) % options.length;
    options[next].focus();
  };

  const onResize = () => {
    // Mesma regra do scroll: sem âncora, o menu fica onde está.
    if (document.contains(anchor)) position(el, anchor, placement);
  };

  activeMenu = { el, onOutside, onKey, onScroll, onResize, returnFocusTo: document.activeElement };
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize, true);
  window.addEventListener("scroll", onScroll, true);

  el.querySelector(".ws-menu__item:not([disabled])")?.focus({ preventScroll: true });
  return el;
}

function position(el, anchor, placement) {
  const rect = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const margin = 8;

  let top = placement.startsWith("bottom") ? rect.bottom + 6 : rect.top - box.height - 6;
  let left = placement.endsWith("end") ? rect.right - box.width : rect.left;

  top = Math.min(Math.max(margin, top), window.innerHeight - box.height - margin);
  left = Math.min(Math.max(margin, left), window.innerWidth - box.width - margin);

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

/**
 * Modal com foco preso. `render(body, close)` monta o conteúdo.
 * Devolve uma promise resolvida com o valor passado a `close(value)`.
 */
export function openModal({ title, render, width = 560 }) {
  closeMenu();
  const returnFocusTo = document.activeElement;

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "ws-modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "ws-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.style.maxWidth = `${width}px`;

    const head = document.createElement("div");
    head.className = "ws-modal__head";
    const heading = document.createElement("h2");
    heading.className = "ws-modal__title";
    heading.id = `ws-modal-title-${Math.random().toString(36).slice(2, 8)}`;
    heading.textContent = title;
    dialog.setAttribute("aria-labelledby", heading.id);
    head.appendChild(heading);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ws-icon-btn";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "✕";
    head.appendChild(closeBtn);
    dialog.appendChild(head);

    const body = document.createElement("div");
    body.className = "ws-modal__body";
    dialog.appendChild(body);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      if (returnFocusTo && document.contains(returnFocusTo)) {
        returnFocusTo.focus({ preventScroll: true });
      }
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = [
        ...dialog.querySelectorAll(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((n) => n.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    closeBtn.addEventListener("click", () => close(null));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener("keydown", onKey, true);

    render(body, close);
    requestAnimationFrame(() => {
      const target = dialog.querySelector("input, button:not(.ws-icon-btn)") || closeBtn;
      target.focus({ preventScroll: true });
    });
  });
}
