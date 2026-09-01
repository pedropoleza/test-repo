/**
 * Seletor de ícone da página (§8).
 *
 * Emoji nativo + URL de imagem. Sem dependência externa: a lista é
 * curada e vem com palavras-chave em pt-BR, o que dá busca útil sem
 * carregar um pacote de emoji inteiro no primeiro paint.
 */
import { openModal } from "./ui/menu.js";

const EMOJI = [
  ["Trabalho", [
    ["📄", "documento página doc"], ["📝", "nota anotação escrever"],
    ["📋", "prancheta checklist"], ["📊", "gráfico dados relatório"],
    ["📈", "crescimento alta métrica"], ["📉", "queda baixa"],
    ["🗂️", "pasta arquivo organização"], ["📁", "pasta"],
    ["🗃️", "arquivo caixa"], ["📌", "fixar pin"],
    ["📎", "clipe anexo"], ["🖇️", "clipes"],
    ["✅", "feito concluído ok"], ["☑️", "checkbox marcado"],
    ["🎯", "meta objetivo alvo"], ["🚀", "lançamento foguete crescimento"],
    ["💡", "ideia insight"], ["🔧", "ferramenta config"],
    ["⚙️", "engrenagem configuração ajustes"], ["🧭", "bússola direção"],
  ]],
  ["Negócio", [
    ["💼", "maleta negócio trabalho"], ["🏢", "empresa prédio escritório"],
    ["🤝", "parceria acordo handshake"], ["💰", "dinheiro receita"],
    ["💳", "cartão pagamento"], ["🧾", "recibo nota fiscal"],
    ["📣", "anúncio marketing megafone"], ["📢", "alto-falante divulgação"],
    ["🛒", "carrinho compra vendas"], ["🏷️", "etiqueta preço tag"],
    ["👥", "pessoas time equipe clientes"], ["👤", "pessoa usuário contato"],
    ["📞", "telefone ligação"], ["✉️", "email mensagem"],
    ["📅", "calendário agenda data"], ["⏰", "alarme prazo hora"],
  ]],
  ["Conteúdo", [
    ["📚", "livros conhecimento base"], ["📖", "livro leitura manual"],
    ["🔖", "marcador bookmark"], ["🗒️", "bloco notas"],
    ["🖊️", "caneta escrever"], ["🎨", "design arte criativo"],
    ["🖼️", "imagem foto"], ["🎬", "vídeo filme"],
    ["🎧", "áudio podcast"], ["🎤", "microfone gravação"],
    ["📷", "câmera foto"], ["🔍", "busca pesquisa lupa"],
  ]],
  ["Status", [
    ["🟢", "verde ativo ok"], ["🟡", "amarelo atenção"],
    ["🔴", "vermelho parado erro"], ["🔵", "azul info"],
    ["⭐", "estrela favorito destaque"], ["🔥", "quente urgente prioridade"],
    ["⚡", "rápido energia automação"], ["🏆", "troféu prêmio conquista"],
    ["🔒", "privado bloqueado seguro"], ["🔓", "aberto público"],
    ["⚠️", "aviso alerta risco"], ["🚧", "obra em andamento wip"],
    ["♻️", "reciclar processo"], ["🧪", "teste experimento"],
  ]],
  ["Geral", [
    ["🏠", "casa home início"], ["🌐", "web site global"],
    ["🧩", "peça integração módulo"], ["🗺️", "mapa roadmap"],
    ["🧠", "cérebro conhecimento estratégia"], ["❤️", "coração favorito"],
    ["✨", "brilho novo destaque"], ["🌱", "planta crescimento início"],
    ["🍀", "sorte trevo"], ["☕", "café pausa"],
    ["🎉", "festa comemoração"], ["🧊", "gelo frio backlog"],
  ]],
];

/**
 * A lista achatada, para quem só precisa de uma grade de escolha rápida.
 * São 74 — o bastante para não obrigar a abrir o seletor completo a cada
 * seção nova.
 */
