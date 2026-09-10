/**
 * O formulário de cada documento.
 *
 * O PDF real continua sendo a fonte da verdade jurídica (acordo-maps diz
 * ONDE cada valor é carimbado). Aqui fica a outra metade: o que PERGUNTAR
 * ao cliente, com que rótulo e em que língua, para a página web ficar
 * legível no celular em vez de um PDF com linhas em branco.
 *
 * Separado de propósito do mapa de coordenadas: a ordem em que se
 * pergunta não é a ordem em que se carimba, e o rótulo amigável não
 * existe no PDF.
 */

/** Rótulo de cada campo, por idioma. */
const ROTULOS = {
  nome:          { pt: "Nome completo",           en: "Full legal name",      es: "Nombre completo" },
  empresa:       { pt: "Empresa (nome legal)",    en: "Business (legal name)", es: "Empresa (nombre legal)" },
  endereco:      { pt: "Endereço",                en: "Address",              es: "Dirección" },
  cidade:        { pt: "Cidade / Estado / CEP",   en: "City / State / ZIP",   es: "Ciudad / Estado / código postal" },
  telefone:      { pt: "Telefone",                en: "Phone",                es: "Teléfono" },
  email:         { pt: "E-mail",                  en: "Email",                es: "Correo electrónico" },
  pmb:           { pt: "Número da caixa (PMB)",   en: "Mailbox number (PMB)", es: "Número de casilla (PMB)" },
  tamanho:       { pt: "Tamanho da caixa",        en: "Box size",             es: "Tamaño de la casilla" },
  inicio:        { pt: "Início do contrato",      en: "Start date",           es: "Inicio del contrato" },
  vencimento:    { pt: "Vencimento",              en: "Expiration date",      es: "Vencimiento" },
  llcNome:       { pt: "Nome da LLC",             en: "LLC name",             es: "Nombre de la LLC" },
  proposito:     { pt: "Propósito da empresa",    en: "Business purpose",     es: "Propósito de la empresa" },
  socio:         { pt: "Sócio / membro",          en: "Member",               es: "Socio / miembro" },
  socioEndereco: { pt: "Endereço do sócio",       en: "Member address",       es: "Dirección del socio" },
  ssn:           { pt: "SSN / ITIN",              en: "SSN / ITIN",           es: "SSN / ITIN" },
};

/** Tipo de teclado/validação do navegador. */
const TIPOS = { telefone: "tel", email: "email" };

/** O que não pode ir em branco — identidade e contato. */
const OBRIGATORIOS = new Set(["nome", "endereco", "telefone", "email", "llcNome"]);

/** Em que bloco da página o campo aparece. */
const SECAO = {
  nome: "dados", empresa: "dados", endereco: "dados", cidade: "dados",
  telefone: "dados", email: "dados", ssn: "dados",
  socio: "dados", socioEndereco: "dados",
  pmb: "servico", tamanho: "servico", inicio: "servico", vencimento: "servico",
  llcNome: "servico", proposito: "servico",
};

/** Dica de formato, quando o campo tem um. */
const DICAS = {
  inicio:     { pt: "MM/DD/AAAA", en: "MM/DD/YYYY", es: "MM/DD/AAAA" },
  vencimento: { pt: "MM/DD/AAAA", en: "MM/DD/YYYY", es: "MM/DD/AAAA" },
};

/**
 * Os campos de cada documento, na ordem em que se pergunta. A chave é o
 * slug do PDF (o mesmo de acordo-maps), porque o divórcio tem um arquivo
 * por idioma.
 */
const CAMPOS_POR_ACORDO = {
  pobox:  ["nome", "empresa", "endereco", "cidade", "telefone", "email", "pmb", "tamanho", "inicio", "vencimento"],
  llc:    ["llcNome", "proposito", "endereco", "socio", "socioEndereco", "ssn", "telefone", "email"],
  seguro: ["nome", "endereco", "cidade", "telefone", "email"],
  "divorce-en": ["nome", "endereco", "telefone", "email"],
  "divorce-pt": ["nome", "endereco", "telefone", "email"],
  "divorce-es": ["nome", "endereco", "telefone", "email"],
  master: [],
};

/** Títulos dos blocos. */
const SECOES = {
  dados:   { pt: "Seus dados",          en: "Your information",   es: "Sus datos" },
  servico: { pt: "Dados do serviço",    en: "Service details",    es: "Datos del servicio" },
};

