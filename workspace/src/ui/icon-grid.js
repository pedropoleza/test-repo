/**
 * Grade de ícones para os diálogos de seção e de lista.
 *
 * Antes cada um abria um menu com oito emojis, e cada linha mostrava o
 * mesmo emoji DUAS vezes — o menu põe `icon` à esquerda e `label` no
 * corpo, e os dois recebiam o emoji. Numa grade o ícone aparece uma vez,
 * que é o que ele é.
 *
 * A lista é a mesma do seletor completo, para não haver duas curadorias
 * divergindo com o tempo.
 */
import { EMOJI_LIST } from "../icon-picker.js";

/**
 * `onPick(emoji)` a cada escolha. `getValue()` diz qual está marcado,
 * para a grade refletir a seleção sem guardar estado próprio.
 */
export function renderIconGrid({ onPick, getValue = () => null } = {}) {
  const grade = document.createElement("div");
  grade.className = "ws-icon-grid";
  grade.setAttribute("role", "listbox");
  grade.setAttribute("aria-label", "Escolher ícone");

  const botoes = new Map();
  for (const emoji of EMOJI_LIST) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ws-icon-grid__item";
    b.textContent = emoji;
    b.title = emoji;
    b.setAttribute("role", "option");
    b.setAttribute("aria-label", `Ícone ${emoji}`);
    b.addEventListener("click", () => {
      onPick?.(emoji);
      marcar();
    });
    botoes.set(emoji, b);
    grade.appendChild(b);
  }

  function marcar() {
    const atual = getValue();
    for (const [emoji, b] of botoes) {
      const escolhido = emoji === atual;
      b.classList.toggle("is-selected", escolhido);
      b.setAttribute("aria-selected", escolhido ? "true" : "false");
    }
  }
  marcar();

  return { el: grade, refresh: marcar };
}
