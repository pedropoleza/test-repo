/**
 * Propriedades de database: tipos, normalização de valores, filtros e
 * ordenação.
 *
 * Compartilhado entre browser e servidor, como shared/blocks.js. O
 * servidor é quem aplica filtro e sort de verdade; o cliente usa o mesmo
 * código para prever o resultado sem ida à rede.
 *
 * Valores de um registro vivem em `workspace_pages.properties` como
 * `{ [field.key]: valor }` — um registro É uma página (§18), então abrir
 * como página completa sai de graça.
 */

export const FIELD_TYPES = {
  text:             { label: "Texto",            icon: "T",  sortable: true },
  number:           { label: "Número",           icon: "#",  sortable: true, numeric: true },
  select:           { label: "Seleção",          icon: "◦",  sortable: true, options: true },
  multi_select:     { label: "Multi-seleção",    icon: "◇",  sortable: false, options: true, multi: true },
  status:           { label: "Status",           icon: "◐",  sortable: true, options: true },
  date:             { label: "Data",             icon: "🗓", sortable: true },
  checkbox:         { label: "Checkbox",         icon: "☑",  sortable: true },
  url:              { label: "URL",              icon: "🔗", sortable: true },
  email:            { label: "E-mail",           icon: "@",  sortable: true },
  phone:            { label: "Telefone",         icon: "☎",  sortable: true },
  person:           { label: "Pessoa",           icon: "👤", sortable: true },
  created_time:     { label: "Criado em",        icon: "⏱",  sortable: true, readOnly: true },
  last_edited_time: { label: "Última edição",    icon: "⏱",  sortable: true, readOnly: true },
};

export function isFieldType(type) {
  return Object.prototype.hasOwnProperty.call(FIELD_TYPES, type);
}

export function fieldSpec(type) {
  return FIELD_TYPES[type] || FIELD_TYPES.text;
}

/** Paleta das opções de select/status — mesmos tons do design system. */
export const OPTION_COLORS = [
  "gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "brown",
];

/** Gera uma chave estável a partir do nome, sem acento nem espaço. */
export function fieldKeyFrom(name, taken = []) {
  const base =
    String(name || "campo")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "campo";
  let key = base;
  let n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

/**
 * Aceita "1234.5", "1234,5" e "1.234,5". Quem digita numa tabela usa o
 * formato brasileiro, e tratar o ponto como decimal cegamente transforma
 * mil duzentos e trinta e quatro em NaN.
 */
export function parseNumberPtBr(input) {
  const s = input.trim().replace(/[\s\u00a0]/g, "");
  if (!s) return NaN;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // o último separador é o decimal; o outro é milhar
    return Number(
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, ""),
    );
  }
  if (hasComma) return Number(s.replace(",", "."));
  return Number(s);
}

/** Coage o valor cru ao formato canônico do tipo. Nunca lança. */
export function normalizeValue(field, raw) {
  const type = field?.type;
  switch (type) {
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return null;
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      const n = parseNumberPtBr(String(raw));
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return raw === true || raw === "true";
    case "select":
    case "status": {
      const id = raw == null ? null : String(raw);
      if (!id) return null;
      const options = field.config?.options || [];
      return options.some((o) => o.id === id) ? id : null;
    }
    case "multi_select": {
      if (!Array.isArray(raw)) return [];
      const ids = (field.config?.options || []).map((o) => o.id);
      return [...new Set(raw.map(String).filter((v) => ids.includes(v)))];
    }
    case "date": {
      if (!raw) return null;
      const s = String(raw);
      return ISO_DATE.test(s) ? s : null;
    }
    case "url":
    case "email":
    case "phone":
    case "person":
    case "text":
      return raw == null ? "" : String(raw).slice(0, 4000);
    case "created_time":
    case "last_edited_time":
      return null; // derivado da página, nunca gravado
    default:
      return raw == null ? "" : String(raw).slice(0, 4000);
  }
}

/** Valor efetivo de um campo num registro, incluindo os derivados. */
export function readValue(field, record) {
  // A coluna principal É o título da página, não uma propriedade solta.
  // Sem isto o registro aberto como página apareceria sem título, e a
  // coluna e o título viveriam desencontrados.
  if (field.is_primary) return record.title || "";
  if (field.type === "created_time") return record.created_at || null;
  if (field.type === "last_edited_time") return record.updated_at || null;
  const props = record.properties || {};
  const raw = props[field.key];
  return raw === undefined ? emptyValue(field) : normalizeValue(field, raw);
}

export function emptyValue(field) {
  if (field.type === "multi_select") return [];
  if (field.type === "checkbox") return false;
  if (field.type === "number") return null;
  if (field.type === "select" || field.type === "status" || field.type === "date") return null;
  return "";
}

