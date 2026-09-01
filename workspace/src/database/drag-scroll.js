/**
 * Arrastar a tabela para o lado com o mouse.
 *
 * A barra de rolagem horizontal fica no rodapé da área e, numa tabela
 * alta, some da tela — para ver o "Responsável" era preciso rolar a
 * página até o fim, achar a barra e voltar. Trackpad resolve com dois
 * dedos; mouse comum, não.
 *
 * Aqui a própria tabela vira a alça: segurar e arrastar a move na
 * horizontal, como um mapa.
 *
 * O que NÃO pode acontecer:
 * - roubar o clique de uma célula (editar, abrir a pasta) — só vira
 *   arrasto depois de alguns pixels;
 * - atrapalhar quem seleciona texto ou redimensiona coluna;
 * - competir com o trackpad, que continua funcionando como sempre.
 */

/** Distância a partir da qual o gesto é arrasto, e não clique. */
const LIMIAR = 5;

export function attachDragScroll(scroller) {
  attachBarraDeRolagem(scroller);

  let arrastando = false;
  let virouArrasto = false;
  let xInicial = 0;
  let scrollInicial = 0;
  let pointerId = null;

  scroller.addEventListener("pointerdown", (event) => {
    // Só botão principal do mouse. Toque e caneta já arrastam sozinhos, e
    // interceptá-los quebraria a rolagem nativa do celular.
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    // Alças e controles têm o gesto deles: a alça de coluna redimensiona,
    // input e link têm o próprio clique.
    if (event.target.closest(".ws-db__resize, input, textarea, select, a, .ws-menu")) return;

    arrastando = true;
    virouArrasto = false;
    xInicial = event.clientX;
    scrollInicial = scroller.scrollLeft;
    pointerId = event.pointerId;
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!arrastando || event.pointerId !== pointerId) return;
    const delta = event.clientX - xInicial;

    if (!virouArrasto) {
      if (Math.abs(delta) < LIMIAR) return;
      virouArrasto = true;
      scroller.classList.add("is-dragging");
      // Captura só agora: antes disso o gesto ainda pode virar clique, e
      // capturar cedo faria a célula não receber o próprio clique.
      scroller.setPointerCapture(pointerId);
    }

    event.preventDefault();                       // não seleciona texto ao arrastar
    scroller.scrollLeft = scrollInicial - delta;
  });

  const soltar = (event) => {
    if (!arrastando || (event && event.pointerId !== pointerId)) return;
    if (virouArrasto) {
      // O clique que fecha o gesto não pode chegar à célula: soltar em
      // cima de um nome abriria a pasta depois de arrastar.
      scroller.addEventListener("click", engolir, { capture: true, once: true });
      if (scroller.hasPointerCapture?.(pointerId)) scroller.releasePointerCapture(pointerId);
    }
    arrastando = false;
    virouArrasto = false;
    pointerId = null;
    scroller.classList.remove("is-dragging");
  };

  const engolir = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };

  scroller.addEventListener("pointerup", soltar);
  scroller.addEventListener("pointercancel", soltar);
  // Soltar fora da tabela também encerra: sem isto o arrasto continuava
  // colado ao cursor depois de sair da área.
  scroller.addEventListener("pointerleave", (event) => {
    if (!virouArrasto) soltar(event);
  });

  return scroller;
}

/**
 * Barra de rolagem própria, colada no rodapé da área visível.
 *
 * A barra nativa fica no fim do conteúdo: numa tabela de 300 linhas ela
 * está a três telas de distância, e para ver uma coluna distante era
 * preciso rolar a página inteira, arrastar, e voltar. Esta acompanha a
 * viewport e só aparece quando há o que rolar.
 *
 * A nativa continua existindo (trackpad, teclado, leitor de tela); esta
 * é um controle a mais, não um substituto — reimplementar rolagem por
 * conta própria custaria a acessibilidade que a nativa já dá.
 */
