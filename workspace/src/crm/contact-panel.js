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
import { agruparPorDia } from "../shared/timeline.js";
import { CATEGORIAS, nomeDaCategoria } from "../shared/documents.js";
import { uploadFile, MAX_UPLOAD_BYTES } from "../cover.js";
import { openModal } from "../ui/menu.js";

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
  let linhaAberta = false;

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
        timeline: data.timeline || [],
        documentos: data.documentos || [],
        arquivos: data.arquivos || [],
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
    if (dados.documentos.length || dados.arquivos.length) frag.appendChild(secaoDocumentos());
    if (dados.timeline.length) frag.appendChild(secaoLinhaDoTempo());
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

  /* ---------------- documentos ---------------- */

  /**
   * Gera os acordos da Latino USA preenchidos com os dados deste
   * contato. O documento sai do PDF real dela — o app só estampa os
   * dados; a linguagem jurídica nunca é tocada.
   */
  function secaoDocumentos() {
    const box = bloco("Documentos");

    // 1) Gerar: os acordos preenchidos com os dados do contato.
    if (dados.documentos.length) box.appendChild(blocoGerar());
    // 2) Arquivos: o que já está guardado na ficha, por categoria.
    box.appendChild(blocoArquivos());
    return box;
  }

  function blocoGerar() {
    const wrap = document.createElement("div");
    const rotulo = document.createElement("p");
    rotulo.className = "ws-docs__rotulo";
    rotulo.textContent = "Gerar";
    wrap.appendChild(rotulo);

    const lista = document.createElement("div");
    lista.className = "ws-docs";

    for (const doc of dados.documentos) {
      const linha = document.createElement("div");
      linha.className = "ws-docs__item";

      const nome = document.createElement("span");
      nome.className = "ws-docs__nome";
      nome.textContent = doc.nome;
      linha.appendChild(nome);

      // Idioma só quando o acordo existe em mais de um — é o caso do
      // divórcio (PT/EN/ES); o resto sai direto.
      let idioma = doc.idiomas[0] || "en";
      if (doc.idiomas.length > 1) {
        const sel = document.createElement("select");
        sel.className = "ws-select ws-docs__idioma";
        for (const i of doc.idiomas) {
          const opt = document.createElement("option");
          opt.value = i;
          opt.textContent = { pt: "Português", en: "English", es: "Español" }[i] || i;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { idioma = sel.value; });
        linha.appendChild(sel);
      }

      const gerar = document.createElement("button");
      gerar.type = "button";
      gerar.className = "ws-btn ws-btn--sm ws-docs__gerar";
      gerar.textContent = "Gerar PDF";
      gerar.addEventListener("click", () => baixarDocumento(doc, idioma, gerar));
      linha.appendChild(gerar);

      lista.appendChild(linha);
    }
    wrap.appendChild(lista);
    return wrap;
  }

  /**
   * Os arquivos da ficha, agrupados por categoria. É a resposta à dor
   * dela: em vez de garimpar em quatro computadores, o documento do
   * cliente está aqui, a um clique de reenviar.
   */
  function blocoArquivos() {
    const wrap = document.createElement("div");
    wrap.className = "ws-docs__arquivos";

    const cabecalho = document.createElement("div");
    cabecalho.className = "ws-docs__arq-head";
    const rotulo = document.createElement("p");
    rotulo.className = "ws-docs__rotulo";
    rotulo.textContent = "Arquivos";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "ws-btn ws-btn--sm";
    add.textContent = "+ Adicionar";
    add.addEventListener("click", adicionarArquivo);
    cabecalho.append(rotulo, add);
    wrap.appendChild(cabecalho);

    if (!dados.arquivos.length) {
      const vazio = document.createElement("p");
      vazio.className = "ws-muted ws-docs__vazio";
      vazio.textContent = "Nenhum arquivo ainda. Guarde aqui os documentos do cliente, "
        + "contratos e recibos — todos ficam na ficha.";
      wrap.appendChild(vazio);
      return wrap;
    }

    // Uma gaveta por categoria que tem arquivo, na ordem da taxonomia.
    for (const cat of CATEGORIAS) {
      const doCat = dados.arquivos.filter((a) => a.categoria === cat.id);
      if (!doCat.length) continue;
      const gaveta = document.createElement("div");
      gaveta.className = "ws-docs__gaveta";
      const gh = document.createElement("p");
      gh.className = "ws-docs__gaveta-head";
      gh.textContent = `${cat.icone} ${cat.nome}`;
      gaveta.appendChild(gh);
      for (const arq of doCat) gaveta.appendChild(linhaArquivo(arq));
      wrap.appendChild(gaveta);
    }
    return wrap;
  }

  function linhaArquivo(arq) {
    const linha = document.createElement("div");
    linha.className = "ws-docs__arq";

    const nome = document.createElement("a");
    nome.className = "ws-docs__arq-nome";
    nome.href = arq.url || "#";
    nome.target = "_blank";
    nome.rel = "noopener";
    nome.textContent = arq.nome || "arquivo";
    nome.title = "Abrir / baixar";
    linha.appendChild(nome);

    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "ws-docs__arq-remover";
    remover.textContent = "✕";
    remover.setAttribute("aria-label", `Remover ${arq.nome}`);
    remover.addEventListener("click", () => removerArquivo(arq, remover));
    linha.appendChild(remover);
    return linha;
  }

  /** Fluxo de anexar: escolhe o arquivo, depois a categoria, e envia. */
  function adicionarArquivo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast(`Arquivo grande demais (máximo ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).`,
          { tone: "warn" });
        return;
      }
      const categoria = await escolherCategoria();
      if (!categoria) return;
      try {
        await uploadFile(file, { contactId: dados.record.externalId, category: categoria });
        toast("Documento guardado na ficha.", { tone: "success" });
        await load();
      } catch (err) {
        toast(err?.code === "storage_unavailable"
          ? "O armazenamento não está configurado. Nada foi enviado."
          : "Não foi possível guardar o documento.", { tone: "danger" });
      }
    });
    input.click();
  }

  /** Diálogo nosso para escolher a categoria — nunca um prompt do navegador. */
  function escolherCategoria() {
    return openModal({
      title: "Que tipo de documento?",
      width: 420,
      render: (body, close) => {
        const lista = document.createElement("div");
        lista.className = "ws-docs__cats";
        for (const cat of CATEGORIAS) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "ws-docs__cat";
          b.textContent = `${cat.icone}  ${cat.nome}`;
          b.addEventListener("click", () => close(cat.id));
          lista.appendChild(b);
        }
        body.appendChild(lista);
        lista.firstElementChild?.focus();
      },
    });
  }

  async function removerArquivo(arq, botao) {
    botao.disabled = true;
    try {
      await api.crm.deleteContactDoc(arq.id);
      toast("Documento removido.", { tone: "success" });
      await load();
    } catch {
      toast("Não foi possível remover.", { tone: "danger" });
      botao.disabled = false;
    }
  }

  async function baixarDocumento(doc, idioma, botao) {
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Gerando…";
    try {
      const blob = await api.crm.gerarDocumento(dados.record.externalId, doc.id, idioma);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.nome}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoga depois do clique: revogar antes cancelaria o download.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`${doc.nome} gerado.`, { tone: "success" });
    } catch (err) {
      toast(err?.code === "acordo_sem_preenchimento"
        ? "Este acordo ainda não está pronto para preenchimento."
        : "Não foi possível gerar o documento.", { tone: "danger" });
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  }

  /* ---------------- linha do tempo ---------------- */

  /**
   * O que aconteceu com essa pessoa, em ordem.
   *
   * A resposta estava espalhada por quatro lugares — a data de entrada
   * no contato, o histórico comercial nas oportunidades, o que foi dito
   * nas notas, o que mexemos nas revisões da ficha — e nenhum deles
   * respondia sozinho. Aqui é uma lista só.
   *
   * Fechada por padrão: quem abre a ficha quer os dados primeiro; a
   * história é a segunda pergunta, e aberta ela empurraria as
   * oportunidades para fora da tela.
   */
  function secaoLinhaDoTempo() {
    const box = document.createElement("section");
    box.className = "ws-crm-panel__section";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "ws-crm-panel__title ws-timeline__toggle";
    head.setAttribute("aria-expanded", String(linhaAberta));
    const seta = document.createElement("span");
    seta.className = "ws-timeline__caret";
    seta.textContent = linhaAberta ? "▾" : "▸";
    const rotulo = document.createElement("span");
    rotulo.textContent = `Linha do tempo (${dados.timeline.length})`;
    head.append(seta, rotulo);
    head.addEventListener("click", () => { linhaAberta = !linhaAberta; render(); });
    box.appendChild(head);

    if (!linhaAberta) return box;

    const lista = document.createElement("ol");
    lista.className = "ws-timeline";
    for (const grupo of agruparPorDia(dados.timeline)) {
      const dia = document.createElement("li");
      dia.className = "ws-timeline__day";
      const data = document.createElement("p");
      data.className = "ws-timeline__date";
      data.textContent = formatarDia(grupo.dia);
      dia.appendChild(data);

      for (const ev of grupo.eventos) dia.appendChild(itemDaLinha(ev));
      lista.appendChild(dia);
    }
    box.appendChild(lista);
    return box;
  }

  function itemDaLinha(ev) {
    const item = document.createElement("div");
    item.className = "ws-timeline__item";
    item.dataset.tipo = ev.tipo;

    const ponto = document.createElement("span");
    ponto.className = "ws-timeline__dot";
    ponto.setAttribute("aria-hidden", "true");

    const corpo = document.createElement("div");
    corpo.className = "ws-timeline__body";
    const titulo = document.createElement("p");
    titulo.className = "ws-timeline__what";
    titulo.textContent = ev.titulo;
    corpo.appendChild(titulo);

    if (ev.detalhe) {
      const det = document.createElement("p");
      det.className = "ws-timeline__detail";
      det.textContent = ev.detalhe;
      corpo.appendChild(det);
    }

    const rodape = document.createElement("p");
    rodape.className = "ws-timeline__when";
    rodape.textContent = ev.ator ? `${formatarHora(ev.at)} · ${ev.ator}` : formatarHora(ev.at);
    corpo.appendChild(rodape);

    item.append(ponto, corpo);
    return item;
  }

  /** "1 de setembro de 2026", com "Hoje" e "Ontem" onde ajuda mais. */
  function formatarDia(dia) {
    const d = new Date(`${dia}T12:00:00Z`);
    const hoje = new Date();
    const mesmoDia = (a, b) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    const ontem = new Date(hoje.getTime() - 86400000);
    if (mesmoDia(d, hoje)) return "Hoje";
    if (mesmoDia(d, ontem)) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatarHora(iso) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
