/**
 * POST /api/webhooks/opportunity-cotacao
 *
 * Called by a GHL workflow when an opportunity enters the quoting stage
 * (pipeline "1- Prospects" / "Informações de Cotações - Soraya para Julia").
 * Creates a ready-to-fill "Cotação" task for the opportunity's contact. Auth
 * via a shared secret in the `X-Webhook-Secret` header or a `?key=` query param.
 *
 * Body is tolerant of GHL merge-field shapes, e.g.:
 *   { "locationId": "{{location.id}}", "opportunityId": "{{opportunity.id}}",
 *     "contactId": "{{contact.id}}", "name": "{{contact.name}}",
 *     "assignedTo": "{{opportunity.assigned_to}}",
 *     "pipeline": "{{opportunity.pipeline_name}}",
 *     "stage": "{{opportunity.pipeline_stage}}" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createCotacaoTaskFromOpp } from "~/server/ghl/opportunity-cotacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.COTACAO_OPP_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-webhook-secret");
  const key = req.nextUrl.searchParams.get("key");
  return header === secret || key === secret;
}

/** First non-empty string among the given keys (case-insensitive). */
function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  const lower = new Map(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const nested = (k: string): Record<string, unknown> =>
    body[k] && typeof body[k] === "object"
      ? (body[k] as Record<string, unknown>)
      : {};
  const location = nested("location");
  const contact = nested("contact");
  const opportunity = nested("opportunity");

  const locationId =
    pick(body, ["locationId", "location_id"]) || pick(location, ["id"]);
  const opportunityId =
    pick(body, ["opportunityId", "opportunity_id", "id"]) ||
    pick(opportunity, ["id"]);
  const contactId =
    pick(body, ["contactId", "contact_id"]) || pick(contact, ["id"]);
  const name =
    pick(body, ["name", "full_name", "fullName", "contactName", "contact_name"]) ||
    pick(contact, ["name", "fullName", "full_name"]) ||
    [
      pick(body, ["first_name", "firstName"]) ?? "",
      pick(body, ["last_name", "lastName"]) ?? "",
    ]
      .join(" ")
      .trim() ||
    null;
  const assignedTo =
    pick(body, [
      "assignedTo",
      "assigned_to",
      "assignedUserId",
      "userId",
      "user_id",
      "ownerId",
    ]) || pick(opportunity, ["assignedTo", "assigned_to"]);
  const pipeline = pick(body, [
    "pipeline",
    "pipelineName",
    "pipeline_name",
    "pipelineId",
    "pipeline_id",
  ]);
  const stage = pick(body, [
    "stage",
    "stageName",
    "stage_name",
    "pipelineStage",
    "pipeline_stage",
    "pipelineStageId",
    "pipeline_stage_id",
    "stageId",
    "stage_id",
  ]);

  // Client data (GHL resolves these merge fields before sending).
  const clienteEstado = pick(contact, ["clienteEstado", "cliente_estado"]) ||
    pick(body, ["clienteEstado", "cliente_estado", "clienteestado", "state"]);
  const dateOfBirth = pick(body, [
    "dateOfBirth",
    "date_of_birth",
    "nascimento",
    "birthDate",
  ]) || pick(contact, ["date_of_birth", "dateOfBirth"]);
  const fumante = pick(body, ["fumante", "smoker"]) || pick(contact, ["fumante"]);
  const indicacao = pick(body, ["indicacao", "indicao", "indicação", "referral"]) ||
    pick(contact, ["indicao", "indicacao"]);
  const estadoCivil =
    pick(body, ["estadoCivil", "estado_civil", "maritalStatus"]) ||
    pick(contact, ["estado_civil", "estadoCivil"]);
  const conjuge =
    pick(body, [
      "conjuge",
      "cnjuge",
      "conjugeInfo",
      "informacoesDoConjuge",
      "informaes_do_cnjuge",
      "informacoes_do_conjuge",
      "spouse",
    ]) || pick(contact, ["informaes_do_cnjuge", "informacoes_do_conjuge"]);
  const medicamentos =
    pick(body, [
      "medicamentos",
      "usoDeMedicamentos",
      "uso_de_medicamentos",
      "medications",
    ]) || pick(contact, ["uso_de_medicamentos"]);
  const cotacaoDate = pick(body, [
    "cotacaoDate",
    "dataDaCotacao",
    "data_da_cotacao",
    "quoteDate",
    "date",
  ]);
  const note = pick(body, ["note", "body", "description", "taskBody"]);

  if (!locationId) {
    return NextResponse.json({ error: "missing_location" }, { status: 400 });
  }

  try {
    const res = await createCotacaoTaskFromOpp({
      locationId,
      opportunityId,
      contactId,
      name,
      assignedTo,
      pipeline,
      stage,
      clienteEstado,
      dateOfBirth,
      fumante,
      indicacao,
      estadoCivil,
      conjuge,
      medicamentos,
      cotacaoDate,
      note,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    console.error(
      `[opportunity-cotacao] failed: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
