/**
 * Client-side PDF export of a task.
 *
 * Builds a clean, printable document from whatever is currently filled in on
 * the task — title, type, properties, the structured Cotação fields, the note
 * (which holds the Proposta template) and the checklist — and triggers a
 * download. Runs entirely in the browser (jsPDF), so it works inside the GHL
 * iframe without a server round-trip. jsPDF is imported dynamically to keep it
 * out of the initial bundle.
 */

export type TaskPdfField = { label: string; type: string; value: string };

export type TaskPdfData = {
  title: string;
  typeLabel?: string | null;
  stageName?: string | null;
  priorityLabel?: string | null;
  dueDate?: string | null;
  labels?: string[];
  assignees?: string[];
  contactName?: string | null;
  customFields?: TaskPdfField[];
  note?: string | null;
  checklist?: { text: string; done: boolean }[];
};

function fieldValue(f: TaskPdfField): string {
  if (f.type === "boolean") {
    if (f.value === "sim") return "Sim";
    if (f.value === "nao") return "Não";
    return "—";
  }
  return f.value?.trim() ? f.value.trim() : "—";
}

function safeFilename(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "tarefa"}.pdf`;
}

export async function exportTaskPdf(data: TaskPdfData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  function ensure(space: number) {
    if (y + space > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function para(
    text: string,
    opts: { size?: number; style?: "normal" | "bold"; color?: number; gap?: number } = {},
  ) {
    const size = opts.size ?? 11;
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(size);
    doc.setTextColor(opts.color ?? 20);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    const lineH = size * 1.4;
    for (const line of lines) {
      ensure(lineH);
      doc.text(line, margin, y);
      y += lineH;
    }
    y += opts.gap ?? 0;
  }

  function sectionTitle(text: string) {
    y += 8;
    ensure(26);
    doc.setDrawColor(224);
    doc.line(margin, y - 2, pageW - margin, y - 2);
    y += 10;
    para(text.toUpperCase(), { size: 10, style: "bold", color: 120, gap: 4 });
  }

  function labelValue(label: string, value: string) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(90);
    const labelText = `${label}: `;
    const labelW = doc.getTextWidth(labelText);
    const valueLines = doc.splitTextToSize(value, contentW - labelW) as string[];
    const lineH = 11 * 1.45;
    ensure(lineH);
    doc.text(labelText, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20);
    doc.text(valueLines[0] ?? "", margin + labelW, y);
    y += lineH;
    for (let i = 1; i < valueLines.length; i++) {
      ensure(lineH);
      doc.text(valueLines[i]!, margin + labelW, y);
      y += lineH;
    }
  }

  // ---- Header ----
  para(data.title || "Tarefa", { size: 18, style: "bold", gap: 2 });
  const sub: string[] = [];
  if (data.typeLabel) sub.push(data.typeLabel);
  if (data.stageName) sub.push(data.stageName);
  if (data.priorityLabel && data.priorityLabel.toLowerCase() !== "none")
    sub.push(`Prioridade: ${data.priorityLabel}`);
  if (sub.length) para(sub.join("  ·  "), { size: 10.5, color: 120, gap: 2 });

  // ---- Properties ----
  const props: Array<[string, string]> = [];
  if (data.dueDate) props.push(["Vencimento", data.dueDate]);
  if (data.contactName && data.contactName !== "…")
    props.push(["Contato", data.contactName]);
  if (data.assignees && data.assignees.length)
    props.push(["Responsáveis", data.assignees.join(", ")]);
  if (data.labels && data.labels.length)
    props.push(["Etiquetas", data.labels.join(", ")]);
  if (props.length) {
    sectionTitle("Informações");
    for (const [k, v] of props) labelValue(k, v);
  }

  // ---- Structured fields (Cotação) ----
  if (data.customFields && data.customFields.length) {
    sectionTitle(data.typeLabel ? `Dados — ${data.typeLabel}` : "Campos");
    for (const f of data.customFields) labelValue(f.label, fieldValue(f));
  }

  // ---- Note / description (holds the Proposta template) ----
  if (data.note && data.note.trim()) {
    sectionTitle("Descrição");
    para(data.note.trim(), { size: 11, gap: 2 });
  }

  // ---- Checklist ----
  if (data.checklist && data.checklist.length) {
    sectionTitle("Checklist");
    for (const c of data.checklist) {
      para(`${c.done ? "[x]" : "[ ]"} ${c.text}`, { size: 11 });
    }
  }

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(150);
    doc.text(`Spark Tasks · ${stamp}`, margin, pageH - 24);
    doc.text(`${p}/${pages}`, pageW - margin, pageH - 24, { align: "right" });
  }

  doc.save(safeFilename(data.title));
}
