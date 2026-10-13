/**
 * "Importar oportunidades do CRM": encher o funil com o que já existe.
 *
 * Mostra o retrato antes de criar — quantas, de quais pipelines, e
 * quantas não encontraram coluna. Criar duzentos cards de uma vez é
 * uma ação que ninguém quer descobrir depois de feita, e desfazer
 * significaria apagar card por card.
 *
 * Diz, na própria tela, que é CÓPIA. Quem não souber disso vai mover um
 * card aqui esperando que o CRM saiba — e descobrir que não dias depois.
 */
import { api } from "../api.js";
import { openModal } from "../ui/menu.js";
import { toast } from "../ui/toast.js";
import { campoDeColunas } from "../shared/board-db.js";
import { mapearOportunidades, resumoPorPipeline } from "../shared/crm-mirror.js";

/** Abre o importador. Resolve `true` se criou alguma ficha. */
export async function importarOportunidades({ databaseId, bundle, view }) {
  const campoEtapa = campoDeColunas(bundle.fields, view?.group_by);
  if (!campoEtapa) {
    toast("Este quadro ainda não tem um campo de etapas.", { tone: "danger" });
    return false;
  }

  let oportunidades = [];
  let contatos = [];
  try {
    const [o, c] = await Promise.all([
      api.crm.opportunities(500),
      api.crm.contacts(500).catch(() => ({ records: [] })),
    ]);
    oportunidades = o.records || [];
    contatos = c.records || [];
  } catch {
    toast("Não foi possível ler as oportunidades do CRM.", { tone: "danger" });
    return false;
  }

  const jaImportados = bundle.records
    .map((r) => r.source_external_id)
    .filter(Boolean);

  const { fichas, semEtapa, jaExistiam } = mapearOportunidades(oportunidades, {
    campoEtapa, campos: bundle.fields, contatos, jaImportados,
  });

  if (!fichas.length) {
    toast(jaExistiam
      ? "Todas as oportunidades do CRM já estão neste quadro."
      : "Nenhuma oportunidade encontrada no CRM.", { tone: "info" });
    return false;
  }

  return openModal({
    title: "Importar oportunidades do CRM",
    width: 520,
    render: (body, close) => {
      const stack = document.createElement("div");
      stack.className = "ws-stack";

      const resumo = document.createElement("p");
      resumo.innerHTML = "";
      resumo.textContent = `${fichas.length} oportunidade${fichas.length === 1 ? "" : "s"} `
        + `vão virar ficha${fichas.length === 1 ? "" : "s"} neste quadro.`;
      stack.appendChild(resumo);

      const lista = document.createElement("div");
      lista.className = "ws-import__lista";
      for (const linha of resumoPorPipeline(fichas)) {
        const item = document.createElement("div");
        item.className = "ws-import__item ws-import__item--leitura";
        const nome = document.createElement("span");
        nome.className = "ws-import__nome";
        nome.textContent = linha.nome;
        const total = document.createElement("span");
        total.className = "ws-import__tipo";
        total.textContent = `${linha.total}`;
        item.append(nome, total);
        lista.appendChild(item);
      }
      stack.appendChild(lista);

      const avisos = document.createElement("ul");
      avisos.className = "ws-import__avisos";
      const aviso = (texto) => {
        const li = document.createElement("li");
        li.textContent = texto;
        avisos.appendChild(li);
      };
      // O recado mais importante primeiro: isto é cópia.
      aviso("É uma cópia. Mover um card aqui não muda o estágio no CRM.");
      if (semEtapa) {
        aviso(`${semEtapa} não encontraram coluna equivalente e entram em `
          + `"Sem ${campoEtapa.name.toLowerCase()}", para você realocar.`);
      }
      if (jaExistiam) {
        aviso(`${jaExistiam} já tinham sido importadas antes e ficam de fora.`);
      }
      stack.appendChild(avisos);

      const acoes = document.createElement("div");
      acoes.className = "ws-modal__actions";
      const cancelar = document.createElement("button");
      cancelar.type = "button";
      cancelar.className = "ws-btn ws-btn--ghost";
      cancelar.textContent = "Cancelar";
      cancelar.addEventListener("click", () => close(false));

      const criar = document.createElement("button");
      criar.type = "button";
      criar.className = "ws-btn ws-btn--primary";
      criar.textContent = `Importar ${fichas.length}`;
      criar.addEventListener("click", async () => {
        criar.disabled = true;
        cancelar.disabled = true;
        let feitas = 0;
        for (const ficha of fichas) {
          criar.textContent = `Importando ${feitas + 1} de ${fichas.length}…`;
          try {
            await api.databases.createRecord(databaseId, {
              title: ficha.title,
              properties: ficha.properties,
              source: "ghl_opportunity",
              sourceExternalId: ficha.sourceExternalId,
            });
            feitas += 1;
          } catch { /* uma recusada não aborta as outras */ }
        }
        toast(feitas === fichas.length
          ? `${feitas} ficha${feitas === 1 ? "" : "s"} importada${feitas === 1 ? "" : "s"}.`
          : `${feitas} de ${fichas.length} importadas.`,
        { tone: feitas ? "success" : "danger" });
        close(feitas > 0);
      });
      acoes.append(cancelar, criar);
      stack.appendChild(acoes);
      body.appendChild(stack);
    },
  }).then((v) => !!v);
}
