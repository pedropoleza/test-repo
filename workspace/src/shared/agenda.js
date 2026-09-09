/**
 * Agenda operacional — o planejador da semana do escritório.
 *
 * Não é um calendário de agendamentos (isso o GHL já faz). É a outra
 * pergunta, a que ninguém responde num lugar só: "o que eu preciso
 * entregar/cobrar, e o que está travado agora?". Junta três fontes que
 * hoje vivem separadas:
 *
 *   • Renovações  — datas de vencimento vindas dos custom fields.
 *   • Tarefas     — do Spark Tasks, as que têm prazo e ainda estão abertas.
 *   • Parados     — casos no Aguardando (esperando cliente ou terceiro).
 *
 * As duas primeiras têm data e caem num dia da semana. As paradas não têm
 * data — são um backlog que fica de pé até destravar, por isso ficam num
 * trilho próprio, "parados agora", e não numa casa do calendário.
 *
 * Horizonte de semana, de propósito: o radar de vencimentos cobre o
 * futuro distante; a agenda é o curto prazo — esta semana e o atrasado.
 * Tudo em UTC de calendário, sem a hora empurrar para a véspera. A semana
 * começa na segunda (semana de trabalho).
 */

/** Normaliza uma data (ISO ou Date) para a chave YYYY-MM-DD em UTC. */
export function chaveDia(data) {
  if (!data) return null;
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** A segunda-feira (UTC, 00:00) da semana que contém `date`. */
export function inicioDaSemana(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0=dom … 6=sáb. Recuo até a segunda: dom recua 6, seg 0, ter 1…
  const recuo = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - recuo);
  return d;
}

/** A segunda-feira da semana seguinte / anterior. */
export function semanaSeguinte(inicio) {
  const d = new Date(inicio); d.setUTCDate(d.getUTCDate() + 7); return d;
}
export function semanaAnterior(inicio) {
  const d = new Date(inicio); d.setUTCDate(d.getUTCDate() - 7); return d;
}

/**
 * Os 7 dias da semana a partir da segunda `inicio`. Cada célula é
 * `{ iso, rotulo, fimDeSemana }` — `rotulo` já é "Seg 15", pronto para o
 * cabeçalho da coluna.
 */
export function diasDaSemana(inicio) {
  const dias = [];
  const cur = new Date(inicio);
  for (let i = 0; i < 7; i++) {
    const dow = cur.getUTCDay();
    dias.push({
      iso: chaveDia(cur),
      rotulo: `${DOW[dow]} ${cur.getUTCDate()}`,
      fimDeSemana: dow === 0 || dow === 6,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dias;
}

/** "15 set – 21 set 2026" — o rótulo do cabeçalho da semana. */
export function rotuloSemana(inicio) {
  const fim = new Date(inicio); fim.setUTCDate(fim.getUTCDate() + 6);
  const ra = `${inicio.getUTCDate()} ${MES_CURTO[inicio.getUTCMonth()]}`;
  const rb = `${fim.getUTCDate()} ${MES_CURTO[fim.getUTCMonth()]}`;
  return `${ra} – ${rb} ${fim.getUTCFullYear()}`;
}

// Renovação antes de tarefa dentro do mesmo dia; depois, por título.
function ordenaItem(a, b) {
  if (a.tipo !== b.tipo) return a.tipo === "renovacao" ? -1 : 1;
  return (a.titulo || "").localeCompare(b.titulo || "");
}

/**
 * Monta a agenda para a semana de `inicioSemana`.
 *
 * `datados` são itens já normalizados `{ tipo, iso, titulo, ... }`
 * (renovações e tarefas com prazo). `parados` são os casos do Aguardando,
 * sem data. Devolve:
 *
 *   • dias      — os 7 dias, cada um com `itens` daquele dia e `hoje`.
 *   • atrasados — itens datados com data anterior a hoje (backlog vencido),
 *                 do mais antigo ao mais recente. Sempre relativo ao hoje
 *                 real, não à semana navegada: é dívida que não some ao
 *                 virar a página.
 *   • parados   — os casos parados, do que espera há mais tempo ao que
 *                 espera há menos.
 *
 * Itens datados depois da semana não entram nesta janela — o radar de
 * vencimentos é o lugar do futuro distante.
 */
export function montarAgenda({ datados = [], parados = [], inicioSemana, agora = new Date() }) {
  const hojeIso = chaveDia(agora);
  const dias = diasDaSemana(inicioSemana).map((d) => ({ ...d, hoje: d.iso === hojeIso, itens: [] }));
  const porIso = new Map(dias.map((d) => [d.iso, d]));

  const atrasados = [];
  for (const item of datados) {
    if (!item.iso) continue;
    if (item.iso < hojeIso) { atrasados.push(item); continue; }
    const cel = porIso.get(item.iso);
    if (cel) cel.itens.push(item);
  }
  atrasados.sort((a, b) => a.iso.localeCompare(b.iso) || ordenaItem(a, b));
  for (const d of dias) d.itens.sort(ordenaItem);

  const paradosOrd = [...parados].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));

  const totalSemana = dias.reduce((n, d) => n + d.itens.length, 0);
  return {
    dias, atrasados, parados: paradosOrd,
    totalSemana, totalAtrasados: atrasados.length, totalParados: paradosOrd.length,
  };
}
