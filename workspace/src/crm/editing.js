/**
 * Edição de campos do CRM, compartilhada entre a tabela e a pasta do
 * contato.
 *
 * As duas telas mostram o mesmo dado e precisam gravar do mesmo jeito:
 * otimista, com reversão se o CRM recusar. Duplicar isso daria duas
 * políticas de conflito diferentes para o mesmo campo — que é exatamente
 * o tipo de divergência que o usuário percebe primeiro.
 *
 * O que NÃO está aqui é o desenho da célula: quem chama passa o elemento
 * e a função de repintar, porque a tabela repinta a grade inteira e o
 * painel repinta só a linha.
 */
import { api } from "../api.js";
import { openMenu } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { isWritable } from "../shared/crm.js";

export { isWritable };

/** Mover exige estágio E pipeline; os outros campos têm gravação direta. */
export function isMoveField(kind, key) {
  return kind === "opportunities" && (key === "stage" || key === "pipeline");
}

/**
 * Dropdown de estágios com a hierarquia visível: cada pipeline vira uma
 * seção do menu e os estágios dela aparecem embaixo. Assim dá para mover
 * dentro da pipeline ou para outra sem trocar de tela.
 */
export function openStageMenu(anchor, record, pipelines, onPick) {
  if (!pipelines?.length) {
    toast("Não foi possível carregar os estágios.", { tone: "warn" });
    return;
  }
  const items = [];
  for (const pipe of pipelines) {
    for (const stage of pipe.stages || []) {
      items.push({
        id: `${pipe.id}:${stage.id}`,
        label: stage.name,
        icon: stage.id === record.stageId ? "✓" : " ",
        section: pipe.name,
        disabled: stage.id === record.stageId,
      });
    }
  }
  openMenu({
    anchor,
    width: 300,
    items,
    onSelect: (id) => {
      const corte = id.indexOf(":");
      onPick(id.slice(0, corte), id.slice(corte + 1));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Movimentos recentes                                                */
/* ------------------------------------------------------------------ */

/**
 * O que movemos nesta sessão, por oportunidade.
 *
 * Existe porque o CRM tem duas leituras que discordam: o PUT grava e o
 * `GET /opportunities/:id` já devolve o estágio novo, mas a busca
 * (`/opportunities/search`), que é de onde saem as listas, leva mais de
 * um minuto para enxergar a mudança — medido nesta conta.
 *
 * Sem isto, mover e clicar em "Atualizar" traz o estágio ANTIGO de
 * volta: a pessoa vê a alteração se desfazer sozinha e conclui, com
 * razão, que o app não gravou. Guardamos o que gravamos e reaplicamos
 * por cima da lista até a busca alcançar.
 */
const CHAVE = "workspace:crmMovimentos";

/** Depois disso, se a busca ainda discorda, o certo é ela: nós é que
 *  estamos vendo um estado que alguém alterou por fora. */
const VALIDADE_MS = 15 * 60 * 1000;

/**
 * Em localStorage, e não só em memória: recarregar a página logo depois
 * de mover é justamente quando a pessoa vai conferir se gravou, e é o
 * momento em que a busca do CRM ainda devolve o valor antigo.
 */
const movimentos = carregar();

function carregar() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(CHAVE) || "{}")));
  } catch {
    return new Map();
  }
}

function persistir() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(Object.fromEntries(movimentos)));
  } catch { /* storage bloqueado: vale só nesta aba, que já é o essencial */ }
}

function lembrarMovimento(externalId, dados) {
  movimentos.set(externalId, { em: Date.now(), ...dados });
  persistir();
}

/** Só para os testes: registrar um movimento sem passar pelo CRM. */
export { lembrarMovimento as __lembrarMovimento };

/**
 * Reaplica os movimentos recentes sobre os registros recém-carregados.
 * Devolve os mesmos objetos, alterados no lugar — quem chama já montou
 * a lista em cima deles.
 */