export const EMOJI_LIST = EMOJI.flatMap(([, itens]) => itens.map(([emoji]) => emoji));

const RECENT_KEY = "workspace:recentIcons";

function recentIcons() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 12);
  } catch {
    return [];
  }
}

function rememberIcon(emoji) {
  try {
    const list = [emoji, ...recentIcons().filter((e) => e !== emoji)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

/**
 * Abre o seletor. Resolve com:
 *   { type: 'emoji', value }  |  { type: 'url', value }  |  { type: null }  |  null (cancelado)
 */
export function openIconPicker({ hasIcon = false } = {}) {
  return openModal({
    title: "Ícone da página",
    width: 520,
    render: (body, close) => {
      const search = document.createElement("input");
      search.type = "search";
      search.className = "ws-input";
      search.placeholder = "Buscar ícone…";
      search.setAttribute("aria-label", "Buscar ícone");
      body.appendChild(search);

      const grid = document.createElement("div");
      grid.className = "ws-emoji-grid";
      body.appendChild(grid);

      const renderGrid = (query) => {
        grid.replaceChildren();
        const term = query.trim().toLowerCase();

        const sections = term
          ? [["Resultados", EMOJI.flatMap(([, items]) => items).filter(
              ([emoji, keywords]) => keywords.includes(term) || keywords.split(" ").some((k) => k.startsWith(term)) || emoji === term,
            )]]
          : [["Recentes", recentIcons().map((e) => [e, ""])], ...EMOJI];

        for (const [label, items] of sections) {
          if (!items.length) continue;
          const heading = document.createElement("div");
          heading.className = "ws-emoji-grid__label";
          heading.textContent = label;
          grid.appendChild(heading);

          const row = document.createElement("div");
          row.className = "ws-emoji-grid__row";
          for (const [emoji, keywords] of items) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "ws-emoji";
            button.textContent = emoji;
            button.title = keywords || emoji;
            button.setAttribute("aria-label", keywords || emoji);
            button.addEventListener("click", () => {
              rememberIcon(emoji);
              close({ type: "emoji", value: emoji });
            });
            row.appendChild(button);
          }
          grid.appendChild(row);
        }

        if (!grid.childElementCount) {
          const empty = document.createElement("p");
          empty.className = "ws-muted";
          empty.textContent = "Nenhum ícone encontrado. Tente outra palavra.";
          grid.appendChild(empty);
        }
      };

      search.addEventListener("input", () => renderGrid(search.value));
      renderGrid("");

      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";

      const urlField = document.createElement("input");
      urlField.type = "url";
      urlField.className = "ws-input ws-input--sm";
      urlField.placeholder = "https://… (imagem)";
      urlField.setAttribute("aria-label", "URL da imagem do ícone");
      footer.appendChild(urlField);

      const useUrl = document.createElement("button");
      useUrl.type = "button";
      useUrl.className = "ws-btn";
      useUrl.textContent = "Usar URL";
      useUrl.addEventListener("click", () => {
        const value = urlField.value.trim();
        if (value) close({ type: "url", value });
      });
      footer.appendChild(useUrl);

      if (hasIcon) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ws-btn ws-btn--ghost";
        remove.textContent = "Remover";
        remove.addEventListener("click", () => close({ type: null }));
        footer.appendChild(remove);
      }

      body.appendChild(footer);
    },
  });
}

/** Monta o nó visual de um ícone (sidebar, breadcrumb, cabeçalho). */
export function renderIcon(iconType, iconValue, { size = 18 } = {}) {
  if (iconType === "url" && iconValue) {
    const img = document.createElement("img");
    img.className = "ws-icon-img";
    img.src = iconValue;
    img.alt = "";
    img.width = size;
    img.height = size;
    img.loading = "lazy";
    return img;
  }
  const span = document.createElement("span");
  span.className = "ws-icon-emoji";
  span.style.fontSize = `${size}px`;
  span.textContent = iconType === "emoji" && iconValue ? iconValue : "📄";
  return span;
}
