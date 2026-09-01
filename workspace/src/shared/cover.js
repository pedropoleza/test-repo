/**
 * Paleta das capas, compartilhada entre browser e servidor.
 *
 * Estava só no módulo de interface, que importa api.js e não roda no
 * servidor. O PDF da ficha reproduz a capa da página, e ler as cores de
 * outro lugar faria papel e tela divergirem na primeira mudança.
 *
 * Os gradientes são guardados como PARADAS, não como a string CSS: o
 * browser monta o linear-gradient a partir delas, e o PDF interpola as
 * mesmas cores — não há uma segunda definição para manter em dia.
 */

export const GRADIENT_STOPS = {
  "spark-blue": [["#155eef", 0], ["#4d89ff", 0.55], ["#b3cdff", 1]],
  midnight:     [["#0f1e3d", 0], ["#1a2a4a", 0.50], ["#2563eb", 1]],
  sunset:       [["#d97706", 0], ["#f59e0b", 0.45], ["#fbbf24", 1]],
  mint:         [["#047857", 0], ["#16a34a", 0.55], ["#86efac", 1]],
  plum:         [["#6d28d9", 0], ["#a855f7", 0.55], ["#f0abfc", 1]],
  slate:        [["#334155", 0], ["#64748b", 0.55], ["#cbd5e1", 1]],
  ember:        [["#9f1239", 0], ["#dc2626", 0.55], ["#fca5a5", 1]],
  sand:         [["#78716c", 0], ["#a8a29e", 0.55], ["#e7e5e4", 1]],
};

export const COLORS = {
  blue: "#155eef", navy: "#0f1e3d", green: "#16a34a", amber: "#d97706",
  red: "#dc2626", purple: "#7c3aed", slate: "#475569", gray: "#94a3b8",
};

/** A string CSS do gradiente, montada a partir das paradas. */
export function gradientCss(nome) {
  const paradas = GRADIENT_STOPS[nome] || GRADIENT_STOPS["spark-blue"];
  const lista = paradas.map(([cor, pos]) => `${cor} ${Math.round(pos * 100)}%`).join(", ");
  return `linear-gradient(120deg, ${lista})`;
}

export const GRADIENTS = Object.fromEntries(
  Object.keys(GRADIENT_STOPS).map((nome) => [nome, gradientCss(nome)]),
);

/** "#rrggbb" → { r, g, b } em 0..1, que é o que o PDF usa. */
export function hexToRgb(hex) {
  const limpo = String(hex || "").replace("#", "").trim();
  const cheio = limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  const n = Number.parseInt(cheio.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/** Cor do gradiente na posição t (0..1), interpolando entre as paradas. */
export function corDoGradiente(nome, t) {
  const paradas = GRADIENT_STOPS[nome] || GRADIENT_STOPS["spark-blue"];
  const p = Math.min(1, Math.max(0, t));

  for (let i = 0; i < paradas.length - 1; i += 1) {
    const [corA, posA] = paradas[i];
    const [corB, posB] = paradas[i + 1];
    if (p > posB && i < paradas.length - 2) continue;
    const span = posB - posA || 1;
    const k = Math.min(1, Math.max(0, (p - posA) / span));
    const a = hexToRgb(corA);
    const b = hexToRgb(corB);
    return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k };
  }
  return hexToRgb(paradas[paradas.length - 1][0]);
}
