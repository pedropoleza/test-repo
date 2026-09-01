/**
 * Escolher um contato da conta, com busca.
 *
 * Serve ao comando "/contato": é o que permite juntar mais de uma pessoa
 * numa página só — dois contatos lado a lado para comparar, ou a família
 * inteira numa capa comum.
 *
 * A lista vem do CRM e é filtrada aqui, não a cada tecla no servidor:
 * são algumas centenas de contatos, e uma ida ao CRM por letra digitada
 * deixaria a busca lenta justamente enquanto se digita.
 */
import { api } from "../api.js";
import { openModal } from "../ui/menu.js";
import { renderAvatar } from "./photo.js";
import { renderLoader } from "../ui/loader.js";

/** Resolve com { id, nome } ou null se cancelado. */
export function openContactPicker({ title = "Adicionar contato" } = {}) {
  return openModal({
    title,
    width: 520,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const busca = document.createElement("input");
      busca.type = "search";
      busca.className = "ws-input";
      busca.placeholder = "Buscar por nome, e-mail ou telefone…";
      busca.setAttribute("aria-label", "Buscar contato");

      const lista = document.createElement("div");
      lista.className = "ws-picker__list";
      lista.setAttribute("role", "listbox");

      const estado = renderLoader("Carregando os contatos…", { compact: true });

      stack.append(busca, estado, lista);
      body.appendChild(stack);

      let contatos = [];

      api.crm.contacts(300).then((data) => {
        contatos = (data.records || []).map((r) => ({
          id: r.externalId,
          nome: r.title,
          email: r.properties?.email || "",
          telefone: r.properties?.phone || "",
        }));
        estado.remove();
        pintar("");
      }).catch(() => {
        const erro = document.createElement("p");
        erro.className = "ws-muted";
        erro.textContent = "Não foi possível carregar os contatos da conta.";
        estado.replaceWith(erro);
      });

      function pintar(termo) {
        const t = termo.trim().toLowerCase();
        const achados = (t
          ? contatos.filter((c) => `${c.nome} ${c.email} ${c.telefone}`.toLowerCase().includes(t))
          : contatos
        ).slice(0, 60);   // teto para a lista não virar uma página inteira

        lista.replaceChildren();
        if (!achados.length) {
          const vazio = document.createElement("p");
          vazio.className = "ws-muted";
          vazio.textContent = t ? "Nenhum contato com esse termo." : "Nenhum contato na conta.";
          lista.appendChild(vazio);
          return;
        }

        for (const c of achados) {
          const linha = document.createElement("button");
          linha.type = "button";
          linha.className = "ws-picker__row";
          linha.setAttribute("role", "option");

          const face = renderAvatar({ title: c.nome }, { size: 26 });
          const texto = document.createElement("span");
          texto.className = "ws-picker__text";
          const nome = document.createElement("span");
          nome.className = "ws-picker__name";
          nome.textContent = c.nome;
          const sub = document.createElement("span");
          sub.className = "ws-picker__sub";
          sub.textContent = [c.email, c.telefone].filter(Boolean).join(" · ");
          texto.append(nome, sub);

          linha.append(face, texto);
          linha.addEventListener("click", () => close({ id: c.id, nome: c.nome }));
          lista.appendChild(linha);
        }
      }

      let timer = null;
      busca.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => pintar(busca.value), 140);
      });
      busca.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        lista.querySelector(".ws-picker__row")?.click();   // Enter pega o primeiro
      });

      requestAnimationFrame(() => busca.focus());
    },
  });
}
