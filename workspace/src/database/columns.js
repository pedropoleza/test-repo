/**
 * Largura de coluna ajustável, como em planilha.
 *
 * Todas as linhas são grids independentes, então a largura vive numa
 * variável CSS no container (`--ws-db-template`) e cada linha lê dela.
 * Assim arrastar uma borda atualiza a tabela inteira num só write.
 *
 * Coluna nunca mexida continua elástica (`minmax(...,1fr)`): a tabela
 * ocupa a largura disponível até alguém decidir o contrário.
 */

const MIN = 90;
const MAX = 720;
const STORE_KEY = "workspace:colWidths";

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function loadWidths(scope) {
  return readStore()[scope] || {};
}

function saveWidths(scope, widths) {
  try {
    const all = readStore();
    all[scope] = widths;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* storage bloqueado: a sessão segue sem lembrar */ }
}

/** Monta o grid-template a partir das larguras salvas. */
export function templateFor(fields, widths, { trailing = "44px" } = {}) {
  const cols = fields.map((f) => {
    const w = widths[f.key];
    return w ? `${Math.round(w)}px` : "minmax(150px, 1fr)";
  });
  return trailing ? `${cols.join(" ")} ${trailing}` : cols.join(" ");
}

export function applyTemplate(gridEl, fields, widths, options) {
  gridEl.style.setProperty("--ws-db-template", templateFor(fields, widths, options));
}

/**
 * Instala o punho de arraste na borda direita do cabeçalho.
 * `onCommit(widths)` recebe o mapa final para quem quiser persistir.
 */
export function attachResizer(thEl, field, { scope, gridEl, fields, widths, trailing, onCommit }) {
  const handle = document.createElement("span");
  handle.className = "ws-db__resize";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", `Largura da coluna ${field.name}`);
  handle.tabIndex = 0;

  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const setWidth = (px) => {
    widths[field.key] = Math.min(MAX, Math.max(MIN, px));
    applyTemplate(gridEl, fields, widths, { trailing });
  };

  const onMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setWidth(startWidth + (event.clientX - startX));
  };

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("is-resizing-col");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    saveWidths(scope, widths);
    onCommit?.(widths);
  };

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startX = event.clientX;
    startWidth = thEl.getBoundingClientRect().width;
    document.body.classList.add("is-resizing-col");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
  });

  // Teclado: redimensionar não pode depender de arrastar com o mouse.
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const atual = widths[field.key] || thEl.getBoundingClientRect().width;
      setWidth(atual + (event.key === "ArrowRight" ? step : -step));
      saveWidths(scope, widths);
      onCommit?.(widths);
    }
  });

  // Duplo clique volta a coluna para o comportamento elástico.
  handle.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    delete widths[field.key];
    applyTemplate(gridEl, fields, widths, { trailing });
    saveWidths(scope, widths);
    onCommit?.(widths);
  });

  thEl.appendChild(handle);
  return handle;
}
