/**
 * "Novo funil": o diálogo que cria um funil inteiro.
 *
 * Duas perguntas e pronto — como se chama e quais são as etapas. Tudo o
 * mais (ficha, quadro, tabela, agrupamento) o engine monta, porque são
 * decisões que a pessoa não tem motivo para tomar na primeira tela.
 *
 * O campo de etapas aceita o funil COLADO: de uma mensagem, de um
 * documento, com numeração ou setas. É de onde um funil realmente vem.
 */
import { api } from "../api.js";
import { openModal } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { lerEtapas, ETAPAS_SUGERIDAS } from "../shared/funil.js";

export function abrirNovoFunil({ onCriado } = {}) {
  return openModal({
    title: "Novo funil",
    width: 520,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const explica = document.createElement("p");
      explica.className = "ws-muted";
      explica.textContent = "Um funil é um quadro de colunas: cada coluna é uma etapa e "
        + "cada card é um lead. A ficha já vem com telefone, e-mail, origem e notas — "
        + "e você acrescenta o que faltar depois.";
      stack.appendChild(explica);

      const campoNome = document.createElement("label");
      campoNome.className = "ws-field";
      const rotuloNome = document.createElement("span");
      rotuloNome.className = "ws-field__label";
      rotuloNome.textContent = "Nome do funil";
      const nome = document.createElement("input");
      nome.className = "ws-input";
      nome.placeholder = "Ex.: CRM → SDR [seguros]";
      nome.maxLength = 200;
      campoNome.append(rotuloNome, nome);
      stack.appendChild(campoNome);

      const campoEtapas = document.createElement("label");
      campoEtapas.className = "ws-field";
      const rotuloEtapas = document.createElement("span");
      rotuloEtapas.className = "ws-field__label";
      rotuloEtapas.textContent = "Etapas, uma por linha";
      const etapas = document.createElement("textarea");
      etapas.className = "ws-input ws-funil__etapas";
      etapas.rows = 7;
      etapas.placeholder = ETAPAS_SUGERIDAS.join("\n");
      campoEtapas.append(rotuloEtapas, etapas);
      stack.appendChild(campoEtapas);

      // A prévia é o que evita a surpresa: ela vê as colunas que vai
      // ter ANTES de criar, inclusive quando colou com setas e número.
      const previa = document.createElement("div");
      previa.className = "ws-funil__previa";
      stack.appendChild(previa);

      const desenharPrevia = () => {
        const lista = lerEtapas(etapas.value);
        const usadas = lista.length ? lista : ETAPAS_SUGERIDAS;
        previa.replaceChildren();
        const legenda = document.createElement("p");
        legenda.className = "ws-muted ws-funil__legenda";
        legenda.textContent = lista.length
          ? `${usadas.length} coluna${usadas.length === 1 ? "" : "s"}:`
          : "Sem etapas escritas, o funil nasce assim:";
        previa.appendChild(legenda);
        const fila = document.createElement("div");
        fila.className = "ws-funil__colunas";
        for (const etapa of usadas) {
          const chip = document.createElement("span");
          chip.className = "ws-chip";
          chip.textContent = etapa;
          fila.appendChild(chip);
        }
        previa.appendChild(fila);
      };
      desenharPrevia();
      etapas.addEventListener("input", desenharPrevia);

      const acoes = document.createElement("div");
      acoes.className = "ws-modal__actions";
      const cancelar = document.createElement("button");
      cancelar.type = "button";
      cancelar.className = "ws-btn ws-btn--ghost";
      cancelar.textContent = "Cancelar";
      cancelar.addEventListener("click", () => close(null));

      const criar = document.createElement("button");
      criar.type = "button";
      criar.className = "ws-btn ws-btn--primary";
      criar.textContent = "Criar funil";
      criar.addEventListener("click", async () => {
        criar.disabled = true;
        cancelar.disabled = true;
        criar.textContent = "Criando…";
        try {
          const r = await api.databases.createFunnel({
            nome: nome.value,
            etapas: lerEtapas(etapas.value),
          });
          toast("Funil criado.", { tone: "success" });
          close(r);
          onCriado?.(r);
        } catch {
          criar.disabled = false;
          cancelar.disabled = false;
          criar.textContent = "Criar funil";
          toast("Não foi possível criar o funil.", { tone: "danger" });
        }
      });
      acoes.append(cancelar, criar);
      stack.appendChild(acoes);

      body.appendChild(stack);
      requestAnimationFrame(() => nome.focus());
    },
  });
}
