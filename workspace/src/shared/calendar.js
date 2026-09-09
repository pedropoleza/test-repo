/**
 * Visão de calendário — o mês em grade, como no Notion.
 *
 * O radar de vencimentos (upcoming.js) responde "o que vence primeiro".
 * O calendário responde a outra pergunta, espacial: "como está o meu mês?".
 * A mesma fonte de dados (os vencimentos dos contatos, cada um com uma
 * data), plotada no dia em que cai — para bater o olho e ver a semana
 * carregada, o feriado sem nada, o acúmulo no fim do mês.
 *
 * Tudo em UTC de calendário, sem a hora atrapalhar: um vencimento em
 * "2026-09-30" cai no dia 30, esteja o usuário em Miami ou em Brasília.
 * A semana começa no domingo — é o padrão do mercado dela (EUA).
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

/** O mês anterior a {ano, mes} (mes 0–11), virando o ano quando preciso. */
export function mesAnterior({ ano, mes }) {
  return mes === 0 ? { ano: ano - 1, mes: 11 } : { ano, mes: mes - 1 };
}

/** O mês seguinte a {ano, mes} (mes 0–11), virando o ano quando preciso. */
export function mesSeguinte({ ano, mes }) {
  return mes === 11 ? { ano: ano + 1, mes: 0 } : { ano, mes: mes + 1 };
}

/** O {ano, mes} de hoje (UTC). */
export function mesDeHoje(agora = new Date()) {
  return { ano: agora.getUTCFullYear(), mes: agora.getUTCMonth() };
}

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "Setembro 2026" — o rótulo do cabeçalho. */
export function rotuloMes({ ano, mes }) {
  return `${NOMES_MES[mes]} ${ano}`;
}

/** Domingo … Sábado, os cabeçalhos das colunas. */
export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * A grade do mês: sempre semanas completas de 7 dias, começando no
 * domingo. Os dias que sobram do mês vizinho entram como preenchimento
 * (`mesAtual: false`) para a grade não ficar com buracos — é assim que o
 * Notion e todo calendário desenham.
 *
 * Cada célula é `{ iso, dia, mesAtual }`. `iso` é a chave YYYY-MM-DD, que
 * casa com `chaveDia`, então plotar um item é só cruzar as duas.
 */
export function matrizDoMes({ ano, mes }) {
  const primeiro = new Date(Date.UTC(ano, mes, 1));
  // getUTCDay: 0 = domingo. Recua até o domingo que abre a grade.
  const inicio = new Date(primeiro);
  inicio.setUTCDate(1 - primeiro.getUTCDay());

  const semanas = [];
  const cursor = new Date(inicio);
  // Seis semanas cobrem qualquer mês (um mês de 31 dias que começa no
  // sábado ocupa seis linhas); paramos antes se a última semana já
  // passou do mês e não sobra nada de útil.
  for (let semana = 0; semana < 6; semana++) {
    const dias = [];
    for (let d = 0; d < 7; d++) {
      dias.push({
        iso: chaveDia(cursor),
        dia: cursor.getUTCDate(),
        mesAtual: cursor.getUTCMonth() === mes,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    semanas.push(dias);
    // Encerrou o mês e a próxima semana já é toda do mês seguinte: para.
    if (cursor.getUTCMonth() !== mes && cursor.getUTCFullYear() >= ano && semana >= 3) {
      const passouDoMes = (cursor.getUTCFullYear() > ano)
        || (cursor.getUTCMonth() > mes);
      if (passouDoMes) break;
    }
  }
  return semanas;
}

/**
 * Agrupa itens `{ ...algo, data }` pelo dia em que caem.
 *
 * Devolve um Map de `YYYY-MM-DD` → array de itens daquele dia, cada array
 * já ordenado por serviço para ficar estável na tela. Itens sem data (ou
 * com data inválida) ficam de fora — não têm onde pousar na grade.
 */
export function agruparPorDia(itens = []) {
  const mapa = new Map();
  for (const item of itens) {
    const chave = chaveDia(item.data);
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => {
      const sa = a.servico?.nome || "";
      const sb = b.servico?.nome || "";
      return sa.localeCompare(sb) || (a.nome || "").localeCompare(b.nome || "");
    });
  }
  return mapa;
}
