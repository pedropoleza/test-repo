/**
 * Menu de ações do bloco (§12), aberto pelo drag handle.
 */
import { openMenu } from "../ui/menu.js";
import { TEXT_COLORS, blockSpec } from "../shared/blocks.js";
import { SLASH_COMMANDS } from "./slash-menu.js";

const COLOR_LABEL = {
  default: "Padrão", gray: "Cinza", brown: "Marrom", orange: "Laranja",
  yellow: "Amarelo", green: "Verde", blue: "Azul", purple: "Roxo",
  pink: "Rosa", red: "Vermelho",
};

/** `handlers` recebe as ações já resolvidas — o menu não conhece a API. */
export function openBlockMenu(anchor, block, handlers) {
  const canTurnInto = blockSpec(block.type).rich || block.type === "code";

  openMenu({
    anchor,
    width: 236,
    items: [
      { id: "duplicate", label: "Duplicar", icon: "⧉", hint: "Ctrl+D" },
      ...(canTurnInto ? [{ id: "turn-into", label: "Transformar em…", icon: "↻" }] : []),
      { id: "color", label: "Cor do texto…", icon: "A" },
      { id: "background", label: "Cor de fundo…", icon: "▧" },
      { separator: true },
      { id: "copy-link", label: "Copiar link do bloco", icon: "🔗" },
      { separator: true },
      { id: "delete", label: "Excluir", icon: "🗑", danger: true },
    ],
    onSelect: (id) => {
      if (id === "turn-into") return openTurnIntoMenu(anchor, block, handlers);
      if (id === "color") return openColorMenu(anchor, block, handlers, "color");
      if (id === "background") return openColorMenu(anchor, block, handlers, "background");
      handlers[id]?.(block);
    },
  });
}

function openTurnIntoMenu(anchor, block, handlers) {
  const targets = SLASH_COMMANDS.filter((cmd) =>
    ["paragraph", "heading1", "heading2", "heading3", "heading4",
     "bulleted_list", "numbered_list", "checklist", "toggle",
     "quote", "callout", "code"].includes(cmd.id),
  );

  openMenu({
    anchor,
    width: 220,
    items: targets.map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      icon: cmd.icon,
      disabled: cmd.id === block.type,
    })),
    onSelect: (type) => handlers["turn-into"]?.(block, type),
  });
}

function openColorMenu(anchor, block, handlers, field) {
  openMenu({
    anchor,
    width: 200,
    items: TEXT_COLORS.map((color) => ({
      id: color,
      label: COLOR_LABEL[color] || color,
      icon: color === "default" ? "○" : "●",
      disabled: (block.props?.[field] || "default") === color,
    })),
    onSelect: (color) => handlers.recolor?.(block, field, color),
  });
}
