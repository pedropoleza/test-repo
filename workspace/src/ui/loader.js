/**
 * Carregando: a marca pulsando, com uma linha do que está acontecendo.
 *
 * As barras cinza sozinhas serviam quando a espera era curta. Puxar a
 * carteira do CRM leva de meio a dois segundos, e nesse tempo um bloco
 * cinza não diz se o app está trabalhando ou travado.
 *
 * A mensagem aparece SÓ depois de um instante: numa resposta rápida ela
 * piscaria na tela sem ser lida, o que é pior do que não ter.
 */

const ATRASO_MENSAGEM = 450;

export function renderLoader(mensagem = "Carregando…", { compact = false } = {}) {
  const box = document.createElement("div");
  box.className = `ws-loader${compact ? " ws-loader--compact" : ""}`;
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");

  const marca = document.createElement("img");
  marca.className = "ws-loader__mark";
  marca.src = "./assets/logo.png";
  marca.alt = "";
  marca.width = compact ? 28 : 44;
  marca.height = compact ? 28 : 44;

  const texto = document.createElement("p");
  texto.className = "ws-loader__text";
  texto.hidden = true;
  texto.textContent = mensagem;

  const timer = setTimeout(() => { texto.hidden = false; }, ATRASO_MENSAGEM);
  // Sem isto o timer segue vivo depois que a tela troca — inofensivo,
  // mas deixa lixo pendurado em cada carregamento.
  box.addEventListener("ws:cleanup", () => clearTimeout(timer));

  box.append(marca, texto);
  return box;
}
