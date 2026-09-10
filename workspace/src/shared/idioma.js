/**
 * O idioma do contato — a chave que faz o resto sair certo sozinho.
 *
 * A clientela dela é brasileira e latina: uns leem português, outros
 * espanhol, outros inglês. Em vez de perguntar a cada envio, o idioma
 * sai do próprio contato (campo "Idioma"/"Language" do CRM) e decide:
 *
 *   • em que língua a página do documento e o portal de status abrem;
 *   • qual VARIANTE do PDF vai (o divórcio tem pt/en/es);
 *   • em que língua o lembrete de renovação é escrito.
 *
 * Importante: só o documento que TEM variante oficial troca de língua.
 * PO Box, LLC, Seguro e Master são documentos legais em inglês — traduzir
 * o texto jurídico atravessaria a linha do "NOT A LAW FIRM". O que muda
 * de língua é a interface em volta, não o contrato.
 */
import { idiomaDoCliente } from "./client-status.js";

/** Nomes de campo que costumam guardar o idioma do contato. */
const CAMPO_IDIOMA = /idioma|language|lang\b|lengua|idiom/i;

/**
 * O idioma do contato: 'pt' | 'en' | 'es'.
 *
 * Procura, em ordem: o campo personalizado de idioma do CRM, um campo
 * padrão do contato (locale/language) e, se nada disser, o padrão da
 * conta. Nunca devolve vazio — quem chama sempre tem uma língua.
 */
export function idiomaDoContato({ contact = {}, record = {}, columns = [] } = {}, padrao = "pt") {
  const props = record.properties || {};

  // 1) Campo personalizado com cara de idioma.
  const col = columns.find((c) => CAMPO_IDIOMA.test(c?.name || ""));
  if (col) {
    const bruto = props[col.key];
    if (bruto != null && String(bruto).trim() !== "") return idiomaDoCliente(bruto);
  }

  // 2) Campo padrão do contato.
  for (const chave of ["locale", "language", "idioma"]) {
    const bruto = contact[chave] ?? props[chave];
    if (bruto != null && String(bruto).trim() !== "") return idiomaDoCliente(bruto);
  }

  return idiomaDoCliente(padrao);
}

/**
 * O idioma em que o DOCUMENTO sai, dado o idioma do contato.
 *
 * Se o acordo tem variante oficial naquela língua, usa; senão devolve a
 * língua original dele (inglês, nos contratos americanos). É isto que
 * separa "traduzir a interface" de "traduzir o contrato".
 */
export function idiomaDoAcordo(acordo, idiomaContato) {
  const disponiveis = acordo?.idiomas || [];
  if (!disponiveis.length) return idiomaContato;
  return disponiveis.includes(idiomaContato) ? idiomaContato : disponiveis[0];
}

/** true quando o documento vai numa língua diferente da do contato. */
export function documentoEmOutraLingua(acordo, idiomaContato) {
  return idiomaDoAcordo(acordo, idiomaContato) !== idiomaContato;
}
