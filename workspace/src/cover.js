/**
 * Sistema de capas (§7).
 *
 * Guardamos cover_type + cover_value + cover_position_y. O reposicionamento
 * é só um deslocamento vertical de background — não recorta a imagem, não
 * gera upload extra e não muda a altura reservada, então a capa não causa
 * layout shift ao carregar.
 */
import { openModal } from "./ui/menu.js";
import { api } from "./api.js";
import { toast } from "./ui/toast.js";

export const GRADIENTS = {
  "spark-blue": "linear-gradient(120deg, #155eef 0%, #4d89ff 55%, #b3cdff 100%)",
  "midnight":   "linear-gradient(120deg, #0f1e3d 0%, #1a2a4a 50%, #2563eb 100%)",
  "sunset":     "linear-gradient(120deg, #d97706 0%, #f59e0b 45%, #fbbf24 100%)",
  "mint":       "linear-gradient(120deg, #047857 0%, #16a34a 55%, #86efac 100%)",
  "plum":       "linear-gradient(120deg, #6d28d9 0%, #a855f7 55%, #f0abfc 100%)",
  "slate":      "linear-gradient(120deg, #334155 0%, #64748b 55%, #cbd5e1 100%)",
  "ember":      "linear-gradient(120deg, #9f1239 0%, #dc2626 55%, #fca5a5 100%)",
  "sand":       "linear-gradient(120deg, #78716c 0%, #a8a29e 55%, #e7e5e4 100%)",
};

export const COLORS = {
  blue: "#155eef", navy: "#0f1e3d", green: "#16a34a", amber: "#d97706",
  red: "#dc2626", purple: "#7c3aed", slate: "#475569", gray: "#94a3b8",
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Aplica o visual da capa a um elemento. */
export function paintCover(el, page) {
  el.dataset.coverType = page.cover_type || "";
  el.style.backgroundImage = "";
  el.style.backgroundColor = "";
  el.style.backgroundPosition = `center ${page.cover_position_y ?? 50}%`;
  el.style.backgroundSize = "cover";

  if (page.cover_type === "image" && page.cover_value) {
    el.style.backgroundImage = `url("${cssUrl(page.cover_value)}")`;
  } else if (page.cover_type === "gradient") {
    el.style.backgroundImage = GRADIENTS[page.cover_value] || GRADIENTS["spark-blue"];
  } else if (page.cover_type === "color") {
    el.style.backgroundColor = COLORS[page.cover_value] || page.cover_value || COLORS.blue;
  }
}

function cssUrl(value) {
  return String(value).replace(/["\\]/g, "");
}

/**
 * Abre o seletor de capa. Resolve com { type, value } ou { type: null }
 * para remover, ou null se cancelado.
 */
export function openCoverPicker({ hasCover = false } = {}) {
  return openModal({
    title: "Capa da página",
    width: 620,
    render: (body, close) => {
      const tabs = [
        ["Galeria", () => renderGallery(close)],
        ["Cor", () => renderColors(close)],
        ["URL", () => renderUrl(close)],
        ["Upload", () => renderUpload(close)],
      ];

      const nav = document.createElement("div");
      nav.className = "ws-tabs";
      nav.setAttribute("role", "tablist");
      const panel = document.createElement("div");
      panel.className = "ws-cover-panel";

      tabs.forEach(([label, render], index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ws-tab${index === 0 ? " is-active" : ""}`;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", index === 0 ? "true" : "false");
        button.textContent = label;
        button.addEventListener("click", () => {
          nav.querySelectorAll(".ws-tab").forEach((t) => {
            t.classList.remove("is-active");
            t.setAttribute("aria-selected", "false");
          });
          button.classList.add("is-active");
          button.setAttribute("aria-selected", "true");
          panel.replaceChildren(render());
        });
        nav.appendChild(button);
      });

      body.appendChild(nav);
      panel.appendChild(tabs[0][1]());
      body.appendChild(panel);

      if (hasCover) {
        const footer = document.createElement("div");
        footer.className = "ws-modal__footer";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ws-btn ws-btn--ghost";
        remove.textContent = "Remover capa";
        remove.addEventListener("click", () => close({ type: null }));
        footer.appendChild(remove);
        body.appendChild(footer);
      }
    },
  });
}

function renderGallery(close) {
  const grid = document.createElement("div");
  grid.className = "ws-cover-grid";
  for (const [key, css] of Object.entries(GRADIENTS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-cover-swatch";
    button.style.backgroundImage = css;
    button.setAttribute("aria-label", `Gradiente ${key}`);
    button.addEventListener("click", () => close({ type: "gradient", value: key }));
    grid.appendChild(button);
  }
  return grid;
}

function renderColors(close) {
  const grid = document.createElement("div");
  grid.className = "ws-cover-grid";
  for (const [key, hex] of Object.entries(COLORS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-cover-swatch";
    button.style.backgroundColor = hex;
    button.setAttribute("aria-label", `Cor ${key}`);
    button.addEventListener("click", () => close({ type: "color", value: key }));
    grid.appendChild(button);
  }
  return grid;
}

function renderUrl(close) {
  const wrap = document.createElement("div");
  wrap.className = "ws-stack";

  const input = document.createElement("input");
  input.type = "url";
  input.className = "ws-input";
  input.placeholder = "https://exemplo.com/imagem.jpg";
  input.setAttribute("aria-label", "URL da imagem de capa");

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "ws-btn ws-btn--primary";
  submit.textContent = "Usar imagem";
  submit.addEventListener("click", () => {
    const value = input.value.trim();
    if (!/^https?:\/\//i.test(value)) {
      toast("Informe uma URL http(s) válida.", { tone: "warn" });
      return;
    }
    close({ type: "image", value });
  });

  wrap.append(input, submit);
  return wrap;
}

function renderUpload(close) {
  const wrap = document.createElement("div");
  wrap.className = "ws-stack";

  const input = document.createElement("input");
  input.type = "file";
  input.className = "ws-input";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.setAttribute("aria-label", "Arquivo de capa");

  const status = document.createElement("p");
  status.className = "ws-muted";
  status.textContent = `Até ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. O arquivo é guardado no nosso storage.`;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      status.textContent = "Arquivo grande demais. Reduza a imagem ou use uma URL.";
      return;
    }
    status.textContent = "Enviando…";
    try {
      const uploaded = await uploadFile(file);
      close({ type: "image", value: uploaded.public_url });
    } catch (err) {
      status.textContent =
        err.code === "storage_unavailable"
          ? "Storage indisponível. Verifique o bucket workspace-files (docs/runbook.md)."
          : "Não foi possível enviar. Tente de novo ou use uma URL.";
    }
  });

  wrap.append(input, status);
  return wrap;
}

/** Lê o arquivo como data URL e envia para /api/files. */
export async function uploadFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { file: saved } = await api.files.upload({
    name: file.name,
    mimeType: file.type,
    dataUrl,
  });
  return saved;
}

export { MAX_UPLOAD_BYTES };
