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
import { openMenu } from "../ui/menu.js";
import { openPrompt } from "../ui/prompt.js";
import { toast } from "../ui/toast.js";
import { uploadFile, MAX_UPLOAD_BYTES } from "../cover.js";
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

  /* ---------------- foto ---------------- */

  /**
   * A foto do contato é o ÍCONE da página, não um campo à parte.
   *
   * Guardar em outro lugar daria duas imagens para a mesma pessoa e a
   * obrigação de mantê-las em sincronia. Como ícone, ela já aparece
   * redonda na navegação e sobre a capa — que é onde a pessoa espera ver
   * o rosto — sem nenhum código de exibição novo.
   */
  function avatar() {
    const page = getPage?.();
    const foto = page?.icon_type === "url" ? page.icon_value : null;

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `ws-avatar${foto ? " has-photo" : ""}`;
    botao.title = foto ? "Trocar a foto" : "Adicionar uma foto";
    botao.setAttribute("aria-label", botao.title);

    if (foto) {
      const img = document.createElement("img");
      img.src = foto;
      img.alt = "";
      img.loading = "lazy";
      botao.appendChild(img);
    } else {
      const iniciais = document.createElement("span");
      iniciais.className = "ws-avatar__initials";
      iniciais.textContent = iniciaisDe(dados.record.title);
      botao.appendChild(iniciais);
    }

    const marca = document.createElement("span");
    marca.className = "ws-avatar__edit";
    marca.textContent = foto ? "✎" : "＋";
    marca.setAttribute("aria-hidden", "true");
    botao.appendChild(marca);

    if (!pageId || !onPatchPage) {
      // Painel aberto fora de uma página (não deve acontecer hoje): sem
      // onde gravar, a foto vira só exibição em vez de um botão morto.
      botao.disabled = true;
      botao.title = "";
      return botao;
    }

    botao.addEventListener("click", () => {
      openMenu({
        anchor: botao,
        width: 240,
        items: [
          { id: "upload", label: "Enviar uma foto", icon: "🖼" },
          { id: "url", label: "Usar um endereço de imagem", icon: "🔗" },
          ...(foto ? [{ id: "remove", label: "Remover a foto", icon: "×", danger: true }] : []),
        ],
        onSelect: (id) => {
          if (id === "remove") return gravarFoto(null);
          if (id === "url") return pedirUrl();
          return escolherArquivo();
        },
      });
    });
    return botao;
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

  function escolherArquivo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast(`A imagem passa de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
              { tone: "warn" });
        return;
      }
      try {
        const { url } = await uploadFile(file);
        gravarFoto(url);
      } catch {
        toast("Não foi possível enviar a foto.", { tone: "danger" });
      }
    });
    input.click();
  }

  async function pedirUrl() {
    const url = await openPrompt({
      title: "Foto do contato",
      label: "Endereço da imagem",
      placeholder: "https://…",
      confirmLabel: "Usar esta imagem",
      validate: (texto) => (/^https?:\/\//i.test(texto)
        ? null
        : "O endereço precisa começar com http:// ou https://"),
    });
    if (url) gravarFoto(url);
  }

  function gravarFoto(url) {
    onPatchPage({ icon_type: url ? "url" : null, icon_value: url });
    // Repinta com o que acabou de ser gravado: getPage() só reflete a
    // mudança depois que o app atualiza o estado, e o painel repinta
    // antes disso.
    const page = getPage?.();
    if (page) { page.icon_type = url ? "url" : null; page.icon_value = url; }
    render();
    toast(url ? "Foto atualizada." : "Foto removida.", { tone: "success" });
  }

  function iniciaisDe(nome) {
    const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    const primeira = partes[0][0] || "";
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
    return (primeira + ultima).toUpperCase();
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
