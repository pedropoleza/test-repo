/**
 * Certificado de assinatura eletrônica.
 *
 * O documento legal dela não é tocado: o certificado entra como uma
 * PÁGINA NOVA no fim do PDF, com quem assinou, como, quando e de onde.
 * É o mesmo caminho que os serviços de e-sign seguem — e resolve um
 * problema prático: não precisamos saber onde fica a linha de assinatura
 * de cada contrato para carimbar em cima dela.
 *
 * A assinatura desenhada entra como imagem; a digitada, escrita em itálico
 * sobre a mesma linha. Nos dois casos, ao lado ficam a data/hora em UTC,
 * o IP de origem e a referência do pedido — o que dá rastro à assinatura.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const TINTA = rgb(0.06, 0.09, 0.16);
const SUAVE = rgb(0.42, 0.45, 0.5);
const LINHA = rgb(0.78, 0.80, 0.84);

const WINANSI = new RegExp(
  "[^\\t\\n\\u0020-\\u007E\\u00A0-\\u00FF"
  + "\\u20AC\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014]", "g");
const limpar = (t) => String(t ?? "").normalize("NFC").replace(WINANSI, "").replace(/\s+/g, " ").trim();

/** Títulos do certificado, no idioma do cliente. */
const T = {
  titulo:    { pt: "Certificado de Assinatura Eletrônica", en: "Electronic Signature Certificate", es: "Certificado de Firma Electrónica" },
  documento: { pt: "Documento", en: "Document", es: "Documento" },
  assinante: { pt: "Assinado por", en: "Signed by", es: "Firmado por" },
  data:      { pt: "Data e hora (UTC)", en: "Date and time (UTC)", es: "Fecha y hora (UTC)" },
  ip:        { pt: "Endereço IP", en: "IP address", es: "Dirección IP" },
  ref:       { pt: "Referência", en: "Reference", es: "Referencia" },
  metodo:    { pt: "Método", en: "Method", es: "Método" },
  desenhada: { pt: "Assinatura desenhada", en: "Drawn signature", es: "Firma dibujada" },
  digitada:  { pt: "Nome digitado", en: "Typed name", es: "Nombre escrito" },
  aviso: {
    pt: "Este certificado registra o aceite eletrônico do documento acima.",
    en: "This certificate records the electronic acceptance of the document above.",
    es: "Este certificado registra la aceptación electrónica del documento anterior.",
  },
};
const t = (chave, lang) => T[chave]?.[lang] || T[chave]?.en || "";

/**
 * Anexa o certificado ao PDF já preenchido.
 *
 * `imagem` é o data URL PNG da assinatura desenhada (ou vazio, quando ela
 * foi digitada). Devolve os bytes do PDF final.
 */
export async function anexarCertificado(bytes, {
  documento = "", assinadoPor = "", tipo = "digitada", imagem = "",
  assinadoEm = new Date(), ip = "", referencia = "", idioma = "pt",
} = {}) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const italico = await doc.embedFont(StandardFonts.TimesRomanItalic);

  // Mesmo tamanho da última página, para o documento não mudar de formato.
  const anteriores = doc.getPages();
  const ultima = anteriores[anteriores.length - 1];
  const [largura, altura] = ultima ? [ultima.getWidth(), ultima.getHeight()] : [612, 792];
  const pagina = doc.addPage([largura, altura]);

  const M = 56;
  let y = altura - M - 10;

  pagina.drawText(limpar(t("titulo", idioma)), { x: M, y, size: 15, font: negrito, color: TINTA });
  y -= 10;
  pagina.drawLine({ start: { x: M, y }, end: { x: largura - M, y }, thickness: 1, color: LINHA });
  y -= 30;

  // A assinatura em si, sobre uma linha.
  const larguraAss = Math.min(260, largura - M * 2);
  if (tipo === "desenhada" && imagem) {
    const base64 = String(imagem).split(",").pop();
    try {
      const png = await doc.embedPng(Buffer.from(base64, "base64"));
      const escala = Math.min(larguraAss / png.width, 70 / png.height);
      pagina.drawImage(png, {
        x: M, y: y - png.height * escala + 8,
        width: png.width * escala, height: png.height * escala,
      });
      y -= Math.max(png.height * escala, 40);
    } catch {
      // PNG ilegível não pode derrubar a assinatura: cai para o nome.
      pagina.drawText(limpar(assinadoPor), { x: M, y: y - 22, size: 20, font: italico, color: TINTA });
      y -= 34;
    }
  } else {
    pagina.drawText(limpar(assinadoPor), { x: M, y: y - 22, size: 20, font: italico, color: TINTA });
    y -= 34;
  }

  pagina.drawLine({ start: { x: M, y }, end: { x: M + larguraAss, y }, thickness: 0.8, color: LINHA });
  y -= 26;

  const linhas = [
    [t("documento", idioma), documento],
    [t("assinante", idioma), assinadoPor],
    [t("metodo", idioma), tipo === "desenhada" ? t("desenhada", idioma) : t("digitada", idioma)],
    [t("data", idioma), new Date(assinadoEm).toISOString().replace("T", " ").slice(0, 19)],
    [t("ip", idioma), ip || "-"],
    [t("ref", idioma), referencia],
  ];
  for (const [rotulo, valor] of linhas) {
    pagina.drawText(limpar(`${rotulo}:`), { x: M, y, size: 9, font: negrito, color: SUAVE });
    pagina.drawText(limpar(valor), { x: M + 130, y, size: 9, font: fonte, color: TINTA });
    y -= 16;
  }

  y -= 10;
  pagina.drawText(limpar(t("aviso", idioma)), { x: M, y, size: 8, font: fonte, color: SUAVE });

  // Mesmo motivo do document-fill: sem object streams os PDFs de divórcio
  // não corrompem e o arquivo abre em qualquer leitor.
  return doc.save({ useObjectStreams: false });
}
