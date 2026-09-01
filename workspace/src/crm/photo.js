/**
 * Foto do contato: um componente só, usado na capa, no painel da ficha e
 * na navegação.
 *
 * A foto É o ícone da página (`icon_type: 'url'`). Guardar em outro lugar
 * daria duas imagens para a mesma pessoa e a obrigação de mantê-las em
 * sincronia.
 *
 * Numa ficha de contato o lugar do ícone é sempre o rosto: com foto,
 * mostra a foto; sem foto, as iniciais do nome. Um 👤 genérico ocupava o
 * mesmo espaço sem dizer de quem era a ficha — e como toda ficha tinha o
 * mesmo, não dava para distinguir duas na navegação.
 */
import { openMenu } from "../ui/menu.js";
import { openPrompt } from "../ui/prompt.js";
import { toast } from "../ui/toast.js";
import { uploadFile, MAX_UPLOAD_BYTES } from "../cover.js";

const SOURCE_CONTATO = "ghl_contact";

/** A página é a ficha de um contato? */
export function ehFichaDeContato(page) {
  return !!page && page.source === SOURCE_CONTATO;
}

/** A foto da página, ou null quando ainda não há. */
export function fotoDa(page) {
  return page?.icon_type === "url" ? page.icon_value : null;
}

/**
 * Iniciais do nome. Primeira e última palavra — "Maria de Souza Lima"
 * vira MS, não MD, porque o sobrenome identifica mais que a preposição.
 */
export function iniciaisDe(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const primeira = partes[0][0] || "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  const iniciais = (primeira + ultima).toUpperCase();
  // Nome que é só telefone ou e-mail não tem inicial que sirva; o
  // símbolo genérico é melhor que "+1" ou "@G".
  return /[A-ZÀ-Ý]/.test(iniciais) ? iniciais : "•";
}

/**
 * O círculo com a foto ou as iniciais. `size` em px.
 * Só exibição — quem trata clique é `attachPhotoMenu`.
 */
export function renderAvatar(page, { size = 72 } = {}) {
  const foto = fotoDa(page);
  const box = document.createElement("span");
  box.className = `ws-avatar${foto ? " has-photo" : ""}`;
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;

  if (foto) {
    const img = document.createElement("img");
    img.src = foto;
    img.alt = "";
    img.loading = "lazy";
    box.appendChild(img);
    return box;
  }

  const iniciais = document.createElement("span");
  iniciais.className = "ws-avatar__initials";
  // As iniciais acompanham o círculo: fixas, sumiriam num avatar pequeno
  // e estourariam num grande.
  iniciais.style.fontSize = `${Math.round(size * 0.36)}px`;
  iniciais.textContent = iniciaisDe(page?.title);
  box.appendChild(iniciais);
  return box;
}

/**
 * Monta o botão completo: círculo + distintivo de editar + menu.
 * `onPick(url | null)` recebe a escolha; null = remover.
 *
 * O distintivo fica FORA do círculo: o `overflow: hidden` é o que mantém
 * a foto redonda, e dentro dele o ＋ aparecia cortado pela borda.
 */
export function renderPhotoControl(page, { size = 72, onPick, badge = true } = {}) {
  const foto = fotoDa(page);

  const wrap = document.createElement("div");
  wrap.className = "ws-avatar-wrap";

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "ws-avatar-btn";
  botao.title = foto ? "Trocar a foto" : "Adicionar uma foto";
  botao.setAttribute("aria-label", botao.title);
  botao.appendChild(renderAvatar(page, { size }));
  wrap.appendChild(botao);

  if (!onPick) {
    botao.disabled = true;
    botao.title = "";
    return wrap;
  }

  if (badge) {
    const marca = document.createElement("span");
    marca.className = "ws-avatar__edit";
    marca.textContent = foto ? "✎" : "＋";
    marca.setAttribute("aria-hidden", "true");
    wrap.appendChild(marca);
  }

  botao.addEventListener("click", () => openPhotoMenu(botao, foto, onPick));
  return wrap;
}

export function openPhotoMenu(anchor, foto, onPick) {
  openMenu({
    anchor,
    width: 240,
    items: [
      { id: "upload", label: "Enviar uma foto", icon: "🖼" },
      { id: "url", label: "Usar um endereço de imagem", icon: "🔗" },
      ...(foto ? [{ id: "remove", label: "Remover a foto", icon: "×", danger: true }] : []),
    ],
    onSelect: (id) => {
      if (id === "remove") return onPick(null);
      if (id === "url") return pedirUrl(onPick);
      return escolherArquivo(onPick);
    },
  });
}

function escolherArquivo(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast(`A imagem passa de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`, { tone: "warn" });
      return;
    }
    try {
      // uploadFile devolve a linha do arquivo: a URL pública está em
      // `public_url`. Ler `url` daqui dava undefined, e gravar undefined
      // APAGAVA a foto logo depois de enviá-la.
      const enviado = await uploadFile(file);
      if (!enviado?.public_url) throw new Error("upload sem url");
      onPick(enviado.public_url);
    } catch (err) {
      toast(err?.code === "storage_unavailable"
        ? "Storage indisponível. Verifique o bucket workspace-files."
        : "Não foi possível enviar a foto.", { tone: "danger" });
    }
  });
  input.click();
}

async function pedirUrl(onPick) {
  const url = await openPrompt({
    title: "Foto do contato",
    label: "Endereço da imagem",
    placeholder: "https://…",
    confirmLabel: "Usar esta imagem",
    validate: (texto) => (/^https?:\/\//i.test(texto)
      ? null
      : "O endereço precisa começar com http:// ou https://"),
  });
  if (url) onPick(url);
}

/** O patch de página que grava (ou apaga) a foto. */
export function patchDaFoto(url) {
  return { icon_type: url ? "url" : null, icon_value: url || null };
}
