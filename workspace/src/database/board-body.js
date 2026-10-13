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
import { renderCellValue, editCell } from "./cells.js";
import { abrirFicha } from "./record-panel.js";
import { attachDragScroll } from "./drag-scroll.js";
import { OPTION_COLORS, isEmptyValue, readValue, fieldSpec } from "../shared/fields.js";
import {
  colunasDoQuadro, campoDeColunas, camposPossiveis, camposDoCartao,
  novaColuna, semColuna, colunaAlterada, SEM_COLUNA,
  TAMANHOS_DO_CARD, tamanhoDoCard,
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
  const tamanho = tamanhoDoCard(view?.layout);

  const barra = document.createElement("div");
  barra.className = "ws-board2__por";

  const candidatos = camposPossiveis(bundle.fields);
  if (candidatos.length > 1 || view?.group_by !== campo.key) {
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
  }

  // Tamanho do card: o padrão mostra tudo que foi escrito; quem precisa
  // varrer onze colunas aperta para Compacto.
  const rotTam = document.createElement("span");
  rotTam.className = "ws-muted";
  rotTam.textContent = "Card";
  const selTam = document.createElement("select");
  selTam.className = "ws-select ws-select--sm";
  selTam.setAttribute("aria-label", "Tamanho do card");
  for (const t of Object.values(TAMANHOS_DO_CARD)) {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.nome;
    opt.selected = t.id === tamanho.id;
    selTam.appendChild(opt);
  }
  selTam.addEventListener("change", () => onChangeView?.({
    layout: { ...(view?.layout || {}), cardSize: selTam.value },
  }));
  barra.append(rotTam, selTam);
  wrap.appendChild(barra);

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
    if (coluna.descricao) {
      // O nome da etapa cabe na coluna; a definição dela, não. Fica no
      // title — e o cabeçalho ganha um ponto para avisar que há o quê ler.
      chip.title = coluna.descricao;
      chip.classList.add("tem-nota");
    }

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
        { id: "descricao", label: coluna.descricao ? "Editar a definição" : "Definir o que é esta etapa", icon: "ⓘ" },
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
        } else if (id === "descricao") {
          const texto = await openPrompt({
            title: `O que é "${coluna.nome}"`,
            label: "Quando um card entra nesta etapa",
            placeholder: "Ex.: cliente disse “vou pensar” ou precisa falar com o cônjuge.",
            value: coluna.descricao || "",
            confirmLabel: "Salvar",
            allowEmpty: true,
          });
          if (texto === null) return;
          await gravarOpcoes(colunaAlterada(campo, coluna.id, { description: texto }),
            "Não foi possível salvar a definição.");
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

    // Primeiro filtra o que ESTÁ PREENCHIDO, depois corta pelo tamanho:
    // cortar antes gastaria as três linhas do Médio com campos vazios e
    // esconderia justamente o que foi escrito.
    const candidatosCard = camposDoCartao(bundle.fields, {
      campoDeColuna: campo,
      visiveis: view?.visible_fields || null,
    });
    const escritos = candidatosCard.filter((f) => !isEmptyValue(readValue(f, record)));
    const preenchidos = tamanho.max === Infinity
      ? escritos
      : escritos.slice(0, tamanho.max);
    const ocultos = escritos.length - preenchidos.length;
    if (preenchidos.length) {
      const lista = document.createElement("dl");
      lista.className = "ws-board2__card-campos";
      for (const field of preenchidos) {
        const dt = document.createElement("dt");
        dt.textContent = field.name;
        lista.append(dt, valorEditavel(field, record, card));
      }
      card.appendChild(lista);
    }
    if (ocultos > 0) {
      // Não sumir em silêncio: o card diz que há mais, e quantos.
      const mais = document.createElement("p");
      mais.className = "ws-board2__card-mais";
      mais.textContent = `+${ocultos} campo${ocultos === 1 ? "" : "s"}`;
      card.appendChild(mais);
    }

    const abrir = () => ficha(record);
    card.addEventListener("click", (e) => {
      // O valor de um campo é editável no lugar; só o resto do card abre
      // a ficha. Sem esta guarda, corrigir um telefone no card abriria a
      // modal por cima do campo que se acabou de clicar.
      if (e.target.closest(".ws-board2__card-valor")) return;
      abrir();
    });
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

  /**
   * O valor de um campo na frente do card, editável no lugar.
   *
   * Corrigir um telefone não deveria custar abrir a ficha, ler a lista
   * inteira, achar o campo e fechar de novo. Clicar no valor edita; o
   * resto do card continua abrindo a ficha.
   *
   * Duas armadilhas que o card tem e a ficha não:
   *
   *  - o card é `draggable`, e um input dentro de um elemento arrastável
   *    não deixa selecionar texto: arrastar vence o cursor. Por isso o
   *    arrasto é desligado enquanto se edita e religado no fim.
   *  - o clique borbulha até o card, que abre a ficha. Daí o
   *    stopPropagation e a guarda no listener do card.
   */
  function valorEditavel(field, record, card) {
    const dd = document.createElement("dd");
    dd.className = "ws-board2__card-valor";
    const editavel = !fieldSpec(field.type).readOnly;
    if (editavel) {
      dd.tabIndex = 0;
      dd.setAttribute("role", "button");
      dd.setAttribute("aria-label", `Editar ${field.name}`);
    }

    const pintar = () => dd.replaceChildren(renderCellValue(field, record));
    pintar();

    if (!editavel) return dd;

    const editar = () => {
      dd.classList.add("is-editing");
      card.draggable = false;
      editCell(dd, field, record, {
        commit: (valor) => salvarNoCard(record, field, valor, card),
        done: () => {
          dd.classList.remove("is-editing");
          card.draggable = true;
          if (dd.isConnected) pintar();
        },
      });
    };

    // Já no mousedown: o dragstart dispara antes do click, e sem isto o
    // primeiro gesto dentro do campo vira um arrasto do card.
    dd.addEventListener("mousedown", () => { card.draggable = false; });
    dd.addEventListener("click", (e) => { e.stopPropagation(); editar(); });
    dd.addEventListener("keydown", (e) => {
      if (e.target !== dd) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); editar(); }
    });
    return dd;
  }

  /**
   * Grava o campo editado no card.
   *
   * Sem recarregar o quadro: recarregar aqui tiraria o foco do campo
   * seguinte e devolveria a rolagem com um pisca a cada letra corrigida.
   * O card se repinta sozinho — e só ele — quando o valor muda o que
   * cabe na frente (um campo esvaziado sai da lista).
   */
  async function salvarNoCard(record, field, valor, card) {
    const antes = { ...(record.properties || {}) };
    record.properties = { ...antes, [field.key]: valor };
    try {
      const { record: salvo } = await api.databases.updateRecord(record.id, {
        properties: { [field.key]: valor },
      });
      record.properties = salvo.properties;
      record.title = salvo.title;
      // Esvaziar um campo tira a linha do card; só então vale refazer o
      // cartão inteiro, e ainda assim só ele.
      if (isEmptyValue(readValue(field, record)) && card.isConnected) {
        const coluna = { id: card.closest(".ws-board2__cards")?.dataset.colunaId };
        card.replaceWith(renderCard(record, coluna));
      }
    } catch {
      record.properties = antes;
      toast("Não foi possível salvar o campo.", { tone: "danger" });
    }
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
