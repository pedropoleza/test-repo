/**
 * Slash command (§10).
 *
 * Aparece ao digitar "/" num bloco de texto vazio ou no fim da linha e
 * filtra conforme o usuário continua digitando. O editor mantém o texto
 * digitado; este módulo só desenha, filtra e devolve a escolha.
 *
 * Comandos das fases seguintes (database, tabs, colunas, CRM) NÃO são
 * listados aqui: um item que não faz nada é pior que a ausência dele.
 */

export const SLASH_COMMANDS = [
  { id: "paragraph",     group: "Básico", label: "Texto",           icon: "¶",  keywords: "texto paragrafo p" },
  { id: "heading1",      group: "Básico", label: "Título 1",        icon: "H1", keywords: "titulo heading h1" },
  { id: "heading2",      group: "Básico", label: "Título 2",        icon: "H2", keywords: "titulo heading h2 subtitulo" },
  { id: "heading3",      group: "Básico", label: "Título 3",        icon: "H3", keywords: "titulo heading h3" },
  { id: "heading4",      group: "Básico", label: "Título 4",        icon: "H4", keywords: "titulo heading h4" },
  { id: "bulleted_list", group: "Básico", label: "Lista",           icon: "•",  keywords: "lista bullet marcadores ul" },
  { id: "numbered_list", group: "Básico", label: "Lista numerada",  icon: "1.", keywords: "lista numerada ordenada ol" },
  { id: "checklist",     group: "Básico", label: "To-do",           icon: "☑",  keywords: "todo tarefa checkbox checklist" },
  { id: "toggle",        group: "Básico", label: "Toggle",          icon: "▸",  keywords: "toggle recolher expandir accordion" },
  { id: "quote",         group: "Básico", label: "Citação",         icon: "❝",  keywords: "citacao quote blockquote" },
  { id: "callout",       group: "Básico", label: "Destaque",        icon: "💡", keywords: "callout destaque aviso nota" },
  { id: "code",          group: "Básico", label: "Código",          icon: "</>", keywords: "codigo code snippet" },
  { id: "divider",       group: "Básico", label: "Divisor",         icon: "—",  keywords: "divisor linha separador hr" },

  { id: "image",         group: "Mídia",  label: "Imagem",          icon: "🖼", keywords: "imagem foto image upload" },
  { id: "video",         group: "Mídia",  label: "Vídeo",           icon: "🎬", keywords: "video filme" },
  { id: "file",          group: "Mídia",  label: "Arquivo",         icon: "📎", keywords: "arquivo file anexo pdf" },
  { id: "embed",         group: "Mídia",  label: "Embed",           icon: "🔗", keywords: "embed incorporar iframe" },
  { id: "bookmark",      group: "Mídia",  label: "Bookmark",        icon: "🔖", keywords: "bookmark link favorito url" },

  { id: "subpage",       group: "Estrutura", label: "Subpágina",    icon: "📄", keywords: "subpagina pagina nova page" },

  { id: "database",      group: "Dados", label: "Tabela",           icon: "▦",  keywords: "tabela database base dados grade planilha table" },
  { id: "database_board",group: "Dados", label: "Quadro (kanban)",  icon: "▤",  keywords: "quadro kanban board colunas status" },
  // Dados de um contato em QUALQUER página: é o que permite dois lado a
  // lado para comparar, ou a família inteira numa capa só.
  { id: "crm_contact",   group: "Dados", label: "Dados de contato",  icon: "👤", keywords: "contato lead cliente crm ficha dados pessoa familia comparar" },
];

const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function filterCommands(query) {
  const q = norm(query.trim());
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => {
    const haystack = norm(`${cmd.label} ${cmd.keywords}`);
    return haystack.includes(q);
  });
}

/**
 * Abre o menu ancorado num retângulo (posição do caret).
 * Devolve um controller que o editor usa enquanto o usuário digita.
 */
export function openSlashMenu({ rect, onPick, onClose }) {
  const el = document.createElement("div");
  el.className = "ws-slash";
  el.setAttribute("role", "listbox");
  el.setAttribute("aria-label", "Comandos");
  document.body.appendChild(el);

  let items = SLASH_COMMANDS;
  let active = 0;
  let closed = false;

  function place() {
    const box = el.getBoundingClientRect();
    const below = rect.bottom + 6;
    const fitsBelow = below + box.height < window.innerHeight - 12;
    el.style.top = `${fitsBelow ? below : Math.max(12, rect.top - box.height - 6)}px`;
    el.style.left = `${Math.min(rect.left, window.innerWidth - box.width - 12)}px`;
  }

  function draw() {
    el.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "ws-slash__empty";
      empty.textContent = "Nenhum comando encontrado";
      el.appendChild(empty);
      place();
      return;
    }

    let lastGroup = null;
    items.forEach((cmd, index) => {
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group;
        const heading = document.createElement("div");
        heading.className = "ws-slash__group";
        heading.textContent = cmd.group;
        el.appendChild(heading);
      }
      const option = document.createElement("button");
      option.type = "button";
      option.className = `ws-slash__item${index === active ? " is-active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === active ? "true" : "false");
      option.tabIndex = -1;

      const icon = document.createElement("span");
      icon.className = "ws-slash__icon";
      icon.textContent = cmd.icon;
      const label = document.createElement("span");
      label.className = "ws-slash__label";
      label.textContent = cmd.label;
      option.append(icon, label);

      // mousedown, não click: o click roubaria o foco do contentEditable
      // antes de sabermos onde o caret estava.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(index);
      });
      option.addEventListener("mousemove", () => {
        if (active === index) return;
        active = index;
        draw();
      });
      el.appendChild(option);
    });
    place();
    el.querySelector(".ws-slash__item.is-active")?.scrollIntoView({ block: "nearest" });
  }

  function pick(index) {
    const cmd = items[index];
    if (!cmd) return;
    close();
    onPick?.(cmd);
  }

  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    onClose?.();
  }

  draw();

  return {
    setQuery(query) {
      items = filterCommands(query);
      active = 0;
      draw();
      return items.length > 0;
    },
    /** Devolve true se consumiu a tecla. */
    handleKey(event) {
      if (closed) return false;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          active = (active + 1) % Math.max(items.length, 1);
          draw();
          return true;
        case "ArrowUp":
          event.preventDefault();
          active = (active - 1 + items.length) % Math.max(items.length, 1);
          draw();
          return true;
        case "Enter":
        case "Tab":
          if (!items.length) return false;
          event.preventDefault();
          pick(active);
          return true;
        case "Escape":
          event.preventDefault();
          close();
          return true;
        default:
          return false;
      }
    },
    close,
    get isOpen() {
      return !closed;
    },
  };
}
