/**
 * Status do caso para o cliente.
 *
 * O portal traduz o estágio interno da pipeline numa frase que o cliente
 * entende, no idioma dele. A clientela dela é brasileira e latina — o
 * campo Idioma diz PT, inglês ou espanhol, e a página sai nele.
 *
 * O mapa é por CATEGORIA, não por nome exato de estágio: as pipelines de
 * serviço compartilham o mesmo fluxo, e um estágio novo que caia no
 * padrão já ganha a frase certa.
 */

const CATEGORIAS = [
  { id: "recebido",    match: /new request|triage|quote|novo|new lead|prospect|solicita/i, acao: false },
  { id: "documentos",  match: /waiting documents|aguardando documento/i,                     acao: true  },
  { id: "processando", match: /in process|processing|em análise|underwriting|making|illustration|booked|application|renova/i, acao: false },
  { id: "terceiro",    match: /waiting third party|aguardando terceiro/i,                    acao: false },
  { id: "pronto",      match: /ready for delivery|policy delivery|pronto|retirada/i,         acao: true  },
  { id: "concluido",   match: /delivered|paid|active client|renovada|renewed|completed|closed|entregue|conclu/i, acao: false },
];

const FRASES = {
  recebido: {
    pt: "Recebemos seu pedido", en: "We received your request", es: "Recibimos su solicitud",
  },
  documentos: {
    pt: "Aguardando seus documentos", en: "Waiting for your documents", es: "Esperando sus documentos",
  },
  processando: {
    pt: "Em andamento", en: "In progress", es: "En proceso",
  },
  terceiro: {
    pt: "Aguardando órgão externo (consulado, DMV, corte)",
    en: "Waiting on an outside office (consulate, DMV, court)",
    es: "Esperando a una oficina externa (consulado, DMV, corte)",
  },
  pronto: {
    pt: "Pronto para retirada", en: "Ready for pickup", es: "Listo para retirar",
  },
  concluido: {
    pt: "Concluído", en: "Completed", es: "Completado",
  },
};

/** Rótulos fixos da página, por idioma. */
const CHROME = {
  titulo:      { pt: "Acompanhamento", en: "Status", es: "Seguimiento" },
  subtitulo:   { pt: "O andamento dos seus serviços", en: "The status of your services", es: "El estado de sus servicios" },
  servicos:    { pt: "Seus serviços", en: "Your services", es: "Sus servicios" },
  faltam:      { pt: "Documentos que faltam", en: "Documents still needed", es: "Documentos que faltan" },
  semServico:  { pt: "Nenhum serviço em andamento no momento.", en: "No active services at the moment.", es: "Ningún servicio activo en este momento." },
  acaoCliente: { pt: "Precisa de você", en: "Needs your action", es: "Necesita su acción" },
  rodape:      { pt: "Atualizado automaticamente. Em caso de dúvida, fale com a gente.",
                 en: "Updated automatically. If you have questions, contact us.",
                 es: "Actualizado automáticamente. Si tiene dudas, contáctenos." },
};

/**
 * O idioma do cliente a partir do campo Idioma (PT por padrão).
 *
 * O campo é um dropdown, então o valor é o RÓTULO que a conta escolheu —
 * "Português", "Portugues", "PT", "pt-BR", "Español", "English"…
 *
 * A ordem e o casamento aqui não são acidentais: comparar código curto por
 * substring quebrava feio. "portugues" (sem acento) termina em "es" e caía
 * em espanhol — um cliente brasileiro receberia a página em espanhol sem
 * ninguém perceber. Por isso o código curto é comparado inteiro, e o nome
 * por extenso testa português primeiro.
 */
export function idiomaDoCliente(valor) {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return "pt";

  // Código curto: "pt", "pt-BR", "es_MX", "en (US)" — só o primeiro pedaço.
  const codigo = v.split(/[-_\s/(]/)[0];
  if (["pt", "por", "ptbr"].includes(codigo)) return "pt";
  if (["en", "eng"].includes(codigo)) return "en";
  if (["es", "esp", "spa"].includes(codigo)) return "es";

  // Nome por extenso.
  if (/portug/.test(v)) return "pt";
  if (/ingl|english/.test(v)) return "en";
  if (/espan|españ|spanish|castell/.test(v)) return "es";
  return "pt";
}

export function traduzir(chave, lang = "pt") {
  return CHROME[chave]?.[lang] || CHROME[chave]?.pt || chave;
}

/** A categoria de status de um estágio. */
export function categoriaDoEstagio(nome) {
  const alvo = String(nome || "");
  const cat = CATEGORIAS.find((c) => c.match.test(alvo));
  return cat || CATEGORIAS[2]; // fallback: "em andamento"
}

/** A frase de status de um caso, no idioma do cliente. */
export function statusDoCaso(stageName, lang = "pt") {
  const cat = categoriaDoEstagio(stageName);
  return {
    id: cat.id,
    titulo: FRASES[cat.id]?.[lang] || FRASES[cat.id]?.pt || "",
    acaoCliente: cat.acao,
  };
}
