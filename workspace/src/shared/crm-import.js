/**
 * Trazer os campos personalizados da conta para dentro de uma database.
 *
 * O funil do closer vive numa database do engine, não no CRM — é o que
 * permite criar coluna e editar a ficha ali dentro. Mas os campos que a
 * conta já usa (telefone, data de nascimento, origem, o que ela criou no
 * GHL) não podem ser redigitados à mão: além do trabalho, dois nomes
 * ligeiramente diferentes para o mesmo dado é como a base começa a
 * divergir de si mesma.
 *
 * Este módulo é só a tradução: colunas do CRM → campos de database. Quem
 * busca e quem grava são outros.
 *
 * O que NÃO fazemos aqui: sincronizar. O campo importado é uma cópia da
 * DEFINIÇÃO (nome, tipo, opções), não um espelho do valor — o lead do
 * funil pode nem existir como contato ainda. Prometer sincronia e
 * entregar cópia seria pior que entregar cópia.
 */

/** Tipos de coluna do CRM que não valem como campo de ficha. */
const IGNORAR = new Set(["created_time", "last_edited_time"]);

const normal = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Os campos do CRM que ainda não existem na database.
 *
 * `colunas` são as do CRM (shared/crm.js já as entrega no formato de
 * coluna); `campos` são os da database. O casamento é por NOME
 * normalizado, não por chave: a database foi montada à mão, com "Telefone"
 * escrito por uma pessoa, e a chave dela nunca vai bater com a do GHL.
 *
 * Devolve `[{ name, type, config, origem }]`, pronto para createField.
 */
export function camposImportaveis(colunas = [], campos = []) {
  const jaTem = new Set(campos.map((c) => normal(c.name)));
  const vistos = new Set();
  const saida = [];

  for (const coluna of colunas) {
    if (!coluna?.name || IGNORAR.has(coluna.type)) continue;
    // Só o que veio dos campos personalizados da conta: os padrão
    // (nome, e-mail) a ficha já tem, com nomes próprios.
    if (coluna.source !== "ghl_custom_field") continue;
    const chave = normal(coluna.name);
    if (!chave || jaTem.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);

    saida.push({
      name: coluna.name,
      type: tipoDoCampo(coluna),
      config: configDoCampo(coluna),
      origem: coluna.key || null,
    });
  }
  return saida;
}

/**
 * O tipo do campo na database.
 *
 * Um campo do CRM marcado como somente-leitura (upload de arquivo, lista
 * de caixas) não tem equivalente editável aqui: vira texto, porque o que
 * importa é a pessoa poder anotar o que viu, não reproduzir o widget.
 */
export function tipoDoCampo(coluna) {
  if (coluna.readOnly) return "text";
  const t = coluna.type;
  if (["select", "multi_select", "date", "number", "checkbox",
    "url", "email", "phone", "text"].includes(t)) return t;
  return "text";
}

function configDoCampo(coluna) {
  if (!["select", "multi_select"].includes(tipoDoCampo(coluna))) return {};
  const options = (coluna.options || []).map((o, i) => ({
    id: String(o.id ?? o.name ?? i),
    name: String(o.name ?? o.id ?? ""),
    color: o.color || "gray",
  })).filter((o) => o.name);
  // Seleção sem opção nenhuma não é seleção — ninguém conseguiria
  // preencher. Vira texto.
  return options.length ? { options } : null;
}

/**
 * Normaliza um campo importável para o corpo de createField, decidindo o
 * tipo final (uma seleção sem opções cai para texto).
 */
export function paraCriacao(campo) {
  const config = campo.config;
  if (["select", "multi_select"].includes(campo.type) && !config?.options?.length) {
    return { name: campo.name, type: "text", config: {} };
  }
  return { name: campo.name, type: campo.type, config: config || {} };
}
