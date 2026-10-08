/**
 * O quadro desenhado: colunas, cards e o arrasto entre elas.
 *
 * Entra no lugar da grade quando a vista é do tipo Quadro, reusando o
 * cabeçalho, a barra e o carregamento da tabela — é a mesma database,
 * lida de outro jeito.
 *
 * Três coisas que o quadro faz e a tabela não:
 *
 *  - CRIAR COLUNA sem sair da tela. A coluna é uma opção do campo de
 *    seleção; "+ Nova coluna" acrescenta a opção. É o que separa este
 *    quadro do quadro de pipeline do CRM, onde os estágios só o CRM cria.
 *  - ARRASTAR o card de uma coluna para outra, que é como se pensa um
 *    funil. Soltar grava o novo valor do campo.
 *  - ABRIR A FICHA num clique, com todos os campos editáveis.
 */
import { api } from "../api.js";
import { openMenu } from "../ui/menu.js";
import { openPrompt } from "../ui/prompt.js";
import { toast } from "../ui/toast.js";
import { renderCellValue } from "./cells.js";
import { abrirFicha } from "./record-panel.js";
import { attachDragScroll } from "./drag-scroll.js";
import { OPTION_COLORS, isEmptyValue, readValue } from "../shared/fields.js";
import {
  colunasDoQuadro, campoDeColunas, camposPossiveis, camposDoCartao,
  novaColuna, semColuna, colunaAlterada, SEM_COLUNA,
} from "../shared/board-db.js";

/**
 * Devolve o nó do quadro.
 *
 * `onChangeView` grava o agrupamento (qual campo rege as colunas),
 * `reload` recarrega o bundle, `onOpenRecord` abre o registro como
 * página inteira.
 */
