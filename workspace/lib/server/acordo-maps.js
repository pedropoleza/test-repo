/**
 * Mapas dos acordos: onde cada campo entra no PDF, e de onde o valor vem.
 *
 * `mapa` são as posições no documento (coordenadas do pdf-lib, levantadas
 * de cada PDF). `dados` diz de onde puxar cada valor no CRM:
 *
 *   { std: 'name' }          → campo padrão do contato
 *   { campo: /Nº da Caixa/ }  → campo personalizado, achado pelo nome
 *   { join: [...], sep }      → junta vários numa linha (cidade/estado/ZIP)
 *
 * A ligação por NOME de campo, e não por id, é de propósito: o id do
 * campo muda de conta para conta, mas "POBox · Vencimento" é estável na
 * conta dela — a mesma escolha dos grupos de coluna.
 */

/** Formata uma data ISO no padrão do documento (americano). */
function dataUS(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

export const MAPAS = {
  /**
   * PO Box (PMB) — página 1. Seção 1 é uma coluna de linhas; seção 2 é
   * uma grade de quatro colunas com o valor abaixo do título.
   */
  pobox: {
    idiomas: ["en"],
    mapa: [
      { campo: "nome",       page: 0, x: 290, y: 485, max: 250 },
      { campo: "empresa",    page: 0, x: 290, y: 462, max: 250 },
      { campo: "endereco",   page: 0, x: 290, y: 439, max: 250 },
      { campo: "cidade",     page: 0, x: 290, y: 416, max: 250 },
      { campo: "telefone",   page: 0, x: 290, y: 393, max: 250 },
      { campo: "email",      page: 0, x: 290, y: 370, max: 250 },
      { campo: "pmb",        page: 0, x: 56,  y: 261, size: 9, max: 56 },
      { campo: "tamanho",    page: 0, x: 184, y: 261, size: 9, max: 56 },
      { campo: "inicio",     page: 0, x: 313, y: 261, size: 9, max: 56 },
      { campo: "vencimento", page: 0, x: 441, y: 261, size: 9, max: 56 },
    ],
    dados: {
      nome:       { std: "name" },
      empresa:    { campo: /nome legal|empresa|business|company/i, std: "company" },
      endereco:   { std: "address1" },
      cidade:     { join: ["city", "state", "postalCode"], sep: " / " },
      telefone:   { std: "phone" },
      email:      { std: "email" },
      pmb:        { campo: /caixa|pmb|mailbox/i },
      inicio:     { campo: /data do contrato|start/i, data: true },
      vencimento: { campo: /pobox.*vencimento|vencimento.*pobox|expiration/i, data: true },
    },
  },

  /**
   * LLC Formation — seção 1 (dados) na página 1, o total na página 2.
   */
  llc: {
    idiomas: ["en"],
    mapa: [
      { campo: "llcNome",       page: 0, x: 210, y: 456, max: 300 },
      { campo: "endereco",      page: 0, x: 210, y: 432, max: 300 },
      { campo: "proposito",     page: 0, x: 210, y: 408, max: 300 },
      { campo: "socio",         page: 0, x: 210, y: 384, max: 300 },
      { campo: "socioEndereco", page: 0, x: 210, y: 359, max: 300 },
      { campo: "ssn",           page: 0, x: 210, y: 335, max: 300 },
      { campo: "telefone",      page: 0, x: 210, y: 311, max: 300 },
      { campo: "email",         page: 0, x: 210, y: 287, max: 300 },
    ],
    dados: {
      llcNome:       { campo: /nome legal|llc name|company name/i, std: "company" },
      endereco:      { std: "address1" },
      proposito:     { campo: /prop[óo]sito|purpose|servi[çc]os prestados/i },
      socio:         { std: "name" },
      socioEndereco: { std: "address1" },
      ssn:           { campo: /ssn|itin/i },
      telefone:      { std: "phone" },
      email:         { std: "email" },
    },
  },

  /**
   * Insurance Service Client Agreement — seção 1 (dados do cliente),
   * página 1.
   */
  seguro: {
    idiomas: ["en"],
    mapa: [
      { campo: "nome",     page: 0, x: 200, y: 507, max: 330 },
      { campo: "endereco", page: 0, x: 200, y: 485, max: 330 },
      { campo: "cidade",   page: 0, x: 200, y: 462, max: 330 },
      { campo: "telefone", page: 0, x: 200, y: 440, max: 330 },
      { campo: "email",    page: 0, x: 200, y: 417, max: 330 },
    ],
    dados: {
      nome:     { std: "name" },
      endereco: { std: "address1" },
      cidade:   { join: ["city", "state", "postalCode"], sep: " / " },
      telefone: { std: "phone" },
      email:    { std: "email" },
    },
  },

  /**
   * Divorce Agreement — bloco de intake da PARTE A (o cliente). Só os
   * quatro campos que temos no CRM; o resto (SSN, dados do cônjuge) é
   * sensível ou desconhecido e fica em branco, para preencher à mão.
   *
   * Um mapa por idioma: os PDFs têm layouts diferentes (o inglês tem 4
   * páginas, português e espanhol têm 6), então o bloco cai em páginas e
   * alturas distintas.
   */
  "divorce-en": {
    idiomas: ["en"],
    mapa: [
      { campo: "nome",     page: 1, x: 290, y: 191, max: 250 },
      { campo: "endereco", page: 1, x: 290, y: 169, max: 250 },
      { campo: "telefone", page: 1, x: 290, y: 148, max: 250 },
      { campo: "email",    page: 1, x: 290, y: 126, max: 250 },
    ],
    dados: {
      nome:     { std: "name" },
      endereco: { std: "address1" },
      cidade:   { join: ["city", "state", "postalCode"], sep: " / " },
      telefone: { std: "phone" },
      email:    { std: "email" },
    },
  },
  "divorce-pt": {
    idiomas: ["pt"],
    mapa: [
      { campo: "nome",     page: 3, x: 290, y: 562, max: 250 },
      { campo: "endereco", page: 3, x: 290, y: 539, max: 250 },
      { campo: "telefone", page: 3, x: 290, y: 516, max: 250 },
      { campo: "email",    page: 3, x: 290, y: 493, max: 250 },
    ],
    dados: {
      nome:     { std: "name" },
      endereco: { std: "address1" },
      cidade:   { join: ["city", "state", "postalCode"], sep: " / " },
      telefone: { std: "phone" },
      email:    { std: "email" },
    },
  },
  "divorce-es": {
    idiomas: ["es"],
    mapa: [
      { campo: "nome",     page: 3, x: 290, y: 562, max: 250 },
      { campo: "endereco", page: 3, x: 290, y: 539, max: 250 },
      { campo: "telefone", page: 3, x: 290, y: 516, max: 250 },
      { campo: "email",    page: 3, x: 290, y: 493, max: 250 },
    ],
    dados: {
      nome:     { std: "name" },
      endereco: { std: "address1" },
      cidade:   { join: ["city", "state", "postalCode"], sep: " / " },
      telefone: { std: "phone" },
      email:    { std: "email" },
    },
  },

  /**
   * Master — os termos gerais, iguais para todo cliente. Não tem campo
   * para preencher: "gerar" é entregar o PDF dela como está. Mapa vazio,
   * o motor devolve o documento intacto.
   */
  master: { idiomas: ["en"], mapa: [], dados: {} },
};

/**
 * Monta os valores de um acordo a partir do contato.
 * `entrada` traz o contato cru (para endereço/ZIP, que não viram
 * propriedade), o registro normalizado e as colunas com nome.
 */
export function montarValores(slug, { contact = {}, record = {}, columns = [] } = {}) {
  const spec = MAPAS[slug]?.dados;
  if (!spec) return {};
  const props = record.properties || {};
  const porNome = (re) => {
    const col = columns.find((c) => re.test(c.name || ""));
    return col ? props[col.key] : undefined;
  };
  const padrao = (chave) => {
    if (chave === "name") return record.title || contact.contactName
      || [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    if (chave === "address1") return contact.address1 || "";
    if (chave === "postalCode") return contact.postalCode || "";
    if (chave in props) return props[chave];
    return contact[chave] || "";
  };

  const valores = {};
  for (const [campo, fonte] of Object.entries(spec)) {
    let v;
    if (fonte.join) {
      v = fonte.join.map((k) => padrao(k)).filter((x) => x != null && x !== "").join(fonte.sep || " ");
    } else if (fonte.campo) {
      v = porNome(fonte.campo);
      if ((v == null || v === "") && fonte.std) v = padrao(fonte.std);
    } else if (fonte.std) {
      v = padrao(fonte.std);
    }
    if (fonte.data) v = dataUS(v);
    if (v != null && v !== "") valores[campo] = String(v);
  }
  return valores;
}
