/**
 * PDF da ficha do contato.
 *
 * É um retrato para levar embora: quem lê o QR ou clica em baixar quer o
 * documento do jeito que está agora, fora do app — numa reunião, num
 * anexo de e-mail, num contrato impresso.
 *
 * FONTE E ACENTOS
 * Helvetica das base-14 com WinAnsiEncoding, que é o que o pdf-lib usa
 * por padrão. Cobre o português inteiro (á ã ç é õ) sem embutir fonte —
 * embutir custaria ~300 KB por PDF para ganhar alfabetos que esta conta
 * não usa. Caracteres fora do WinAnsi (emoji, por exemplo) quebrariam a
 * geração, então são retirados antes de escrever.
 */
import {
  PDFDocument, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath,
} from "pdf-lib";
import { COLORS, GRADIENT_STOPS, corDoGradiente, hexToRgb } from "../../src/shared/cover.js";

const A4 = [595.28, 841.89];
const ALTURA_CAPA = 132;
const FOTO = 76;
const MARGEM = 48;
const LARGURA_UTIL = A4[0] - MARGEM * 2;

const TINTA = rgb(0.09, 0.11, 0.15);
const SUAVE = rgb(0.42, 0.45, 0.5);
const LINHA = rgb(0.88, 0.9, 0.93);
const MARCA = rgb(0.15, 0.39, 0.92);

/**
 * WinAnsi cobre o português inteiro (á ã ç é õ) e alguns tipográficos,
 * mas não emoji nem CJK. Um caractere de fora faz o pdf-lib estourar na
 * hora de escrever, então sai antes: um nome com emoji não pode impedir
 * a ficha de sair.
 */
const WINANSI = new RegExp(
  "[^\\t\\n\\u0020-\\u007E\\u00A0-\\u00FF"
  + "\\u20AC\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014]", "g");
const DIACRITICOS = new RegExp("[\\u0300-\\u036F]", "g");

