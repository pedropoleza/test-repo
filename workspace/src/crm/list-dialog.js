/**
 * Diálogo "Nova lista": escolher pipeline e estágio vira uma aba salva.
 *
 * É o caminho para "quero ver todo mundo que está em Prospects / Primeira
 * Reunião" sem refazer o filtro toda vez. A lista guarda a pergunta; o
 * CRM responde a cada abertura.
 *
 * O nome é sugerido a partir da escolha e continua editável: quem quer
 * "Renovações de setembro" não deveria ter que apagar "2- Policies ·
 * September" antes de escrever.
 */
import { openModal, openMenu } from "../ui/menu.js";
import { renderIconGrid } from "../ui/icon-grid.js";

/** Resolve com { name, icon, filters } ou null se cancelado. */
export function openListDialog({ pipelines = [] } = {}) {
  let pipeline = null;
  let stage = null;
  let icon = "📋";
  let nomeTocado = false;

  return openModal({
    title: "Nova lista",
    width: 480,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      if (!pipelines.length) {
        const aviso = document.createElement("p");
        aviso.className = "ws-muted";
        aviso.textContent = "Não foi possível carregar as pipelines da conta. "
          + "Abra Oportunidades uma vez e tente de novo.";
        stack.appendChild(aviso);
      }

      /* ---- ícone + nome ---- */
      const row = document.createElement("div");
      row.className = "ws-section-dialog__row";

      const iconBtn = document.createElement("button");
      iconBtn.type = "button";
      iconBtn.className = "ws-section-dialog__icon";
      iconBtn.setAttribute("aria-label", "Ícone da lista");
      iconBtn.textContent = icon;

      // Grade aberta, e não um menu de oito: escolher ícone é olhar, não
      // navegar por lista.
      const grade = renderIconGrid({
        getValue: () => icon,
        onPick: (e) => { icon = e; iconBtn.textContent = icon; },
      });
      iconBtn.addEventListener("click", () => {
        grade.el.hidden = !grade.el.hidden;
      });

      const name = document.createElement("input");
      name.className = "ws-input";
      name.placeholder = "Nome da lista";
      name.setAttribute("aria-label", "Nome da lista");
      name.maxLength = 120;
      name.addEventListener("input", () => {
        nomeTocado = true;
        name.classList.remove("is-invalid");
      });
      row.append(iconBtn, name);
      stack.append(row, grade.el);

      /* ---- pipeline ---- */
      const btnPipeline = escolha("Pipeline", "Escolher pipeline…");
      const btnStage = escolha("Estágio", "Todos os estágios");
      btnStage.button.disabled = true;

      btnPipeline.button.addEventListener("click", () => {
        openMenu({
          anchor: btnPipeline.button,
          width: 320,
          items: pipelines.map((p) => ({
            id: p.id,
            label: p.name,
            hint: `${(p.stages || []).length} estágios`,
            icon: p.id === pipeline?.id ? "✓" : " ",
          })),
          onSelect: (id) => {
            pipeline = pipelines.find((p) => p.id === id) || null;
            stage = null;                       // trocar de pipeline invalida o estágio
            btnPipeline.setValue(pipeline?.name || "");
            btnStage.setValue("");
            btnStage.button.disabled = !pipeline;
            sugerirNome();
          },
        });
      });

      btnStage.button.addEventListener("click", () => {
        if (!pipeline) return;
        openMenu({
          anchor: btnStage.button,
          width: 320,
          items: [
            { id: "__all__", label: "Todos os estágios", icon: stage ? " " : "✓" },
            { separator: true },
            ...(pipeline.stages || []).map((st) => ({
              id: st.id,
              label: st.name,
              icon: st.id === stage?.id ? "✓" : " ",
            })),
          ],
          onSelect: (id) => {
            stage = id === "__all__"
              ? null
              : (pipeline.stages || []).find((st) => st.id === id) || null;
            btnStage.setValue(stage?.name || "");
            sugerirNome();
          },
        });
      });

      stack.append(btnPipeline.wrap, btnStage.wrap);

      const hint = document.createElement("p");
      hint.className = "ws-muted";
      hint.textContent = "A lista mostra quem está lá agora: ela consulta o CRM a cada "
        + "abertura, em vez de guardar uma cópia.";
      stack.appendChild(hint);

      /* ---- rodapé ---- */
      const footer = document.createElement("div");
      footer.className = "ws-modal__footer";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ws-btn ws-btn--ghost";
      cancel.textContent = "Cancelar";
      cancel.addEventListener("click", () => close(null));

      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "ws-btn ws-btn--primary";
      submit.textContent = "Criar lista";
      submit.addEventListener("click", () => {
        if (!pipeline) { btnPipeline.button.classList.add("is-invalid"); return; }
        const valor = name.value.trim();
        if (!valor) { name.focus(); name.classList.add("is-invalid"); return; }
        close({
          name: valor,
          icon,
          kind: "opportunities",
          filters: {
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            ...(stage ? { stageId: stage.id, stageName: stage.name } : {}),
          },
        });
      });

      footer.append(cancel, submit);
      stack.appendChild(footer);
      body.appendChild(stack);
      requestAnimationFrame(() => btnPipeline.button.focus());

      function sugerirNome() {
        if (nomeTocado) return;                 // não sobrescreve o que a pessoa digitou
        if (!pipeline) { name.value = ""; return; }
        name.value = stage ? `${pipeline.name} · ${stage.name}` : pipeline.name;
        name.classList.remove("is-invalid");
      }
    },
  });
}

function escolha(rotulo, vazio) {
  const wrap = document.createElement("label");
  wrap.className = "ws-field";

  const span = document.createElement("span");
  span.className = "ws-field__label";
  span.textContent = rotulo;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ws-select";

  const valor = document.createElement("span");
  valor.className = "ws-select__value is-empty";
  valor.textContent = vazio;

  const caret = document.createElement("span");
  caret.className = "ws-select__caret";
  caret.textContent = "▾";
  caret.setAttribute("aria-hidden", "true");

  button.append(valor, caret);
  wrap.append(span, button);

  return {
    wrap,
    button,
    setValue(texto) {
      valor.textContent = texto || vazio;
      valor.classList.toggle("is-empty", !texto);
      button.classList.remove("is-invalid");
    },
  };
}
