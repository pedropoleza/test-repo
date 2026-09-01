/**
 * Diálogos de texto e de cópia — os nossos, no lugar de window.prompt().
 *
 * O prompt do navegador é um corpo estranho na interface: usa a fonte e o
 * tema do sistema, mostra o domínio ("workspace-engine.vercel.app says"),
 * não valida, não explica o que um valor vazio faz, não tem botão de
 * remover, e no celular vira uma caixa do sistema. Pior: trava a página
 * inteira, então nem dá para consultar o que estava na tela antes de
 * responder.
 *
 * Estas duas funções são o caminho único para pedir um texto ou entregar
 * um link. Se aparecer um window.prompt de novo em qualquer campo, é bug.
 */
import { openModal } from "./menu.js";
import { toast } from "./toast.js";

/**
 * Pede um texto. Resolve com a string (já trimada) ou null se cancelado.
 *
 * `allowEmpty` existe para os campos em que apagar É a ação — tirar o
 * link de um trecho, por exemplo. Nesse caso resolve com "" em vez de
 * null, para quem chama distinguir "apagou" de "desistiu".
 */
export function openPrompt({
  title,
  label,
  value = "",
  placeholder = "",
  hint = "",
  confirmLabel = "Salvar",
  allowEmpty = false,
  removeLabel = null,
  type = "text",
  maxLength = 2000,
  validate = null,
} = {}) {
  return openModal({
    title,
    width: 460,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const field = document.createElement("label");
      field.className = "ws-field";
      if (label) {
        const span = document.createElement("span");
        span.className = "ws-field__label";
        span.textContent = label;
        field.appendChild(span);
      }

      const input = document.createElement("input");
      input.className = "ws-input";
      input.type = type;
      input.value = value || "";
      input.placeholder = placeholder;
      input.maxLength = maxLength;
      if (!label) input.setAttribute("aria-label", title);
      field.appendChild(input);
      stack.appendChild(field);

      const erro = document.createElement("p");
      erro.className = "ws-field__error";
      erro.hidden = true;
      stack.appendChild(erro);

      if (hint) {
        const p = document.createElement("p");
        p.className = "ws-muted";
        p.textContent = hint;
        stack.appendChild(p);
      }

      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ws-btn ws-btn--ghost";
      cancel.textContent = "Cancelar";
      cancel.addEventListener("click", () => close(null));
      footer.appendChild(cancel);

      // Botão explícito de remover: apagar o campo e confirmar é um gesto
      // que ninguém adivinha, e era o que o prompt pedia com "(vazio
      // remove o link)".
      if (removeLabel && value) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ws-btn ws-btn--danger";
        remove.textContent = removeLabel;
        remove.addEventListener("click", () => close(""));
        footer.appendChild(remove);
      }

      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "ws-btn ws-btn--primary";
      submit.textContent = confirmLabel;
      footer.appendChild(submit);

      const commit = () => {
        const texto = input.value.trim();
        if (!texto && !allowEmpty) return invalido("Preencha este campo.");
        const problema = texto && validate ? validate(texto) : null;
        if (problema) return invalido(problema);
        close(texto);
      };

      function invalido(mensagem) {
        erro.textContent = mensagem;
        erro.hidden = false;
        input.classList.add("is-invalid");
        input.focus();
        input.select();
      }

      submit.addEventListener("click", commit);
      input.addEventListener("input", () => {
        input.classList.remove("is-invalid");
        erro.hidden = true;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
      });

      stack.appendChild(footer);
      body.appendChild(stack);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    },
  });
}

/**
 * Entrega um link para copiar.
 *
 * Só aparece quando a área de transferência do navegador é negada — o
 * caminho normal é copiar direto e avisar por toast. Aqui o texto vem
 * pré-selecionado e há um botão que tenta copiar de novo, em vez de um
 * prompt em que a pessoa tem que selecionar à mão.
 */
export function openCopyLink({ title = "Copiar link", url, hint = "" } = {}) {
  return openModal({
    title,
    width: 520,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const row = document.createElement("div");
      row.className = "ws-copy__row";

      const input = document.createElement("input");
      input.className = "ws-input";
      input.value = url;
      input.readOnly = true;
      input.setAttribute("aria-label", "Link");
      input.addEventListener("focus", () => input.select());

      const copiar = document.createElement("button");
      copiar.type = "button";
      copiar.className = "ws-btn ws-btn--primary";
      copiar.textContent = "Copiar";
      copiar.addEventListener("click", async () => {
        input.select();
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copiado.", { tone: "success" });
          close(true);
        } catch {
          // Alguns navegadores só liberam a área de transferência num
          // gesto direto; se nem assim, o texto já está selecionado e
          // Ctrl+C resolve.
          copiar.textContent = "Use Ctrl+C";
        }
      });

      row.append(input, copiar);
      stack.appendChild(row);

      if (hint) {
        const p = document.createElement("p");
        p.className = "ws-muted";
        p.textContent = hint;
        stack.appendChild(p);
      }

      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";
      const fechar = document.createElement("button");
      fechar.type = "button";
      fechar.className = "ws-btn ws-btn--ghost";
      fechar.textContent = "Fechar";
      fechar.addEventListener("click", () => close(false));
      footer.appendChild(fechar);
      stack.appendChild(footer);

      body.appendChild(stack);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    },
  });
}