function limpar(texto) {
  return String(texto ?? "")
    .normalize("NFC")
    .replace(WINANSI, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildDossierPdf({
  page, record, columns, opportunities, opportunityColumns, notes, tasks,
  geradoEm = new Date(),
}) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(limpar(record?.title || page?.title || "Ficha"));
  doc.setCreator("Spark");
  doc.setProducer("Spark");

  let atual = doc.addPage(A4);
  let y = A4[1] - MARGEM;

  const largura = (texto, size, font) => font.widthOfTextAtSize(texto, size);

  /** Quebra o texto na largura disponível, palavra a palavra. */
  function quebrar(texto, size, font, max) {
    const palavras = limpar(texto).split(" ").filter(Boolean);
    const linhas = [];
    let linha = "";
    for (const palavra of palavras) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (largura(tentativa, size, font) <= max) { linha = tentativa; continue; }
      if (linha) linhas.push(linha);
      // Palavra sozinha maior que a linha (URL, e-mail comprido): corta.
      if (largura(palavra, size, font) > max) {
        let pedaco = "";
        for (const ch of palavra) {
          if (largura(pedaco + ch, size, font) > max) { linhas.push(pedaco); pedaco = ch; }
          else pedaco += ch;
        }
        linha = pedaco;
      } else {
        linha = palavra;
      }
    }
    if (linha) linhas.push(linha);
    return linhas.length ? linhas : [""];
  }

  function espaco(altura) {
    if (y - altura >= MARGEM) return;
    atual = doc.addPage(A4);
    y = A4[1] - MARGEM;
  }

  function texto(valor, { size = 10, font = regular, cor = TINTA, x = MARGEM, max = LARGURA_UTIL, gap = 3 } = {}) {
    for (const linha of quebrar(valor, size, font, max)) {
      espaco(size + gap);
      atual.drawText(linha, { x, y: y - size, size, font, color: cor });
      y -= size + gap;
    }
  }

  function regua(gap = 10) {
    espaco(gap + 1);
    y -= gap / 2;
    atual.drawLine({
      start: { x: MARGEM, y },
      end: { x: A4[0] - MARGEM, y },
      thickness: 0.7,
      color: LINHA,
    });
    y -= gap / 2;
  }

  function titulo(valor) {
    espaco(30);
    y -= 10;
    texto(valor.toUpperCase(), { size: 9, font: negrito, cor: SUAVE, gap: 6 });
  }

  /**
   * Rótulo à esquerda, valor à direita.
   *
   * Os dois quebram em várias linhas: os campos personalizados desta
   * conta são perguntas inteiras ("Você já tem algum plano pensando na
   * sua aposentadoria?"), e cortar o rótulo na primeira linha deixava o
   * valor sem contexto.
   */
  function campo(rotulo, valor) {
    const limpo = limpar(valor);
    if (!limpo) return;
    const larguraRotulo = 165;
    const linhasValor = quebrar(limpo, 10, regular, LARGURA_UTIL - larguraRotulo - 12);
    const linhasRotulo = quebrar(rotulo, 9, regular, larguraRotulo);
    const altura = Math.max(linhasValor.length, linhasRotulo.length) * 13 + 4;

    espaco(altura);
    linhasRotulo.forEach((linha, i) => {
      atual.drawText(linha, {
        x: MARGEM, y: y - 10 - i * 13, size: 9, font: regular, color: SUAVE,
      });
    });
    linhasValor.forEach((linha, i) => {
      atual.drawText(linha, {
        x: MARGEM + larguraRotulo + 12, y: y - 10 - i * 13, size: 10, font: regular, color: TINTA,
      });
    });
    y -= altura;
  }

  /* ---------------- capa, foto e nome ---------------- */

  /*
   * O papel repete o enquadramento da tela: banner no topo, rosto metade
   * sobre ele, nome embaixo. Quem recebe o PDF reconhece a ficha que viu
   * no app, em vez de um relatório de aparência alheia.
   *
   * As duas imagens são buscadas juntas e falham soft: capa ou foto que
   * não carrega não pode impedir a ficha de sair.
   */
  const fotoUrl = page?.icon_type === "url" ? page.icon_value : null;
  const capaUrl = page?.cover_type === "image" ? page.cover_value : null;
  const [capaBuf, fotoBuf] = await Promise.all([baixarImagem(capaUrl), baixarImagem(fotoUrl)]);
  const capaImg = await embutir(doc, capaBuf);
  const fotoImg = await embutir(doc, fotoBuf);

  const temCapa = !!(page?.cover_type);
  if (temCapa) {
    desenharCapa(page, atual, capaImg);
    // A marca sobre a capa, em branco: sobre um degradê escuro o azul da
    // marca some.
    atual.drawText("SPARK", {
      x: MARGEM, y: A4[1] - 26, size: 11, font: negrito, color: rgb(1, 1, 1),
    });
    y = A4[1] - ALTURA_CAPA;
    desenharFoto(atual, {
      imagem: fotoImg, iniciais: iniciaisDe(record?.title || page?.title),
      fonte: negrito, x: MARGEM, cy: y,
    });
    y -= FOTO / 2 + 16;
  } else {
    atual.drawText("SPARK", { x: MARGEM, y: y - 11, size: 11, font: negrito, color: MARCA });
    y -= 26;
    const iniciais = iniciaisDe(record?.title || page?.title);
    if (fotoImg || iniciais) {
      desenharFoto(atual, { imagem: fotoImg, iniciais, fonte: negrito, x: MARGEM, cy: y - FOTO / 2 });
      y -= FOTO + 12;
    }
  }

  texto(record?.title || page?.title || "Sem nome", { size: 22, font: negrito, gap: 6 });
  const p = record?.properties || {};
  const contato = [p.email, p.phone].filter(Boolean).join("  ·  ");
  if (contato) texto(contato, { size: 10, cor: SUAVE, gap: 4 });
  texto(`Ficha do contato · ${geradoEm.toLocaleDateString("pt-BR")}`,
    { size: 8.5, cor: SUAVE, gap: 4 });
  regua(14);

  /* ---------------- dados ---------------- */

  const padrao = (columns || []).filter((c) => !c.key.startsWith("cf_") && !c.primary);
  const custom = (columns || []).filter((c) => c.key.startsWith("cf_"));

  titulo("Dados do contato");
  let algum = false;
  for (const col of padrao) {
    const valor = valorLegivel(col, p[col.key]);
    if (!valor) continue;
    campo(col.name, valor);
    algum = true;
  }
  if (!algum) texto("Sem dados preenchidos no CRM.", { size: 10, cor: SUAVE });

  // Só os preenchidos: esta conta tem 115 campos personalizados, e listar
  // todos deixaria o PDF com páginas de rótulos vazios.
  const preenchidos = custom.filter((c) => {
    const v = p[c.key];
    return !(v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length));
  });
  if (preenchidos.length) {
    titulo("Campos personalizados");
    for (const col of preenchidos) {
      campo(col.name, valorLegivel(col, p[col.key]));
    }
  }

  /* ---------------- oportunidades ---------------- */

  titulo(`Oportunidades (${(opportunities || []).length})`);
  if (!opportunities?.length) {
    texto("Nenhuma oportunidade neste contato.", { size: 10, cor: SUAVE });
  } else {
    for (const opp of opportunities) {
      espaco(30);
      texto(opp.title, { size: 11, font: negrito, gap: 2 });
      const props = opp.properties || {};
      const partes = [props.pipeline, props.stage, STATUS_LABEL[props.status] || props.status]
        .filter(Boolean).join("  ·  ");
      if (partes) texto(partes, { size: 9, cor: SUAVE, gap: 2 });
      const dono = valorLegivel(
        (opportunityColumns || []).find((c) => c.key === "assigned"), props.assigned);
      if (dono) texto(`Responsável: ${dono}`, { size: 9, cor: SUAVE, gap: 2 });
      if (props.value) {
        texto(`Valor: ${Number(props.value).toLocaleString("pt-BR", {
          style: "currency", currency: "USD",
        })}`, { size: 9, cor: SUAVE, gap: 6 });
      } else {
        y -= 4;
      }
    }
  }

  /* ---------------- notas e tarefas ---------------- */

  if (notes?.length) {
    titulo(`Notas do CRM (${notes.length})`);
    for (const n of notes.slice(0, 25)) {
      texto(n.body || n.note || "—", { size: 10, gap: 3 });
      y -= 4;
    }
  }

  if (tasks?.length) {
    titulo(`Tarefas (${tasks.length})`);
    for (const t of tasks.slice(0, 25)) {
      const marca = t.completed ? "[x]" : "[ ]";
      const prazo = t.dueDate ? ` — vence em ${new Date(t.dueDate).toLocaleDateString("pt-BR")}` : "";
      texto(`${marca} ${t.title || t.body || "—"}${prazo}`, { size: 10, gap: 3 });
    }
  }

  /* ---------------- rodapé em todas as páginas ---------------- */

  const paginas = doc.getPages();
  paginas.forEach((pg, i) => {
    pg.drawText(limpar(`Spark · ${record?.title || ""} · ${i + 1}/${paginas.length}`), {
      x: MARGEM, y: MARGEM - 18, size: 8, font: regular, color: SUAVE,
    });
  });

  return Buffer.from(await doc.save());
}

