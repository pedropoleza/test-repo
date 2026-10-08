/**
 * "Importar campos do CRM": trazer os campos personalizados da conta
 * para a ficha desta database.
 *
 * Mostra o que seria criado ANTES de criar. Importar sete campos de uma
 * vez numa ficha é uma ação que ninguém quer descobrir depois de feita —
 * e desfazer significaria apagar coluna por coluna.
 */
import { api } from "../api.js";
import { openModal } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { fieldSpec } from "../shared/fields.js";
import { camposImportaveis, paraCriacao } from "../shared/crm-import.js";

/** Abre o seletor. Resolve `true` se algo foi criado. */
export async function importarCamposDoCrm({ databaseId, fields }) {
  let colunas = [];
  try {
    const r = await api.crm.fields();
    colunas = r.columns || [];
  } catch {
    toast("Não foi possível ler os campos do CRM.", { tone: "danger" });
    return false;
  }

  const candidatos = camposImportaveis(colunas, fields);
  if (!candidatos.length) {
    toast(colunas.length
      ? "A ficha já tem todos os campos personalizados da conta."
      : "Esta conta não tem campos personalizados no CRM.", { tone: "info" });
    return false;
  }

  // Marcados por padrão: quem abriu a importação quer importar. Desmarcar
  // o que não serve é menos trabalho que marcar sete.
  const escolhidos = new Set(candidatos.map((c) => c.name));

  return openModal({
    title: "Importar campos do CRM",
    width: 520,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const explica = document.createElement("p");
      explica.className = "ws-muted";
      explica.textContent = "Cria na ficha os campos personalizados que a conta já usa, "
        + "com o mesmo nome, tipo e opções. É uma cópia da definição — o valor de cada "
        + "lead continua sendo o que você escrever aqui.";
      stack.appendChild(explica);

      const lista = document.createElement("div");
      lista.className = "ws-import__lista";
      for (const campo of candidatos) {
        const linha = document.createElement("label");
        linha.className = "ws-import__item";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "ws-checkbox";
        box.checked = true;
        box.addEventListener("change", () => {
          if (box.checked) escolhidos.add(campo.name);
          else escolhidos.delete(campo.name);
          criar.disabled = escolhidos.size === 0;
          criar.textContent = rotulo();
        });
        const nome = document.createElement("span");
        nome.className = "ws-import__nome";
        nome.textContent = campo.name;
        const tipo = document.createElement("span");
        tipo.className = "ws-import__tipo";
        const final = paraCriacao(campo);
        tipo.textContent = fieldSpec(final.type).label
          + (final.config?.options?.length ? ` · ${final.config.options.length} opções` : "");
        linha.append(box, nome, tipo);
        lista.appendChild(linha);
      }
      stack.appendChild(lista);

      const acoes = document.createElement("div");
      acoes.className = "ws-modal__actions";
      const cancelar = document.createElement("button");
      cancelar.type = "button";
      cancelar.className = "ws-btn ws-btn--ghost";
      cancelar.textContent = "Cancelar";
      cancelar.addEventListener("click", () => close(false));

      const rotulo = () => `Importar ${escolhidos.size} campo${escolhidos.size === 1 ? "" : "s"}`;
      const criar = document.createElement("button");
      criar.type = "button";
      criar.className = "ws-btn ws-btn--primary";
      criar.textContent = rotulo();
      criar.addEventListener("click", async () => {
        criar.disabled = true;
        criar.textContent = "Importando…";
        const alvo = candidatos.filter((c) => escolhidos.has(c.name));
        let feitos = 0;
        // Um a um, e em série: a ordem dos campos na ficha é a ordem em
        // que foram criados, e em paralelo ela sairia embaralhada.
        for (const campo of alvo) {
          try {
            await api.databases.createField(databaseId, paraCriacao(campo));
            feitos += 1;
          } catch { /* segue: um campo recusado não aborta os outros */ }
        }
        if (feitos < alvo.length) {
          toast(`${feitos} de ${alvo.length} campos importados.`, { tone: "warn" });
        } else {
          toast(`${feitos} campo${feitos === 1 ? "" : "s"} importado${feitos === 1 ? "" : "s"}.`,
            { tone: "success" });
        }
        close(feitos > 0);
      });
      acoes.append(cancelar, criar);
      stack.appendChild(acoes);
      body.appendChild(stack);
    },
  }).then((v) => !!v);
}