function attachBarraDeRolagem(scroller) {
  const trilho = document.createElement("div");
  trilho.className = "ws-db__railbar";
  trilho.hidden = true;

  const polegar = document.createElement("div");
  trilho.appendChild(polegar);
  polegar.className = "ws-db__railbar-thumb";
  polegar.setAttribute("role", "scrollbar");
  polegar.setAttribute("aria-orientation", "horizontal");
  polegar.setAttribute("aria-label", "Rolar a tabela na horizontal");
  polegar.tabIndex = 0;

  /*
   * O scroller ainda não tem pai quando isto roda: quem chama monta a
   * grade inteira e só depois a coloca na página. Esperar o quadro
   * seguinte é o que garante o insertBefore — sem isso a barra
   * simplesmente não existia, e sem erro nenhum para denunciar.
   */
  const inserir = () => {
    if (trilho.isConnected) return;
    if (!scroller.parentElement) { requestAnimationFrame(inserir); return; }
    scroller.parentElement.insertBefore(trilho, scroller.nextSibling);
    pintar();
  };
  requestAnimationFrame(inserir);

  const MIN = 44;   // um polegar menor que isto não dá para pegar

  function pintar() {
    const excedente = scroller.scrollWidth - scroller.clientWidth;
    if (excedente <= 1) { trilho.hidden = true; return; }
    trilho.hidden = false;

    const proporcao = scroller.clientWidth / scroller.scrollWidth;
    const larguraTrilho = trilho.clientWidth || scroller.clientWidth;
    const largura = Math.max(MIN, Math.round(larguraTrilho * proporcao));
    const avanco = excedente ? scroller.scrollLeft / excedente : 0;

    polegar.style.width = `${largura}px`;
    polegar.style.transform = `translateX(${Math.round(avanco * (larguraTrilho - largura))}px)`;
    polegar.setAttribute("aria-valuenow", String(Math.round(avanco * 100)));
  }

  scroller.addEventListener("scroll", pintar, { passive: true });
  // A largura muda com a janela e ao redimensionar coluna; sem observar,
  // a barra ficava com o tamanho da primeira pintura.
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(pintar);
    ro.observe(scroller);
  }
  requestAnimationFrame(pintar);

  /* ---- arrastar o polegar ---- */

  let arrastando = false;
  let xInicial = 0;
  let scrollInicial = 0;

  polegar.addEventListener("pointerdown", (event) => {
    arrastando = true;
    xInicial = event.clientX;
    scrollInicial = scroller.scrollLeft;
    polegar.setPointerCapture(event.pointerId);
    trilho.classList.add("is-dragging");
    event.preventDefault();
  });

  polegar.addEventListener("pointermove", (event) => {
    if (!arrastando) return;
    const larguraTrilho = trilho.clientWidth || 1;
    const excedente = scroller.scrollWidth - scroller.clientWidth;
    const curso = larguraTrilho - polegar.offsetWidth || 1;
    // Regra de três entre o curso do polegar e o do conteúdo: sem ela o
    // polegar andava mais devagar que o dedo em tabelas largas.
    scroller.scrollLeft = scrollInicial + ((event.clientX - xInicial) / curso) * excedente;
  });

  const soltar = (event) => {
    if (!arrastando) return;
    arrastando = false;
    trilho.classList.remove("is-dragging");
    if (polegar.hasPointerCapture?.(event.pointerId)) polegar.releasePointerCapture(event.pointerId);
  };
  polegar.addEventListener("pointerup", soltar);
  polegar.addEventListener("pointercancel", soltar);

  /* ---- clicar no trilho salta para o ponto ---- */

  trilho.addEventListener("pointerdown", (event) => {
    if (event.target === polegar) return;
    const caixa = trilho.getBoundingClientRect();
    const alvo = (event.clientX - caixa.left - polegar.offsetWidth / 2)
      / ((caixa.width - polegar.offsetWidth) || 1);
    scroller.scrollLeft = Math.min(1, Math.max(0, alvo))
      * (scroller.scrollWidth - scroller.clientWidth);
  });

  polegar.addEventListener("keydown", (event) => {
    const passo = scroller.clientWidth * 0.8;
    if (event.key === "ArrowRight") scroller.scrollLeft += passo;
    else if (event.key === "ArrowLeft") scroller.scrollLeft -= passo;
    else if (event.key === "Home") scroller.scrollLeft = 0;
    else if (event.key === "End") scroller.scrollLeft = scroller.scrollWidth;
    else return;
    event.preventDefault();
  });
}