const STATUS_LABEL = {
  open: "Aberta", won: "Ganha", lost: "Perdida", abandoned: "Abandonada",
};

/**
 * O valor legível de uma coluna.
 *
 * Colunas de escolha guardam o ID da opção — "Responsável" guarda o id
 * do usuário no CRM. Escrever o valor cru punha uma cadeia opaca no PDF,
 * o mesmo defeito que a tabela já tinha corrigido. Opção desconhecida
 * cai para o valor cru: melhor um id do que um campo vazio.
 */
function valorLegivel(col, bruto) {
  const opcoes = col?.options || [];
  const nome = (id) => opcoes.find((o) => o.id === id)?.name || id;

  if (Array.isArray(bruto)) return bruto.map(nome).join(", ");
  if (bruto === true) return "Sim";
  if (bruto === false) return "";
  if (bruto === null || bruto === undefined || bruto === "") return "";
  if (col?.type === "select" || col?.type === "status") return nome(bruto);
  if (col?.type === "number") return Number(bruto).toLocaleString("pt-BR");
  return String(bruto);
}

/** Nome do arquivo: legível e seguro em qualquer sistema. */
export function nomeDoArquivo(titulo) {
  const base = limpar(titulo || "ficha")
    .normalize("NFD").replace(DIACRITICOS, "")
    .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
    .slice(0, 60) || "ficha";
  return `${base}.pdf`;
}

/* ------------------------------------------------------------------ */
/* Capa e foto                                                        */
/* ------------------------------------------------------------------ */

const MAX_IMAGEM_BYTES = 6 * 1024 * 1024;
const TIMEOUT_IMAGEM_MS = 6000;

/**
 * Baixa uma imagem para embutir no PDF.
 *
 * Falha soft de propósito: capa ou foto que não carrega não pode impedir
 * a ficha de sair — o documento continua útil sem elas. Por isso o
 * timeout curto e o teto de tamanho, que também evitam um PDF de 40 MB
 * por causa de uma foto que alguém subiu sem redimensionar.
 */
