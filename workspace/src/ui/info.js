/**
 * Botão de informação (ⓘ) com explicação do módulo.
 *
 * Cada tela ganha um ⓘ ao lado do título; clicando, abre um balão que
 * conta, em detalhe, o que aquele módulo é, de onde vêm os dados e como
 * usar. É o contexto que não cabe no subtítulo de uma linha — e que
 * transforma "mais uma aba" em algo que a pessoa entende sem perguntar.
 *
 * O balão fecha ao clicar fora ou com Escape, e some quando o âncora sai
 * da tela (troca de módulo). Um só aberto por vez.
 */

let abertoAgora = null;

function fecharAtual() {
  if (abertoAgora) { abertoAgora(); abertoAgora = null; }
}

/**
 * Cria o botão ⓘ. `titulo` é o nome do módulo; `paragrafos` é uma lista
 * de textos — cada um vira um parágrafo do balão.
 */
export function criarBotaoInfo({ titulo, paragrafos = [] }) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "ws-info-btn";
  botao.setAttribute("aria-label", `Sobre: ${titulo}`);
  botao.textContent = "ⓘ";

  botao.addEventListener("click", (event) => {
    event.stopPropagation();
    // Segundo clique no mesmo ⓘ fecha, em vez de reabrir.
    if (abertoAgora) { const jaEra = abertoAgora; fecharAtual(); if (jaEra.dono === botao) return; }
    abrir(botao, titulo, paragrafos);
  });
  return botao;
}

function abrir(anchor, titulo, paragrafos) {
  const balao = document.createElement("div");
  balao.className = "ws-info-pop";
  balao.setAttribute("role", "dialog");

  const h = document.createElement("p");
  h.className = "ws-info-pop__title";
  h.textContent = titulo;
  balao.appendChild(h);

  for (const texto of paragrafos) {
    const p = document.createElement("p");
    p.className = "ws-info-pop__text";
    p.textContent = texto;
    balao.appendChild(p);
  }

  document.body.appendChild(balao);
  posicionar(balao, anchor);

  const fechar = () => {
    balao.remove();
    document.removeEventListener("click", onFora, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onMover, true);
    window.removeEventListener("scroll", onMover, true);
  };
  fechar.dono = anchor;

  const onFora = (e) => { if (!balao.contains(e.target) && e.target !== anchor) fecharAtual(); };
  const onKey = (e) => { if (e.key === "Escape") fecharAtual(); };
  const onMover = () => {
    // Âncora fora da tela = módulo trocado: fecha. Senão, reacompanha.
    if (!anchor.isConnected) fecharAtual();
    else posicionar(balao, anchor);
  };
  document.addEventListener("click", onFora, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onMover, true);
  window.addEventListener("scroll", onMover, true);

  abertoAgora = fechar;
}

function posicionar(balao, anchor) {
  const r = anchor.getBoundingClientRect();
  const largura = Math.min(340, window.innerWidth - 24);
  balao.style.width = `${largura}px`;
  // Abaixo do ⓘ, alinhado à esquerda dele, sem vazar pela direita.
  let left = r.left;
  if (left + largura > window.innerWidth - 12) left = window.innerWidth - largura - 12;
  balao.style.left = `${Math.max(12, left)}px`;
  balao.style.top = `${r.bottom + 8}px`;
}
