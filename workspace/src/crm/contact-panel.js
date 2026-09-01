/**
 * Painel do contato dentro da pasta: os dados do CRM ao vivo e editáveis,
 * no meio do conteúdo da página.
 *
 * Existe porque a ficha nasceu como um retrato — os blocos guardavam o
 * valor do dia em que a pasta foi criada. Servia para ler, não para
 * trabalhar: mudar o estágio ou corrigir um telefone obrigava a voltar
 * para a tabela. Este bloco lê do CRM na hora e grava de volta.
 *
 * O que a pessoa escreve na página continua em blocos normais; aqui
 * ficam só os campos que pertencem ao CRM.
 */
import { api } from "../api.js";
import { renderCellValue, editCell } from "../database/cells.js";
import { isEmptyValue, optionColor } from "../shared/fields.js";
import { isWritable, isMoveField, openStageMenu, commitField, commitMove } from "./editing.js";
import { groupRelations } from "../shared/relations.js";
import { renderAvatar } from "./photo.js";
import { toast } from "../ui/toast.js";
import { renderLoader } from "../ui/loader.js";

/** Campos do contato sempre visíveis, mesmo vazios: são os que se preenche. */
const SEMPRE_VISIVEIS = new Set(["email", "phone", "tags", "company", "city"]);

function toField(col) {
  return {
    key: col.key,
    name: col.name,
    type: col.type,
    is_primary: !!col.primary,
    config: col.options ? { options: col.options } : {},
    readOnly: !!col.readOnly,
  };
}

