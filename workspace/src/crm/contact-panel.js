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
import { subscribe } from "../store.js";
import { toast } from "../ui/toast.js";
import { renderPhotoControl, patchDaFoto, fotoDa } from "./photo.js";
import { renderCellValue, editCell } from "../database/cells.js";
import { isEmptyValue, optionColor } from "../shared/fields.js";
import { isWritable, isMoveField, openStageMenu, commitField, commitMove } from "./editing.js";

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

export function createContactPanel(host, {
  contactId, pageId = null, onPatchPage = null, getPage = () => null,
} = {}) {
  let dados = null;
  let erro = null;

  host.classList.add("ws-crm-panel");

  async function load() {
    host.replaceChildren(aviso("Carregando dados do CRM…"));
    try {
      const data = await api.crm.contact(contactId);
      dados = {
        columns: (data.columns || []).map(toField),
        record: data.record,
        oppColumns: (data.opportunityColumns || []).map(toField),
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
    frag.appendChild(secaoOportunidades());
    frag.appendChild(secaoLevar());
    host.replaceChildren(frag);
  }

  /* ---------------- contato ---------------- */

  function secaoContato() {
    const box = bloco("Dados do contato");

    const topo = document.createElement("div");
    topo.className = "ws-crm-panel__identity";
    topo.append(avatar(), identidade());
    box.appendChild(topo);

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

  /* ---------------- levar a ficha ---------------- */

  /**
   * QR e download do PDF.
   *
   * Um QR carrega texto, não arquivo — um PDF não cabe nele e nenhum
   * leitor de celular renderiza PDF de bytes crus. O que o código carrega
   * é um endereço que RESPONDE o PDF como anexo: ler baixa o arquivo, sem
   * passar pelo app nem pedir login.
   *
   * O botão ao lado é o mesmo PDF para quem está no computador e não vai
   * apontar a câmera para a própria tela.
   */
  function secaoLevar() {
    const box = bloco("Levar a ficha");

    if (!pageId) {
      box.appendChild(aviso("Abra a ficha para gerar o QR code."));
      return box;
    }

    const linha = document.createElement("div");
    linha.className = "ws-share";

    const quadro = document.createElement("div");
    quadro.className = "ws-share__qr";
    quadro.appendChild(aviso("Gerando o QR…"));

    const lado = document.createElement("div");
    lado.className = "ws-share__side";

    const explica = document.createElement("p");
    explica.className = "ws-share__hint";
    explica.textContent = "Aponte a câmera para baixar o PDF desta ficha, "
      + "com os dados e as oportunidades preenchidos. Não precisa de login.";

    const baixar = document.createElement("a");
    baixar.className = "ws-btn ws-btn--primary ws-share__download";
    baixar.textContent = "Baixar PDF";
    baixar.rel = "noopener";
    // Desabilitado até o endereço chegar: um href vazio baixaria a
    // própria página.
    baixar.setAttribute("aria-disabled", "true");

    const aviso_ = document.createElement("p");
    aviso_.className = "ws-share__warn";
    aviso_.textContent = "Quem tiver este código vê os dados deste contato.";

    lado.append(explica, baixar, aviso_);
    linha.append(quadro, lado);
    box.appendChild(linha);

    api.dossier.share(pageId).then(({ qr, url }) => {
      if (!quadro.isConnected) return;
      // O botão usa o MESMO endereço do QR. Um link com a chave da sessão
      // na query só funcionaria para quem já está logado do mesmo jeito, e
      // seria um segundo caminho para manter em sincronia com o primeiro.
      baixar.href = url;
      baixar.removeAttribute("aria-disabled");
      const svg = new DOMParser().parseFromString(qr, "image/svg+xml").documentElement;
      // parseFromString devolve um <parsererror> em vez de lançar quando
      // o SVG vem quebrado; sem esta checagem ele entraria na página.
      if (svg.nodeName.toLowerCase() !== "svg") {
        quadro.replaceChildren(aviso("Não foi possível gerar o QR code.", "is-error"));
        return;
      }
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "QR code para baixar o PDF desta ficha");
      quadro.replaceChildren(svg);
    }).catch(() => {
      if (quadro.isConnected) {
        quadro.replaceChildren(aviso("Não foi possível gerar o QR code.", "is-error"));
      }
    });

    return box;
  }

  /* ---------------- foto ---------------- */

  function avatar() {
    const page = getPage?.();
    if (!pageId || !onPatchPage) return renderPhotoControl(page, { size: 72 });
    return renderPhotoControl(page, { size: 72, onPick: gravarFoto });
  }

  function identidade() {
    const box = document.createElement("div");
    box.className = "ws-crm-panel__identity-text";

    const nome = document.createElement("h4");
    nome.className = "ws-crm-panel__name";
    nome.textContent = dados.record.title;

    const sub = document.createElement("p");
    sub.className = "ws-crm-panel__sub";
    const p = dados.record.properties || {};
    sub.textContent = [p.email, p.phone].filter(Boolean).join(" · ")
      || "Sem e-mail ou telefone cadastrado";

    box.append(nome, sub);
    return box;
  }

  /** `url` null = remover. undefined seria um bug de quem chama. */
  function gravarFoto(url) {
    if (url === undefined) {
      toast("Não foi possível obter o endereço da imagem.", { tone: "danger" });
      return;
    }
    onPatchPage(patchDaFoto(url));
    // Repinta com o que acabou de ser gravado: getPage() só reflete a
    // mudança depois que o app atualiza o estado, e o painel repinta
    // antes disso.
    const page = getPage?.();
    if (page) Object.assign(page, patchDaFoto(url));
    fotoPintada = url || null;
    render();
    toast(url ? "Foto atualizada." : "Foto removida.", { tone: "success" });
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

  /*
   * A foto pode ser trocada pela capa, fora deste painel. Sem observar a
   * página, o avatar daqui só acompanharia quando a troca partisse dele —
   * duas imagens da mesma pessoa na mesma tela, discordando.
   *
   * A inscrição se cancela sozinha quando o painel sai do DOM: não há
   * gancho de desmontagem, e o editor troca esses nós a cada repintura.
   */
  let fotoPintada = fotoDa(getPage?.());
  const parar = subscribe(() => {
    if (!host.isConnected) { parar(); return; }
    const agora = fotoDa(getPage?.());
    if (agora === fotoPintada) return;
    fotoPintada = agora;
    if (dados) render();
  });

  load();
  return { reload: load };
}