export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "boolean") return value === false;
  return false;
}

/** Texto de um valor — usado em busca, agrupamento e ordenação de texto. */
export function valueToText(field, value) {
  if (isEmptyValue(value)) return "";
  if (field.type === "select" || field.type === "status") {
    return optionName(field, value);
  }
  if (field.type === "multi_select") {
    return value.map((id) => optionName(field, id)).join(", ");
  }
  if (field.type === "checkbox") return value ? "Sim" : "Não";
  return String(value);
}

export function optionName(field, id) {
  return (field.config?.options || []).find((o) => o.id === id)?.name || "";
}

export function optionColor(field, id) {
  return (field.config?.options || []).find((o) => o.id === id)?.color || "gray";
}

/* ------------------------------------------------------------------ */
/* Filtros (§20)                                                      */
/* ------------------------------------------------------------------ */

export const OPERATORS = {
  text: ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  status: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multi_select: ["contains", "not_contains", "is_empty", "is_not_empty"],
  date: ["equals", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"],
  checkbox: ["equals"],
  url: ["contains", "equals", "is_empty", "is_not_empty"],
  email: ["contains", "equals", "is_empty", "is_not_empty"],
  phone: ["contains", "equals", "is_empty", "is_not_empty"],
  person: ["contains", "equals", "is_empty", "is_not_empty"],
  created_time: ["before", "after", "on_or_before", "on_or_after"],
  last_edited_time: ["before", "after", "on_or_before", "on_or_after"],
};

export const OPERATOR_LABEL = {
  contains: "contém",
  not_contains: "não contém",
  equals: "é",
  not_equals: "não é",
  gt: "maior que",
  gte: "maior ou igual",
  lt: "menor que",
  lte: "menor ou igual",
  before: "antes de",
  after: "depois de",
  on_or_before: "em ou antes de",
  on_or_after: "em ou depois de",
  is_empty: "está vazio",
  is_not_empty: "não está vazio",
};

export function operatorsFor(type) {
  return OPERATORS[type] || OPERATORS.text;
}

/**
 * Avalia um grupo de filtros. Grupos aninham, então
 * `Status = Ativo AND (Prioridade = Alta OR Prazo < hoje)` é representável.
 *
 * group = { op: 'and'|'or', conditions: [condition | group] }
 * condition = { field: key, operator, value }
 */
export function matchesFilter(group, record, fieldsByKey) {
  if (!group || !Array.isArray(group.conditions) || !group.conditions.length) return true;
  const op = group.op === "or" ? "or" : "and";
  const results = group.conditions.map((c) =>
    c && Array.isArray(c.conditions)
      ? matchesFilter(c, record, fieldsByKey)
      : matchesCondition(c, record, fieldsByKey),
  );
  return op === "and" ? results.every(Boolean) : results.some(Boolean);
}

function matchesCondition(cond, record, fieldsByKey) {
  const field = fieldsByKey[cond?.field];
  if (!field) return true; // campo removido: condição deixa de filtrar
  const value = readValue(field, record);
  const target = cond.value;

  switch (cond.operator) {
    case "is_empty":     return isEmptyValue(value);
    case "is_not_empty": return !isEmptyValue(value);
    case "contains":
      if (field.type === "multi_select") return (value || []).includes(String(target));
      return norm(valueToText(field, value)).includes(norm(String(target ?? "")));
    case "not_contains":
      if (field.type === "multi_select") return !(value || []).includes(String(target));
      return !norm(valueToText(field, value)).includes(norm(String(target ?? "")));
    case "equals":
      if (field.type === "checkbox") return !!value === (target === true || target === "true");
      if (field.type === "number") return Number(value) === Number(target);
      return norm(valueToText(field, value)) === norm(valueToText(field, normalizeValue(field, target)));
    case "not_equals":
      if (field.type === "number") return Number(value) !== Number(target);
      return norm(valueToText(field, value)) !== norm(valueToText(field, normalizeValue(field, target)));
    case "gt":  return Number(value) >  Number(target);
    case "gte": return Number(value) >= Number(target);
    case "lt":  return Number(value) <  Number(target);
    case "lte": return Number(value) <= Number(target);
    case "before":       return cmpDate(value, target) <  0;
    case "after":        return cmpDate(value, target) >  0;
    case "on_or_before": return cmpDate(value, target) <= 0;
    case "on_or_after":  return cmpDate(value, target) >= 0;
    default: return true;
  }
}

function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function cmpDate(a, b) {
  const da = a ? Date.parse(a) : NaN;
  const db = b ? Date.parse(b) : NaN;
  if (Number.isNaN(da) || Number.isNaN(db)) return NaN === da ? -1 : 1;
  return da === db ? 0 : da < db ? -1 : 1;
}

/** Valida e limpa um grupo de filtros vindo do cliente. */
export function normalizeFilter(group, depth = 0) {
  const empty = { op: "and", conditions: [] };
  if (!group || typeof group !== "object" || depth > 4) return empty;
  const op = group.op === "or" ? "or" : "and";
  const conditions = Array.isArray(group.conditions) ? group.conditions : [];
  return {
    op,
    conditions: conditions
      .slice(0, 30)
      .map((c) => {
        if (c && Array.isArray(c.conditions)) return normalizeFilter(c, depth + 1);
        if (!c || typeof c.field !== "string") return null;
        const operator = OPERATOR_LABEL[c.operator] ? c.operator : "contains";
        return { field: c.field, operator, value: c.value ?? null };
      })
      .filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* Ordenação (§21)                                                    */
/* ------------------------------------------------------------------ */

export function normalizeSorts(sorts) {
  if (!Array.isArray(sorts)) return [];
  return sorts
    .slice(0, 8)
    .filter((s) => s && typeof s.field === "string")
    .map((s) => ({ field: s.field, direction: s.direction === "desc" ? "desc" : "asc" }));
}

/** Ordena registros por várias regras, na ordem em que aparecem. */
export function applySorts(records, sorts, fieldsByKey) {
  const rules = normalizeSorts(sorts).filter((s) => fieldsByKey[s.field]);
  if (!rules.length) return records;

  return [...records].sort((a, b) => {
    for (const rule of rules) {
      const field = fieldsByKey[rule.field];
      const va = readValue(field, a);
      const vb = readValue(field, b);

      // Vazio sempre por último, independente da direção — linha
      // incompleta não deve disputar o topo ao inverter a ordenação.
      // Precisa ficar FORA da negação de `desc`.
      const ea = isEmptyValue(va);
      const eb = isEmptyValue(vb);
      if (ea || eb) {
        if (ea && eb) continue;
        return ea ? 1 : -1;
      }

      const cmp = compareValues(field, va, vb);
      if (cmp !== 0) return rule.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

function compareValues(field, a, b) {
  if (fieldSpec(field.type).numeric) return Number(a) - Number(b);
  if (field.type === "checkbox") return (a ? 1 : 0) - (b ? 1 : 0);
  if (field.type === "date" || field.type === "created_time" || field.type === "last_edited_time") {
    const d = cmpDate(a, b);
    return Number.isNaN(d) ? 0 : d;
  }
  return valueToText(field, a).localeCompare(valueToText(field, b), "pt-BR", { numeric: true });
}

/* ------------------------------------------------------------------ */
/* Agrupamento (§22)                                                  */
/* ------------------------------------------------------------------ */

/** Agrupa registros por um campo. Devolve [{ key, label, color, records }]. */
export function groupRecords(records, field) {
  if (!field) return [{ key: "__all__", label: "", color: null, records }];

  const buckets = new Map();
  const push = (key, label, color, record) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, color, records: [] });
    buckets.get(key).records.push(record);
  };

  for (const record of records) {
    const value = readValue(field, record);
    if (field.type === "multi_select") {
      const ids = value || [];
      if (!ids.length) push("__empty__", "Sem valor", "gray", record);
      else ids.forEach((id) => push(id, optionName(field, id), optionColor(field, id), record));
      continue;
    }
    if (isEmptyValue(value)) {
      push("__empty__", "Sem valor", "gray", record);
      continue;
    }
    if (field.type === "select" || field.type === "status") {
      push(String(value), optionName(field, value), optionColor(field, value), record);
      continue;
    }
    const text = valueToText(field, value);
    push(text, text, null, record);
  }

  // Para select/status a ordem das opções é a que o usuário definiu.
  if (field.type === "select" || field.type === "status" || field.type === "multi_select") {
    const order = (field.config?.options || []).map((o) => o.id);
    const sorted = [];
    for (const id of order) if (buckets.has(id)) sorted.push(buckets.get(id));
    if (buckets.has("__empty__")) sorted.push(buckets.get("__empty__"));
    return sorted;
  }
  return [...buckets.values()];
}

export const VIEW_TYPES = {
  table:   { label: "Tabela",     icon: "▦" },
  board:   { label: "Quadro",     icon: "▤" },
  list:    { label: "Lista",      icon: "☰" },
  gallery: { label: "Galeria",    icon: "▩" },
};

export function isViewType(type) {
  return Object.prototype.hasOwnProperty.call(VIEW_TYPES, type);
}
