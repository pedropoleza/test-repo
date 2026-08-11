import { getBookedTimestamps, countInRange } from "~/server/ghl";
import { weekRange, METRICS_TZ } from "~/lib/time";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function Delta({ curr, prev }: { curr: number; prev: number }) {
  const diff = curr - prev;
  const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const sign = diff > 0 ? "+" : "";
  return (
    <>
      <span className={`delta ${cls}`}>
        {sign}
        {diff}
      </span>
      <span>vs. semana anterior ({prev})</span>
    </>
  );
}

export default async function Page() {
  const now = Date.now();
  const thisWeek = weekRange(0);
  const lastWeek = weekRange(1);

  let meetings: number | null = null;
  let meetingsPrev = 0;
  let error: string | null = null;
  try {
    const ts = await getBookedTimestamps(now);
    meetings = countInRange(ts, thisWeek.startMs, thisWeek.endMs);
    meetingsPrev = countInRange(ts, lastWeek.startMs, lastWeek.endMs);
  } catch (e) {
    error = e instanceof Error ? e.message : "erro desconhecido";
  }

  const updated = new Intl.DateTimeFormat("pt-BR", {
    timeZone: METRICS_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(now));

  return (
    <div className="wrap">
      <div className="head">
        <div>
          <h1>Soraia Close — Métricas</h1>
          <div className="sub">Prospecção &amp; reuniões · fuso {METRICS_TZ}</div>
        </div>
        <div className="pill">Atualizado {updated}</div>
      </div>

      <div className="grid">
        {/* New-people messages (v2) */}
        <div className="card">
          <div className="label">Mensagens · Novas pessoas</div>
          <div className="value pending">—</div>
          <div className="cadence">atualização diária</div>
          <div className="foot">
            <span className="soon">Em configuração</span>
          </div>
        </div>

        {/* Follow-up messages (v2) */}
        <div className="card green">
          <div className="label">Mensagens · Follow-ups</div>
          <div className="value pending">—</div>
          <div className="cadence">atualização diária</div>
          <div className="foot">
            <span className="soon">Em configuração</span>
          </div>
        </div>

        {/* Meetings booked this week (live) */}
        <div className="card violet">
          <div className="label">Reuniões marcadas</div>
          <div className="value">{meetings ?? "—"}</div>
          <div className="cadence">
            esta semana · {thisWeek.label} · atualização semanal
          </div>
          <div className="foot">
            {meetings !== null && <Delta curr={meetings} prev={meetingsPrev} />}
          </div>
        </div>
      </div>

      {error ? (
        <div className="err">Falha ao carregar reuniões: {error}</div>
      ) : (
        <div className="note">
          Reuniões contam agendamentos <b>criados nesta semana</b> (segunda a
          domingo), excluindo cancelados, em todos os calendários. As métricas de
          mensagens (novas pessoas e follow-ups, SMS + Instagram/Facebook) entram
          na próxima etapa, com atualização diária.
        </div>
      )}
    </div>
  );
}
