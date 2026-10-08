/**
 * A ficha de um registro, aberta por cima do quadro.
 *
 * O card é a lombada; esta é a ficha aberta. Todos os campos do registro,
 * cada um editável no lugar — inclusive os que não cabem na frente do
 * card. É aqui que se escreve o telefone do lead sem ir para outra tela,
 * e é daqui que se cria um campo novo quando a ficha precisa de um dado
 * que ninguém tinha previsto.
 *
 * Apagar um DADO e apagar um CAMPO são coisas diferentes, e a ficha trata
 * as duas assim: "Limpar" esvazia o valor deste lead; excluir o campo é
 * uma ação da coluna, na tabela, porque afeta todos os leads.
 */
import { api } from "../api.js";
import { openModal, openMenu } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { renderCellValue, editCell } from "./cells.js";
import { openNewFieldMenu } from "./field-editor.js";
import { importarCamposDoCrm } from "./crm-import-ui.js";
import { fieldSpec, isEmptyValue, readValue } from "../shared/fields.js";

/**
 * Abre a ficha de `record`. Resolve quando fecha, dizendo se algo mudou —
 * o quadro só se repinta se mudou.
 */
export function abrirFicha(record, { databaseId, fields, onOpenPage }) {
  let mexeu = false;

  return openModal({
    title: "Ficha",
    width: 560,
    render: (body, close) => {
      const painel = document.createElement("div");
      painel.className = "ws-ficha";

      /* --- título (a coluna principal da database) --- */
      const principal = fields.find((f) => f.is_primary);
      const titulo = document.createElement("input");
      titulo.className = "ws-ficha__titulo";
      titulo.value = record.title || "";
      titulo.placeholder = principal?.name || "Sem título";
      titulo.setAttribute("aria-label", principal?.name || "Título");
      titulo.addEventListener("change", async () => {
        const antes = record.title;
        record.title = titulo.value;
        try {
          const { record: salvo } = await api.databases.updateRecord(record.id, {
            title: titulo.value,
          });
          record.title = salvo.title;
          mexeu = true;
        } catch {
          record.title = antes;
          titulo.value = antes || "";
          toast("Não foi possível salvar o nome.", { tone: "danger" });
        }
      });
      painel.appendChild(titulo);

      const lista = document.createElement("div");
      lista.className = "ws-ficha__campos";
      painel.appendChild(lista);
      desenharCampos();

      /* --- rodapé --- */
      const pe = document.createElement("div");
      pe.className = "ws-ficha__pe";

      const novo = document.createElement("button");
      novo.type = "button";
      novo.className = "ws-btn ws-btn--ghost ws-btn--sm";
      novo.textContent = "+ Novo campo";
      novo.addEventListener("click", () => {
        openNewFieldMenu(novo, databaseId, () => {
          mexeu = true;
          // O campo novo só existe no servidor; recarregar aqui dentro
          // seria refazer a ficha com dados meio velhos. Fecha e deixa o
          // quadro recarregar — o campo aparece já com a coluna no lugar.
          close(true);
        });
      });
      pe.appendChild(novo);

      // O atalho mora aqui também: é abrindo a ficha que se percebe que
      // falta o campo que a conta já tem no CRM.
      const doCrm = document.createElement("button");
      doCrm.type = "button";
      doCrm.className = "ws-btn ws-btn--ghost ws-btn--sm";
      doCrm.textContent = "Importar do CRM";
      doCrm.addEventListener("click", async () => {
        if (await importarCamposDoCrm({ databaseId, fields })) { mexeu = true; close(true); }
      });
      pe.appendChild(doCrm);

      if (onOpenPage) {
        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.className = "ws-btn ws-btn--ghost ws-btn--sm";
        abrir.textContent = "Abrir como página ↗";
        abrir.addEventListener("click", () => { close(mexeu); onOpenPage(record.id); });
        pe.appendChild(abrir);
      }

      const excluir = document.createElement("button");
      excluir.type = "button";
      excluir.className = "ws-btn ws-btn--ghost ws-btn--sm ws-ficha__excluir";
      excluir.textContent = "Excluir";
      excluir.addEventListener("click", () => {
        openMenu({
          anchor: excluir,
          width: 240,
          items: [{ id: "sim", label: "Excluir esta ficha", icon: "🗑", danger: true }],
          onSelect: async () => {
            try {
              await api.databases.removeRecord(record.id);
              close(true);
            } catch { toast("Não foi possível excluir.", { tone: "danger" }); }
          },
        });
      });
      pe.appendChild(excluir);
      painel.appendChild(pe);

      body.appendChild(painel);
      requestAnimationFrame(() => titulo.focus());

      function desenharCampos() {
        lista.replaceChildren();
        for (const field of fields) {
          if (field.is_primary) continue;
          lista.appendChild(linha(field));
        }
        if (!fields.some((f) => !f.is_primary)) {
          const vazio = document.createElement("p");
          vazio.className = "ws-muted";
          vazio.textContent = "Esta ficha ainda não tem campos. Crie o primeiro abaixo.";
          lista.appendChild(vazio);
        }
      }

      function linha(field) {
        const row = document.createElement("div");
        row.className = "ws-ficha__campo";

        const rotulo = document.createElement("span");
        rotulo.className = "ws-ficha__rotulo";
        const icone = document.createElement("span");
        icone.className = "ws-ficha__icone";
        icone.textContent = fieldSpec(field.type).icon;
        const nome = document.createElement("span");
        nome.textContent = field.name;
        rotulo.append(icone, nome);

        const valor = document.createElement("div");
        valor.className = "ws-ficha__valor";
        const somenteLeitura = fieldSpec(field.type).readOnly;
        if (!somenteLeitura) {
          valor.tabIndex = 0;
          valor.setAttribute("role", "button");
          valor.setAttribute("aria-label", `Editar ${field.name}`);
        }

        const pintar = () => {
          valor.replaceChildren(renderCellValue(field, record));
          if (isEmptyValue(readValue(field, record)) && field.type !== "checkbox") {
            const vazio = document.createElement("span");
            vazio.className = "ws-ficha__vazio";
            vazio.textContent = somenteLeitura ? "—" : "Vazio";
            valor.replaceChildren(vazio);
          }
          limpar.hidden = somenteLeitura || isEmptyValue(readValue(field, record));
        };

        const editar = () => {
          if (somenteLeitura) return;
          valor.classList.add("is-editing");
          editCell(valor, field, record, {
            commit: (v) => salvar(field, v),
            done: () => {
              valor.classList.remove("is-editing");
              if (valor.isConnected) pintar();
            },
          });
        };
        valor.addEventListener("click", editar);
        valor.addEventListener("keydown", (e) => {
          if (e.target !== valor) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editar(); }
        });

        // "Limpar" apaga o dado DESTE lead. Excluir o campo é outra coisa
        // (afeta todos) e mora no cabeçalho da coluna, na tabela.
        const limpar = document.createElement("button");
        limpar.type = "button";
        limpar.className = "ws-ficha__limpar";
        limpar.textContent = "Limpar";
        limpar.setAttribute("aria-label", `Limpar ${field.name}`);
        limpar.addEventListener("click", async (e) => {
          e.stopPropagation();
          await salvar(field, null);
          pintar();
        });

        pintar();
        row.append(rotulo, valor, limpar);
        return row;
      }

      async function salvar(field, value) {
        const antes = { ...(record.properties || {}) };
        record.properties = { ...antes, [field.key]: value };
        try {
          const { record: salvo } = await api.databases.updateRecord(record.id, {
            properties: { [field.key]: value },
          });
          record.properties = salvo.properties;
          record.title = salvo.title;
          mexeu = true;
        } catch {
          record.properties = antes;
          toast("Não foi possível salvar o campo.", { tone: "danger" });
        }
      }
    },
  }).then((r) => (r === undefined ? mexeu : r || mexeu));
}