/** Textos fixos da página do documento, por idioma. */
const TEXTOS = {
  intro: {
    pt: "Confira seus dados abaixo, corrija o que precisar e assine no fim da página.",
    en: "Review your information below, fix anything that needs it, and sign at the bottom.",
    es: "Revise sus datos abajo, corrija lo que necesite y firme al final de la página.",
  },
  verDocumento: { pt: "Ver o documento completo", en: "View the full document", es: "Ver el documento completo" },
  avisoIdioma: {
    pt: "O contrato é um documento oficial em inglês. Esta página está em português para você conferir os dados.",
    en: "", es: "El contrato es un documento oficial en inglés. Esta página está en español para que revise sus datos.",
  },
  assinatura:   { pt: "Assinatura", en: "Signature", es: "Firma" },
  desenhar:     { pt: "Desenhar", en: "Draw", es: "Dibujar" },
  digitar:      { pt: "Digitar", en: "Type", es: "Escribir" },
  limpar:       { pt: "Limpar", en: "Clear", es: "Borrar" },
  nomeAssina:   { pt: "Digite seu nome completo", en: "Type your full legal name", es: "Escriba su nombre completo" },
  consentimento: {
    pt: "Li e concordo com o documento e assino eletronicamente.",
    en: "I have read and agree to the document and sign it electronically.",
    es: "He leído y acepto el documento y lo firmo electrónicamente.",
  },
  enviar:       { pt: "Aprovar e enviar", en: "Approve and send", es: "Aprobar y enviar" },
  enviando:     { pt: "Enviando…", en: "Sending…", es: "Enviando…" },
  obrigatorio:  { pt: "Preencha os campos obrigatórios.", en: "Please fill in the required fields.", es: "Complete los campos obligatorios." },
  precisaAssinar: { pt: "Assine e marque o aceite para enviar.", en: "Sign and check the box to send.", es: "Firme y marque la casilla para enviar." },
  sucessoTitulo: { pt: "Documento assinado!", en: "Document signed!", es: "¡Documento firmado!" },
  sucessoTexto: {
    pt: "Recebemos seu documento. Nossa equipe já foi avisada e entrará em contato.",
    en: "We received your document. Our team has been notified and will be in touch.",
    es: "Recibimos su documento. Nuestro equipo ya fue avisado y se pondrá en contacto.",
  },
  baixar:       { pt: "Baixar uma cópia", en: "Download a copy", es: "Descargar una copia" },
  expirado:     { pt: "Este link não é válido ou já foi usado.", en: "This link is not valid or has already been used.", es: "Este enlace no es válido o ya fue usado." },
  assinadoEm:   { pt: "Assinado em", en: "Signed on", es: "Firmado el" },
};

const lang = (mapa, chave, idioma) => mapa[chave]?.[idioma] || mapa[chave]?.pt || "";

/** Um texto fixo da página, no idioma pedido. */
export function texto(chave, idioma = "pt") {
  return lang(TEXTOS, chave, idioma);
}

/** O rótulo de um campo, no idioma pedido. */
export function rotulo(campo, idioma = "pt") {
  return lang(ROTULOS, campo, idioma) || campo;
}

/** Os campos de um documento (slug do PDF), com tudo que a página precisa. */
export function camposDoAcordo(slug, idioma = "pt") {
  return (CAMPOS_POR_ACORDO[slug] || []).map((campo) => ({
    campo,
    rotulo: rotulo(campo, idioma),
    tipo: TIPOS[campo] || "text",
    obrigatorio: OBRIGATORIOS.has(campo),
    secao: SECAO[campo] || "dados",
    dica: lang(DICAS, campo, idioma),
  }));
}

/** Os campos agrupados em blocos, na ordem, já com o título do bloco. */
export function secoesDoAcordo(slug, idioma = "pt") {
  const campos = camposDoAcordo(slug, idioma);
  const ordem = ["dados", "servico"];
  return ordem
    .map((id) => ({
      id,
      titulo: lang(SECOES, id, idioma),
      campos: campos.filter((c) => c.secao === id),
    }))
    .filter((s) => s.campos.length);
}

/**
 * Quais obrigatórios ficaram em branco. Devolve os campos (com rótulo)
 * para a página poder apontar exatamente onde faltou.
 */
export function validar(slug, valores = {}, idioma = "pt") {
  return camposDoAcordo(slug, idioma)
    .filter((c) => c.obrigatorio)
    .filter((c) => String(valores[c.campo] ?? "").trim() === "");
}

/** Um documento sem campos não vira formulário — só leitura e assinatura. */
export function temFormulario(slug) {
  return (CAMPOS_POR_ACORDO[slug] || []).length > 0;
}