export function aplicarMovimentosRecentes(records = []) {
  const agora = Date.now();
  let mudou = false;
  for (const [id, mov] of movimentos) {
    if (agora - mov.em > VALIDADE_MS) { movimentos.delete(id); mudou = true; continue; }
    const record = records.find((r) => r.externalId === id);
    if (!record) continue;
    // A busca alcançou: o registro do movimento deixa de ter função e
    // sair daqui é o que permite que uma alteração feita no CRM por
    // outra pessoa volte a aparecer.
    if (record.stageId === mov.stageId) { movimentos.delete(id); mudou = true; continue; }
    record.pipelineId = mov.pipelineId;
    record.stageId = mov.stageId;
    record.properties = {
      ...record.properties,
      pipeline: mov.pipelineName,
      stage: mov.stageName,
    };
  }
  if (mudou) persistir();
  return records;
}

/** Só para os testes: a memória não pode vazar de um caso para o outro. */
export function __limparMovimentos() { movimentos.clear(); persistir(); }

function mensagemDeErro(err) {
  if (err?.code === "missing_scope") {
    return "O token não tem permissão para gravar neste campo.";
  }
  if (err?.code === "invalid_token") {
    return "O token de acesso ao CRM expirou. Nada foi alterado.";
  }
  return "O CRM recusou a alteração. O valor anterior foi mantido.";
}

/**
 * Grava um campo, aplicando na tela antes da resposta.
 *
 * Otimista porque a alternativa — travar a célula até o CRM responder —
 * custa quase um segundo por edição e faz a tabela parecer quebrada. O
 * preço é ter que desfazer, e é isso que o `anterior` guarda.
 */
export async function commitField({ kind, record, field, value, repaint }) {
  const chave = field.key;
  const anterior = field.is_primary
    ? record.title
    : record.properties?.[chave];
  if (iguais(anterior, value)) return false;

  aplicar(record, field, value);
  repaint();

  try {
    const changes = { [field.is_primary ? "name" : chave]: value };
    if (kind === "opportunities") {
      await api.crm.updateOpportunity(record.externalId, changes);
    } else {
      await api.crm.updateContact(record.externalId, changes);
    }
    toast(`${field.name} atualizado.`, { tone: "success" });
    return true;
  } catch (err) {
    aplicar(record, field, anterior);
    repaint();
    toast(mensagemDeErro(err), { tone: "danger" });
    return false;
  }
}

/** Move a oportunidade de estágio (e de pipeline, se for o caso). */
export async function commitMove({ record, pipelines, pipelineId, stageId, repaint }) {
  const anterior = {
    pipelineId: record.pipelineId,
    stageId: record.stageId,
    properties: { ...record.properties },
  };
  const pipe = pipelines.find((p) => p.id === pipelineId);
  const stage = (pipe?.stages || []).find((s) => s.id === stageId);

  record.pipelineId = pipelineId;
  record.stageId = stageId;
  record.properties = {
    ...record.properties,
    pipeline: pipe?.name || "",
    stage: stage?.name || "",
  };
  repaint();

  try {
    await api.crm.moveStage(record.externalId, pipelineId, stageId);
    lembrarMovimento(record.externalId, {
      pipelineId, stageId,
      pipelineName: pipe?.name || "",
      stageName: stage?.name || "",
    });
    toast(`Movido para "${stage?.name}".`, { tone: "success" });
    return true;
  } catch (err) {
    record.pipelineId = anterior.pipelineId;
    record.stageId = anterior.stageId;
    record.properties = anterior.properties;
    repaint();
    toast(err?.code === "missing_scope"
      ? "O token não tem permissão para mover oportunidades."
      : "Não foi possível mover. Nada foi alterado.", { tone: "danger" });
    return false;
  }
}

/**
 * O nome do contato é o título do registro, não uma propriedade — a
 * mesma regra da coluna primária das tabelas nativas.
 */
function aplicar(record, field, value) {
  if (field.is_primary) record.title = value ?? "";
  else record.properties = { ...record.properties, [field.key]: value };
}

function iguais(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  // null, undefined e "" são o mesmo "vazio" vindo do CRM: tratar como
  // diferentes faria toda célula vazia disparar um PUT ao ser aberta.
  const vazio = (v) => v === null || v === undefined || v === "";
  if (vazio(a) && vazio(b)) return true;
  return a === b;
}
