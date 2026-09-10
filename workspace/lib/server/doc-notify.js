/**
 * Aviso de documento assinado.
 *
 * Quando o cliente aprova, a equipe precisa saber na hora — e no lugar
 * onde ela já trabalha. Três canais, nesta ordem de confiabilidade:
 *
 *   1. Nota no contato do GHL  — o registro permanente do que aconteceu
 *   2. Tarefa no contato       — alguém precisa conferir e dar sequência
 *   3. WhatsApp para a equipe  — o empurrão imediato (quando conectado)
 *
 * Tudo é best-effort: um canal fora do ar não pode desfazer uma
 * assinatura que já é válida. O que falhou é registrado no log e volta no
 * resumo, para o painel poder mostrar "assinado, mas não avisei por X".
 */
import { criarNotaNoContato, criarTarefaNoContato, enviarMensagem } from "./ghl.js";
import { log } from "./log.js";

/**
 * O número/contato interno que recebe o aviso por WhatsApp. Fica em env
 * porque é config da conta, não do código — e enquanto o WhatsApp não
 * estiver conectado, basta não definir para o canal ficar quieto.
 */
const CONTATO_EQUIPE = process.env.EQUIPE_WHATSAPP_CONTACT_ID || "";

function resumo(documento, assinante, quando) {
  const data = new Date(quando).toISOString().replace("T", " ").slice(0, 16);
  return `${documento} assinado por ${assinante} em ${data} UTC.`;
}

/**
 * Avisa por todos os canais. Devolve `{ nota, tarefa, whatsapp }` com
 * true/false por canal — nunca lança.
 */
export async function avisarAssinatura({
  contactId, documento = "Documento", assinante = "", assinadoEm = new Date(),
  urlArquivo = "",
} = {}) {
  const linha = resumo(documento, assinante, assinadoEm);
  const corpo = urlArquivo ? `${linha}\nArquivo: ${urlArquivo}` : linha;
  const saida = { nota: false, tarefa: false, whatsapp: false };

  await Promise.all([
    criarNotaNoContato(contactId, `✅ ${corpo}`)
      .then(() => { saida.nota = true; })
      .catch((err) => log.warn("doc.notify.nota_falhou", { detail: err?.message })),

    criarTarefaNoContato(contactId, {
      titulo: `Conferir: ${documento}`,
      corpo,
    })
      .then(() => { saida.tarefa = true; })
      .catch((err) => log.warn("doc.notify.tarefa_falhou", { detail: err?.message })),

    // Sem contato de equipe configurado, o canal simplesmente não existe
    // ainda — não é falha, é WhatsApp não conectado.
    CONTATO_EQUIPE
      ? enviarMensagem(CONTATO_EQUIPE, { texto: `📄 ${corpo}` })
        .then(() => { saida.whatsapp = true; })
        .catch((err) => log.warn("doc.notify.whatsapp_falhou", { detail: err?.message }))
      : Promise.resolve(),
  ]);

  log.info("doc.notify.enviado", { contactId, ...saida });
  return saida;
}
