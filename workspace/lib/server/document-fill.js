/**
 * Preenchimento de documentos.
 *
 * Ela emite acordos legais prontos — o Master diz, em maiúsculas, que a
 * Latino USA NÃO é escritório de advocacia. Reescrever a linguagem dela
 * atravessaria essa linha. Então este módulo NUNCA gera texto: ele pega
 * o PDF real dela e estampa os dados do cliente sobre as linhas em
 * branco, nas coordenadas que já levantei de cada documento.
 *
 * As coordenadas vêm em pontos de PDF, com a origem embaixo à esquerda
 * (o sistema do pdf-lib). Foram extraídas em dev com o poppler; o runtime
 * não depende dele — só do pdf-lib, que já é dependência.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(AQUI, "..", "..", "assets", "acordos");

// Mesmo saneamento do PDF da ficha: a Helvetica base-14 só desenha
// WinAnsi. Um caractere fora disso viraria caixinha no documento legal.
const WINANSI = new RegExp(
  "[^\\t\\n\\u0020-\\u007E\\u00A0-\\u00FF"
  + "\\u20AC\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014]", "g");

function limpar(texto) {
  return String(texto ?? "").normalize("NFC").replace(WINANSI, "").replace(/\s+/g, " ").trim();
}

const TINTA = rgb(0.06, 0.09, 0.16);

function carregarPdf(slug) {
  const arq = path.join(PASTA, `${slug}.pdf`);
  if (!fs.existsSync(arq)) throw new Error(`acordo_nao_encontrado:${slug}`);
  return fs.readFileSync(arq);
}

/**
 * Preenche um acordo.
 *
 * `mapa` é a lista de campos do documento, cada um `{ campo, page, x, y,
 * size?, max? }` em coordenadas do pdf-lib. `valores[campo]` é o texto a
 * estampar; campo sem valor fica em branco, como o documento em papel.
 *
 * O texto é truncado ao `max` (largura da linha) reduzindo o corpo antes
 * de cortar — um nome longo encolhe para caber em vez de invadir a
 * coluna vizinha.
 */
export async function preencherAcordo({ slug, valores = {}, mapa = [] }) {
  const doc = await PDFDocument.load(carregarPdf(slug), { ignoreEncryption: true });
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();

  for (const campo of mapa) {
    const bruto = valores[campo.campo];
    if (bruto === undefined || bruto === null || bruto === "") continue;
    const texto = limpar(bruto);
    if (!texto) continue;
    const pagina = paginas[campo.page];
    if (!pagina) continue;

    let size = campo.size || 10;
    if (campo.max) {
      // Encolhe até caber, com piso: abaixo de 6.5 a linha fica ilegível
      // e é melhor cortar que espremer.
      while (size > 6.5 && fonte.widthOfTextAtSize(texto, size) > campo.max) size -= 0.5;
    }
    let saida = texto;
    if (campo.max && fonte.widthOfTextAtSize(saida, size) > campo.max) {
      while (saida.length > 1 && fonte.widthOfTextAtSize(`${saida}…`, size) > campo.max) {
        saida = saida.slice(0, -1);
      }
      saida += "…";
    }
    pagina.drawText(saida, { x: campo.x, y: campo.y, size, font: fonte, color: TINTA });
  }

  return doc.save();
}

/** Só para inspeção: quantas páginas o acordo tem. */
export async function paginasDoAcordo(slug) {
  const doc = await PDFDocument.load(carregarPdf(slug), { ignoreEncryption: true });
  return doc.getPageCount();
}