export function renderBoardBody({
  bundle, view, databaseId, reload, onChangeView, onOpenRecord,
}) {
  const campo = campoDeColunas(bundle.fields, view?.group_by);
  if (!campo) return semCampo(bundle, databaseId, reload);

  // O card sendo arrastado. Declarado AQUI, antes do `return wrap`: as
  // funções abaixo são declarações e sobem, mas um `let` depois do
  // return nunca sai da zona morta — e cada arrasto estourava
  // "Cannot access 'arrastando' before initialization".
  let arrastando = null;

  const wrap = document.createElement("div");
  wrap.className = "ws-board2__wrap";

  // O campo que rege as colunas fica à vista e é trocável: num quadro, a
  // pergunta "colunas por quê?" é a primeira que se faz.
  const candidatos = camposPossiveis(bundle.fields);
  if (candidatos.length > 1 || view?.group_by !== campo.key) {
    const barra = document.createElement("div");
    barra.className = "ws-board2__por";
    const rotulo = document.createElement("span");
    rotulo.className = "ws-muted";
    rotulo.textContent = "Colunas por";
    const sel = document.createElement("select");
    sel.className = "ws-select ws-select--sm";
    sel.setAttribute("aria-label", "Campo que define as colunas");
    for (const c of candidatos) {
      const opt = document.createElement("option");
      opt.value = c.key; opt.textContent = c.name;
      opt.selected = c.key === campo.key;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChangeView?.({ groupBy: sel.value }));
    barra.append(rotulo, sel);
    wrap.appendChild(barra);
  }

  const board = document.createElement("div");
  board.className = "ws-board2";
  attachDragScroll(board);
  for (const coluna of colunasDoQuadro(bundle.records, campo)) {
    board.appendChild(renderColuna(coluna));
  }
  board.appendChild(renderNovaColuna());
  wrap.appendChild(board);
  return wrap;

  /* ---------------- colunas ---------------- */

  function renderColuna(coluna) {
    const col = document.createElement("section");
    col.className = "ws-board2__col";
    col.dataset.colunaId = coluna.id;

    const head = document.createElement("header");
    head.className = "ws-board2__col-head";

    const chip = document.createElement("span");
    chip.className = "ws-chip ws-board2__col-nome";
    chip.dataset.color = coluna.cor;
    chip.textContent = coluna.nome;

    const conta = document.createElement("span");
    conta.className = "ws-board2__col-conta";
    conta.textContent = coluna.records.length;
    head.append(chip, conta);

    // A coluna "Sem …" não é uma opção: não dá para renomear nem excluir
    // o que não existe no campo.
    if (coluna.opcao) {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "ws-icon-btn ws-board2__col-menu";
      menu.setAttribute("aria-label", `Ações da coluna ${coluna.nome}`);
      menu.textContent = "⋯";
      menu.addEventListener("click", () => abrirMenuDaColuna(menu, coluna));
      head.appendChild(menu);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ws-icon-btn ws-board2__col-add";
    add.setAttribute("aria-label", `Novo card em ${coluna.nome}`);
    add.textContent = "+";
    add.addEventListener("click", () => criarCard(coluna));
    head.appendChild(add);

    col.appendChild(head);

    const pilha = document.createElement("div");
    pilha.className = "ws-board2__cards";
    pilha.dataset.colunaId = coluna.id;
    for (const record of coluna.records) pilha.appendChild(renderCard(record, coluna));
    ligarSoltura(pilha, coluna);
    col.appendChild(pilha);

    const novo = document.createElement("button");
    novo.type = "button";
    novo.className = "ws-board2__novo";
    novo.textContent = "+ Nova ficha";
    novo.addEventListener("click", () => criarCard(coluna));
    col.appendChild(novo);
    return col;
  }

  function abrirMenuDaColuna(anchor, coluna) {
    openMenu({
      anchor,
      width: 220,
      items: [
        { id: "renomear", label: "Renomear coluna", icon: "✎" },
        { id: "cor", label: "Mudar a cor", icon: "◉" },
        { separator: true },
        { id: "excluir", label: "Excluir coluna", icon: "🗑", danger: true },
      ],
      onSelect: async (id) => {
        if (id === "renomear") {
          const nome = await openPrompt({
            title: "Renomear coluna", label: "Nome", value: coluna.nome, confirmLabel: "Salvar",
          });
          if (nome === null) return;
          await gravarOpcoes(colunaAlterada(campo, coluna.id, { name: nome }),
            "Não foi possível renomear a coluna.");
        } else if (id === "cor") {
          openMenu({
            anchor,
            width: 170,
            items: OPTION_COLORS.map((c) => ({
              id: c, label: c, icon: c === coluna.cor ? "✓" : " ",
            })),
            onSelect: (cor) => gravarOpcoes(colunaAlterada(campo, coluna.id, { color: cor }),
              "Não foi possível mudar a cor."),
          });
        } else if (id === "excluir") {
          // Excluir a coluna NÃO exclui os cards: eles viram pendência na
          // coluna "Sem …", visíveis, para serem realocados. Sumir com o
          // lead junto com a etapa seria perder trabalho sem avisar.
          await gravarOpcoes(semColuna(campo, coluna.id),
            "Não foi possível excluir a coluna.");
          if (coluna.records.length) {
            toast(`${coluna.records.length} ficha${coluna.records.length === 1 ? "" : "s"} `
              + `ficaram em "Sem ${campo.name.toLowerCase()}".`, { tone: "info" });
          }
        }
      },
    });
  }

  function renderNovaColuna() {
    const col = document.createElement("div");
    col.className = "ws-board2__col ws-board2__col--nova";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ws-board2__nova-col";
    btn.textContent = "+ Nova coluna";
    btn.addEventListener("click", async () => {
      const nome = await openPrompt({
        title: "Nova coluna", label: `Nome da etapa em "${campo.name}"`,
        placeholder: "Ex.: Aplicação enviada", confirmLabel: "Criar",
      });
      if (nome === null) return;
      const { options } = novaColuna(campo, nome);
      await gravarOpcoes(options, "Não foi possível criar a coluna.");
    });
    col.appendChild(btn);
    return col;
  }

  async function gravarOpcoes(options, erro) {
    try {
      await api.databases.updateField(campo.id, { config: { ...campo.config, options } });
      await reload();
    } catch {
      toast(erro, { tone: "danger" });
    }
  }

  /* ---------------- cards ---------------- */

  function renderCard(record, coluna) {
    const card = document.createElement("article");
    card.className = "ws-board2__card";
    card.dataset.recordId = record.id;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir ficha de ${record.title || "sem nome"}`);

    const titulo = document.createElement("h3");
    titulo.className = "ws-board2__card-titulo";
    titulo.textContent = record.title || "Sem nome";
    card.appendChild(titulo);

    const mostrar = camposDoCartao(bundle.fields, {
      campoDeColuna: campo,
      visiveis: view?.visible_fields || null,
    });
    const preenchidos = mostrar.filter((f) => !isEmptyValue(readValue(f, record)));
    if (preenchidos.length) {
      const lista = document.createElement("dl");
      lista.className = "ws-board2__card-campos";
      for (const field of preenchidos) {
        const dt = document.createElement("dt");
        dt.textContent = field.name;
        const dd = document.createElement("dd");
        dd.appendChild(renderCellValue(field, record));
        lista.append(dt, dd);
      }
      card.appendChild(lista);
    }

    const abrir = () => ficha(record);
    card.addEventListener("click", abrir);
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
    });

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      // Alguns navegadores só iniciam o arrasto com dado no transfer.
      e.dataTransfer.setData("text/plain", record.id);
      arrastando = { record, de: coluna.id };
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      arrastando = null;
      for (const p of board.querySelectorAll(".ws-board2__cards")) p.classList.remove("is-over");
    });
    return card;
  }

  async function ficha(record) {
    const mexeu = await abrirFicha(record, {
      databaseId, fields: bundle.fields, onOpenPage: onOpenRecord,
    });
    if (mexeu) await reload();
  }

  async function criarCard(coluna) {
    // Criar na coluna já nasce com a etapa preenchida — é o gesto
    // inteiro: "entrou um lead nesta etapa".
    const properties = coluna.id === SEM_COLUNA ? {} : { [campo.key]: coluna.id };
    try {
      const { record } = await api.databases.createRecord(databaseId, { title: "", properties });
      await reload();
      // Abre a ficha do novo em vez de deixar um card vazio no quadro:
      // quem acabou de criar quer escrever o nome agora.
      const atual = bundle.records.find((r) => r.id === record.id) || record;
      await ficha(atual);
    } catch {
      toast("Não foi possível criar a ficha.", { tone: "danger" });
    }
  }

  /* ---------------- arrasto ---------------- */

  function ligarSoltura(pilha, coluna) {
    pilha.addEventListener("dragover", (e) => {
      if (!arrastando) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      pilha.classList.add("is-over");
    });
    pilha.addEventListener("dragleave", (e) => {
      if (pilha.contains(e.relatedTarget)) return;
      pilha.classList.remove("is-over");
    });
    pilha.addEventListener("drop", async (e) => {
      e.preventDefault();
      pilha.classList.remove("is-over");
      const mov = arrastando;
      arrastando = null;
      if (!mov || mov.de === coluna.id) return;
      await mover(mov.record, coluna);
    });
  }

  async function mover(record, coluna) {
    const antes = { ...(record.properties || {}) };
    const valor = coluna.id === SEM_COLUNA ? null : coluna.id;
    record.properties = { ...antes, [campo.key]: valor };
    try {
      const { record: salvo } = await api.databases.updateRecord(record.id, {
        properties: { [campo.key]: valor },
      });
      record.properties = salvo.properties;
      await reload();
    } catch {
      record.properties = antes;
      toast("Não foi possível mover a ficha.", { tone: "danger" });
      await reload();
    }
  }
}

/**
 * Quadro sem campo que possa reger colunas. Em vez de desenhar nada,
 * explica e oferece o caminho — criar o campo de seleção é o que falta.
 */
function semCampo(bundle, databaseId, reload) {
  const box = document.createElement("div");
  box.className = "ws-db__error ws-board2__sem-campo";
  const p = document.createElement("p");
  p.textContent = "Um quadro precisa de um campo de seleção para virar colunas "
    + "— as etapas do funil. Esta tabela ainda não tem nenhum.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ws-btn ws-btn--primary ws-btn--sm";
  btn.textContent = "Criar campo de etapas";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await api.databases.createField(databaseId, {
        name: "Etapa",
        type: "select",
        config: {
          options: [
            { id: "novo", name: "Novo", color: "blue" },
            { id: "andamento", name: "Em andamento", color: "orange" },
            { id: "concluido", name: "Concluído", color: "green" },
          ],
        },
      });
      await reload();
    } catch {
      btn.disabled = false;
      toast("Não foi possível criar o campo.", { tone: "danger" });
    }
  });
  box.append(p, btn);
  return box;
}
