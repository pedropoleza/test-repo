/**
 * QR e download da ficha, no alto da página — ao lado do rosto.
 *
 * Ficava no fim do painel, depois de dados, campos e oportunidades: para
 * mostrar o código a alguém era preciso rolar a ficha inteira. No topo
 * ele fica junto do que identifica a pessoa, que é onde a mão já está.
 *
 * O QR carrega um endereço que RESPONDE o PDF como anexo — um QR carrega
 * texto, não arquivo. O botão usa o MESMO endereço: um link com a chave
 * da sessão na query só serviria a quem já está logado do mesmo jeito.
 */
import { api } from "../api.js";

export function renderShareBlock(pageId) {
  const box = document.createElement("div");
  box.className = "ws-share";

  const quadro = document.createElement("div");
  quadro.className = "ws-share__qr";
  quadro.title = "Aponte a câmera para baixar o PDF desta ficha";

  const baixar = document.createElement("a");
  baixar.className = "ws-btn ws-btn--ghost ws-share__download";
  baixar.textContent = "Baixar PDF";
  baixar.rel = "noopener";
  baixar.setAttribute("aria-disabled", "true");
  baixar.title = "Baixar a ficha em PDF";

  box.append(quadro, baixar);
  if (!pageId) return box;

  api.dossier.share(pageId).then(({ qr, url }) => {
    if (!quadro.isConnected) return;
    const svg = new DOMParser().parseFromString(qr, "image/svg+xml").documentElement;
    // parseFromString devolve um <parsererror> em vez de lançar quando o
    // SVG vem quebrado; sem esta checagem ele entraria na página.
    if (svg.nodeName.toLowerCase() !== "svg") return;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code para baixar o PDF desta ficha");
    quadro.replaceChildren(svg);
    baixar.href = url;
    baixar.removeAttribute("aria-disabled");
  }).catch(() => {
    if (quadro.isConnected) quadro.classList.add("is-broken");
  });

  return box;
}