async function baixarImagem(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IMAGEM_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const tamanho = Number(res.headers.get("content-length"));
    if (Number.isFinite(tamanho) && tamanho > MAX_IMAGEM_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGEM_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embute PNG ou JPEG, decidindo pelos bytes iniciais.
 *
 * O content-type do servidor mente com frequência (imagens servidas como
 * octet-stream), e o pdf-lib estoura se receber o formato errado.
 */
async function embutir(doc, buf) {
  if (!buf || buf.length < 4) return null;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  try {
    if (png) return await doc.embedPng(buf);
    if (jpg) return await doc.embedJpg(buf);
  } catch {
    // Imagem corrompida ou em formato que o pdf-lib não lê (webp, avif).
  }
  return null;
}

/** Caminho de recorte circular, em quatro arcos de Bézier. */
const KAPPA = 0.5522847498;
function recorteCircular(page, cx, cy, r) {
  const k = r * KAPPA;
  page.pushOperators(
    pushGraphicsState(),
    moveTo(cx - r, cy),
    appendBezierCurve(cx - r, cy + k, cx - k, cy + r, cx, cy + r),
    appendBezierCurve(cx + k, cy + r, cx + r, cy + k, cx + r, cy),
    appendBezierCurve(cx + r, cy - k, cx + k, cy - r, cx, cy - r),
    appendBezierCurve(cx - k, cy - r, cx - r, cy - k, cx - r, cy),
    closePath(),
    clip(),
    endPath(),
  );
}

/**
 * A faixa do topo, reproduzindo a capa da página.
 *
 * Gradiente vira faixas verticais interpolando as mesmas paradas que o
 * browser usa — o pdf-lib não tem gradiente, e na resolução de impressão
 * 160 faixas não se distinguem de um degradê contínuo.
 */
function desenharCapa(page, pdfPage, imagem) {
  const [largura] = A4;
  const topo = A4[1] - ALTURA_CAPA;

  if (imagem) {
    // `cover`: preenche a faixa sem distorcer, cortando o excedente.
    const escala = Math.max(largura / imagem.width, ALTURA_CAPA / imagem.height);
    const w = imagem.width * escala;
    const h = imagem.height * escala;
    const y = (page.cover_position_y ?? 50) / 100;
    pdfPage.pushOperators(pushGraphicsState());
    pdfPage.drawRectangle({ x: 0, y: topo, width: largura, height: ALTURA_CAPA, color: rgb(1, 1, 1) });
    pdfPage.drawImage(imagem, {
      x: (largura - w) / 2,
      y: topo - (h - ALTURA_CAPA) * (1 - y),
      width: w,
      height: h,
    });
    pdfPage.pushOperators(popGraphicsState());
    return;
  }

  if (page.cover_type === "color") {
    const { r, g, b } = hexToRgb(COLORS[page.cover_value] || page.cover_value || COLORS.blue);
    pdfPage.drawRectangle({ x: 0, y: topo, width: largura, height: ALTURA_CAPA, color: rgb(r, g, b) });
    return;
  }

  const nome = GRADIENT_STOPS[page.cover_value] ? page.cover_value : "spark-blue";
  const faixas = 160;
  const passo = largura / faixas;
  for (let i = 0; i < faixas; i += 1) {
    const { r, g, b } = corDoGradiente(nome, i / (faixas - 1));
    pdfPage.drawRectangle({
      x: i * passo,
      y: topo,
      // Meio ponto de sobreposição: sem ele aparecem fios brancos entre
      // as faixas em alguns leitores.
      width: passo + 0.5,
      height: ALTURA_CAPA,
      color: rgb(r, g, b),
    });
  }
}

/** O rosto, metade sobre a capa — o mesmo enquadramento da tela. */
function desenharFoto(pdfPage, { imagem, iniciais, fonte, x, cy }) {
  const r = FOTO / 2;
  const cx = x + r;

  // Anel branco por baixo, para destacar de qualquer capa.
  pdfPage.drawCircle({ x: cx, y: cy, size: r + 3.5, color: rgb(1, 1, 1) });

  if (imagem) {
    recorteCircular(pdfPage, cx, cy, r);
    // `cover`: preenche o círculo sem distorcer o rosto.
    const escala = Math.max(FOTO / imagem.width, FOTO / imagem.height);
    const w = imagem.width * escala;
    const h = imagem.height * escala;
    pdfPage.drawImage(imagem, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
    pdfPage.pushOperators(popGraphicsState());
    return;
  }

  // Sem foto, as iniciais — as mesmas da tela. Um círculo vazio no papel
  // parece imagem que não carregou.
  pdfPage.drawCircle({ x: cx, y: cy, size: r, color: rgb(0.85, 0.9, 1) });
  const texto = limpar(iniciais || "");
  if (!texto || !fonte) return;
  const tamanho = 26;
  const largura = fonte.widthOfTextAtSize(texto, tamanho);
  pdfPage.drawText(texto, {
    x: cx - largura / 2,
    // O 0.34 aproxima a altura das maiúsculas da Helvetica: centralizar
    // pela caixa da fonte deixaria as letras visivelmente altas.
    y: cy - tamanho * 0.34,
    size: tamanho,
    font: fonte,
    color: rgb(0.08, 0.29, 0.72),
  });
}

/**
 * Iniciais do nome — primeira e última palavra, a mesma regra da tela.
 * Nome que é só telefone ou e-mail não tem inicial que sirva.
 */
function iniciaisDe(nome) {
  const partes = limpar(nome).split(" ").filter(Boolean);
  if (!partes.length) return "";
  const primeira = partes[0][0] || "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  const iniciais = (primeira + ultima).toUpperCase();
  return /[A-ZÀ-Ý]/.test(iniciais) ? iniciais : "";
}