export function createContactPanel(host, { contactId } = {}) {
  let dados = null;
  let erro = null;

  host.classList.add("ws-crm-panel");

  async function load() {
    host.replaceChildren(renderLoader("Carregando os dados do CRM…", { compact: true }));
    try {
      const data = await api.crm.contact(contactId);
      dados = {
        columns: (data.columns || []).map(toField),
        record: data.record,
        oppColumns: (data.opportunityColumns || []).map(toField),
        relations: data.relations || [],
        opportunities: data.opportunities || [],
        pipelines: data.pipelines || [],
      };
      erro = null;
    } catch (err) {
      erro = err;
    }
    render();
  }

  function render() {
    if (erro) {
      host.replaceChildren(aviso(erro.code === "contact_not_found"
        ? "Este contato não existe mais no CRM. O conteúdo da página foi preservado."
        : "Não foi possível carregar os dados do CRM agora. Nada foi alterado.", "is-error"));
      return;
    }
    if (!dados) return;

    const frag = document.createDocumentFragment();
    frag.appendChild(secaoContato());
    if (dados.relations.length) frag.appendChild(secaoVinculos());
    frag.appendChild(secaoOportunidades());
    host.replaceChildren(frag);
  }

  /* ---------------- contato ---------------- */

  function secaoContato() {
    const box = bloco("Dados do contato");

    const lista = document.createElement("div");
    lista.className = "ws-crm-panel__props";

    const padrao = dados.columns.filter((c) => !c.key.startsWith("cf_"));
    const custom = dados.columns.filter((c) => c.key.startsWith("cf_"));

    for (const col of padrao) {
      if (col.is_primary) continue;                      // o nome é o título da página
      const valor = dados.record.properties?.[col.key];
      if (isEmptyValue(valor) && !SEMPRE_VISIVEIS.has(col.key)) continue;
      lista.appendChild(linha(col, dados.record, "contacts"));
    }
    // Custom field vazio fica de fora: esta conta tem 115 deles, e a
    // lista completa enterraria o que importa.
    for (const col of custom) {
      if (isEmptyValue(dados.record.properties?.[col.key])) continue;
      lista.appendChild(linha(col, dados.record, "contacts"));
    }

    box.appendChild(lista);
    return box;
  }

  /* ---------------- vínculos ---------------- */

  /**
   * Família e associações.
   *
   * O vínculo é simétrico no banco, então esta seção aparece nas DUAS
   * fichas — marcar "João é filho de Maria" faz a ficha de Maria mostrar
   * João como filho, sem ninguém precisar repetir o gesto do outro lado.
   */
  function secaoVinculos() {
    const box = bloco(`Família e associações (${dados.relations.length})`);
    const lista = document.createElement("div");
    lista.className = "ws-links";

    for (const grupo of groupRelations(dados.relations)) {
      for (const item of grupo.itens) {
        const linha = document.createElement("div");
        linha.className = "ws-links__row";

        const face = renderAvatar({ title: item.title }, { size: 30 });

        const texto = document.createElement("div");
        texto.className = "ws-links__text";
        const nome = document.createElement("span");
        nome.className = "ws-links__name";
        nome.textContent = item.title;
        const papel = document.createElement("span");
        papel.className = "ws-links__role";
        papel.textContent = grupo.nome;
        texto.append(nome, papel);

        const abrir = document.createElement("button");
        abrir.type = "button";
        abrir.className = "ws-btn ws-btn--ghost ws-links__open";
        abrir.textContent = "Abrir pasta";
        abrir.disabled = !item.existe;
        abrir.title = item.existe ? `Abrir a pasta de ${item.title}` : "Contato removido do CRM";
        abrir.addEventListener("click", () => abrirFicha(item.contactId, abrir));

        const soltar = document.createElement("button");
        soltar.type = "button";
        soltar.className = "ws-links__remove";
        soltar.textContent = "×";
        soltar.title = "Desfazer o vínculo";
        soltar.setAttribute("aria-label", `Desfazer o vínculo com ${item.title}`);
        soltar.addEventListener("click", () => desfazer(item));

        linha.append(face, texto, abrir, soltar);
        lista.appendChild(linha);
      }
    }

    box.appendChild(lista);
    return box;
  }

  async function abrirFicha(idContato, botao) {
    botao.disabled = true;
    try {
      const { page } = await api.crm.openDossier(idContato);
      host.dispatchEvent(new CustomEvent("workspace:navigate", {
        bubbles: true, detail: { pageId: page.id },
      }));
    } catch {
      toast("Não foi possível abrir a pasta desse contato.", { tone: "danger" });
      botao.disabled = false;
    }
  }

  async function desfazer(item) {
    // Some dos DOIS lados: um vínculo pela metade não é um vínculo.
    const anterior = dados.relations;
    dados.relations = anterior.filter((r) => r.contactId !== item.contactId);
    render();
    try {
      await api.crm.unlink(contactId, item.contactId);
      toast("Vínculo desfeito.", { tone: "success" });
    } catch {
      dados.relations = anterior;
      render();
      toast("Não foi possível desfazer o vínculo.", { tone: "danger" });
    }
  }

  /* ---------------- oportunidades ---------------- */

  function secaoOportunidades() {
    const box = bloco(`Oportunidades (${dados.opportunities.length})`);
    if (!dados.opportunities.length) {
      box.appendChild(aviso("Nenhuma oportunidade neste contato."));
      return box;
    }

    const colEstagio = dados.oppColumns.find((c) => c.key === "stage");

    for (const opp of dados.opportunities) {
      const card = document.createElement("div");
      card.className = "ws-crm-panel__opp";
      // O card veste a cor do estágio: dá para varrer a lista e ver onde
      // cada oportunidade está sem ler estágio por estágio.
      card.dataset.color = optionColor(colEstagio, opp.properties?.stage);

      const titulo = document.createElement("h4");
      titulo.className = "ws-crm-panel__opp-title";
      titulo.textContent = opp.title;
      card.appendChild(titulo);

      const props = document.createElement("div");
      props.className = "ws-crm-panel__props";
      for (const chave of ["stage", "status", "value", "assigned"]) {
        const col = dados.oppColumns.find((c) => c.key === chave);
        if (col) props.appendChild(linha(col, opp, "opportunities"));
      }
      card.appendChild(props);
      box.appendChild(card);
    }
    return box;
  }

  /* ---------------- linha editável ---------------- */

  function linha(col, record, kind) {
    const row = document.createElement("div");
    row.className = "ws-crm-panel__prop";

    const rotulo = document.createElement("span");
    rotulo.className = "ws-crm-panel__key";
    rotulo.textContent = col.name;

    const valor = document.createElement("div");
    valor.className = "ws-crm-panel__value";
    valor.appendChild(renderCellValue(col, record));

    if (isWritable(kind, col) && record.externalId) {
      valor.classList.add("is-editable");
      valor.setAttribute("role", "button");
      valor.tabIndex = 0;
      valor.title = `Alterar ${col.name.toLowerCase()}`;

      const editar = () => {
        if (isMoveField(kind, col.key)) {
          openStageMenu(valor, record, dados.pipelines, (pipelineId, stageId) =>
            commitMove({ record, pipelines: dados.pipelines, pipelineId, stageId, repaint: render }));
          return;
        }
        editCell(valor, col, record, {
          commit: (value) => commitField({ kind, record, field: col, value, repaint: render }),
          done: () => { if (valor.isConnected) render(); },
        });
      };
      valor.addEventListener("click", (e) => {
        if (e.target !== valor && e.target.closest("input, a")) return;
        editar();
      });
      valor.addEventListener("keydown", (e) => {
        if (e.target !== valor) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editar(); }
      });
    }

    row.append(rotulo, valor);
    return row;
  }

  /* ---------------- utilitários ---------------- */

  function bloco(titulo) {
    const box = document.createElement("section");
    box.className = "ws-crm-panel__section";
    const h = document.createElement("h3");
    h.className = "ws-crm-panel__title";
    h.textContent = titulo;
    box.appendChild(h);
    return box;
  }

  function aviso(texto, cls) {
    const p = document.createElement("p");
    p.className = `ws-crm-panel__note${cls ? ` ${cls}` : ""}`;
    p.textContent = texto;
    return p;
  }

  load();
  return { reload: load };
}
