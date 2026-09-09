/**
 * Home — a tela de partida.
 *
 * O app abre numa página qualquer ou numa tabela; a home dá um ponto de
 * chegada com os módulos à mão e o que foi mexido por último. Lê só o
 * que o boot já trouxe (módulos, listas, recentes) — abre na hora, sem
 * ir à rede.
 */
import { getState, pageById, subscribe } from "./store.js";
import { ehFichaDeContato, renderAvatar } from "./crm/photo.js";

export function createHomeView(host, handlers = {}) {
  host.className = "ws-home";
  render();

  // Alguns dados chegam depois do boot (o catálogo decide se
  // "Vencimentos" existe; as listas e os recentes carregam em paralelo).
  // A home se redesenha quando eles chegam — e só enquanto está montada,
  // para não reconstruir num host já trocado por outra tela.
  const parar = subscribe((_, reason) => {
    if (!host.isConnected) { parar(); return; }
    if (["catalog", "crm-lists", "tree", "recent", "bootstrap"].includes(reason)) render();
  });

  function render() {
    const s = getState();
    host.replaceChildren();

    host.appendChild(cabecalho());
    host.appendChild(secaoModulos(s));
    const listas = blocoListas(s);
    if (listas) host.appendChild(listas);
    const recentes = blocoRecentes(s);
    if (recentes) host.appendChild(recentes);
  }

  function cabecalho() {
    const head = document.createElement("header");
    head.className = "ws-home__head";
    const h = document.createElement("h1");
    h.className = "ws-home__title";
    h.textContent = "Início";
    const sub = document.createElement("p");
    sub.className = "ws-muted";
    sub.textContent = "Os módulos à mão e o que você mexeu por último.";
    head.append(h, sub);
    return head;
  }

  /* ---------------- módulos ---------------- */

  function secaoModulos(s) {
    const modulos = [
      { id: "contacts",      nome: "Leads",         icone: "👥", ds: "Os contatos da conta" },
      { id: "opportunities", nome: "Oportunidades", icone: "💰", ds: "Os casos em andamento" },
      { id: "renewals",      nome: "Renovações",    icone: "🔄", ds: "O que precisa renovar" },
    ];
    if (s.temRecorrentes) {
      modulos.push({ id: "vencimentos", nome: "Vencimentos", icone: "⏰", ds: "O que está para vencer" });
    }
    modulos.push({ id: "tasks", nome: "Tarefas", icone: "✓", ds: "As tarefas recebidas" });

    const bloco = document.createElement("section");
    bloco.className = "ws-home__section";
    bloco.appendChild(rotulo("Módulos"));

    const grade = document.createElement("div");
    grade.className = "ws-home__grid";
    for (const m of modulos) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ws-home__card";
      card.dataset.atual = s.crmView === m.id ? "sim" : "nao";
      const ic = document.createElement("span");
      ic.className = "ws-home__card-icon";
      ic.textContent = m.icone;
      const corpo = document.createElement("span");
      corpo.className = "ws-home__card-body";
      const nome = document.createElement("span");
      nome.className = "ws-home__card-name";
      nome.textContent = m.nome;
      const ds = document.createElement("span");
      ds.className = "ws-home__card-ds";
      ds.textContent = m.ds;
      corpo.append(nome, ds);
      card.append(ic, corpo);
      card.addEventListener("click", () => handlers.onOpenCrm?.(m.id));
      grade.appendChild(card);
    }
    bloco.appendChild(grade);
    return bloco;
  }

  /* ---------------- listas salvas ---------------- */

  function blocoListas(s) {
    const listas = s.crmLists || [];
    if (!listas.length) return null;

    const bloco = document.createElement("section");
    bloco.className = "ws-home__section";
    bloco.appendChild(rotulo("Listas"));

    // Agrupadas pelo mesmo grupo da navegação, mantendo a ordem.
    const grade = document.createElement("div");
    grade.className = "ws-home__chips";
    for (const lista of listas) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ws-home__chip";
      chip.textContent = `${lista.icon_value || "📋"} ${lista.name}`;
      if (lista.group_name) chip.title = lista.group_name;
      chip.addEventListener("click", () => handlers.onOpenCrmList?.(lista.id));
      grade.appendChild(chip);
    }
    bloco.appendChild(grade);
    return bloco;
  }

  /* ---------------- recentes ---------------- */

  function blocoRecentes(s) {
    // Resolve os recentes para páginas que ainda existem. Um recente que
    // aponta para página apagada não deve virar um card morto.
    const paginas = (s.recent || [])
      .filter((r) => (r.target_type || "page") === "page")
      .map((r) => pageById(r.target_id))
      .filter((p) => p && !p.is_archived)
      .slice(0, 8);
    if (!paginas.length) return null;

    const bloco = document.createElement("section");
    bloco.className = "ws-home__section";
    bloco.appendChild(rotulo("Continuar de onde parou"));

    const grade = document.createElement("div");
    grade.className = "ws-home__grid";
    for (const p of paginas) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ws-home__card ws-home__card--recent";

      const ic = document.createElement("span");
      ic.className = "ws-home__card-icon";
      // Ficha de contato mostra o rosto; página comum, o ícone ou 📄.
      if (ehFichaDeContato(p)) ic.appendChild(renderAvatar(p, { size: 30 }));
      else ic.textContent = iconeDaPagina(p);

      const corpo = document.createElement("span");
      corpo.className = "ws-home__card-body";
      const nome = document.createElement("span");
      nome.className = "ws-home__card-name";
      nome.textContent = p.title || "Sem título";
      corpo.appendChild(nome);

      card.append(ic, corpo);
      card.addEventListener("click", () => handlers.onOpenPage?.(p.id));
      grade.appendChild(card);
    }
    bloco.appendChild(grade);
    return bloco;
  }

  function iconeDaPagina(p) {
    if (p.icon_type === "emoji" && p.icon_value) return p.icon_value;
    return "📄";
  }

  function rotulo(texto) {
    const r = document.createElement("p");
    r.className = "ws-home__rotulo";
    r.textContent = texto;
    return r;
  }

  return { render };
}
