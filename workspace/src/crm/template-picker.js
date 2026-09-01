/**
 * Escolha de modelo de ficha.
 *
 * Um diálogo nosso, nunca um `prompt` do navegador — a regra vale para
 * todo campo do app. Mostra o que cada modelo traz antes de aplicar,
 * porque aplicar acrescenta 20 blocos à página e ninguém quer descobrir
 * isso depois.
 */
import { openModal } from "../ui/menu.js";
import { TEMPLATES } from "../shared/templates.js";

/** Devolve o id do modelo escolhido, ou null se a pessoa desistiu. */
export function openTemplatePicker({ sugerido = null } = {}) {
  return openModal({
    title: "Modelo de ficha",
    width: 520,
    render: (body, close) => {
      const intro = document.createElement("p");
      intro.className = "ws-muted ws-modal__intro";
      intro.textContent = "As seções do modelo entram no fim da página. "
        + "Nada do que já está escrito é apagado.";
      body.appendChild(intro);

      const lista = document.createElement("div");
      lista.className = "ws-template-list";

      for (const modelo of TEMPLATES) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "ws-template";

        const icone = document.createElement("span");
        icone.className = "ws-template__icon";
        icone.textContent = modelo.icone;

        const corpo = document.createElement("span");
        corpo.className = "ws-template__body";
        const nome = document.createElement("span");
        nome.className = "ws-template__name";
        nome.textContent = modelo.nome;
        if (modelo.id === sugerido) {
          const marca = document.createElement("span");
          marca.className = "ws-template__hint";
          marca.textContent = "sugerido pela pipeline";
          nome.appendChild(marca);
        }
        const desc = document.createElement("span");
        desc.className = "ws-template__desc";
        desc.textContent = modelo.descricao;
        corpo.append(nome, desc);

        botao.append(icone, corpo);
        botao.addEventListener("click", () => close(modelo.id));
        lista.appendChild(botao);
      }

      body.appendChild(lista);
      // O sugerido recebe o foco: na maioria das vezes é ele mesmo, e
      // aí escolher é só apertar Enter.
      const alvo = sugerido
        ? lista.children[TEMPLATES.findIndex((t) => t.id === sugerido)]
        : lista.firstElementChild;
      alvo?.focus();
    },
  });
}
