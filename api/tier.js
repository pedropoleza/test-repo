/**
 * GET /api/tier?locationId=...
 * Header: x-spark-session: <JWT>
 *
 * Retorna o payload no shape consumido pelo front (mesma forma do
 * resultado da função qualify()): nível atual, descontos, retorno
 * estimado, lista de indicações com status. O front substituiu o
 * import de sample-referrals.js por fetch a este endpoint quando a
 * Etapa 2 começar.
 *
 * Estado atual (skeleton): valida o JWT (se presente), mas retorna
 * uma resposta vazia/estável (qualifiedCount=0, level=none) até o
 * DATABASE_URL existir.
 */

import { verify as jwtVerify } from "../lib/server/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const locationId = req.query?.locationId;
  if (!locationId || typeof locationId !== "string") {
    return res.status(400).json({ error: "missing_locationId" });
  }

  // ====== ETAPA 1 — TODO: validar JWT do iframe ======
  // const token = req.headers["x-spark-session"];
  // try {
  //   const claims = jwtVerify(token);
  //   if (claims.locationId !== locationId) {
  //     return res.status(403).json({ error: "location_mismatch" });
  //   }
  // } catch (err) {
  //   return res.status(401).json({ error: "invalid_session" });
  // }

  // ====== ETAPA 2 — TODO: buscar referrals do DB ======
  // const referrals = await db.referrals.findMany({
  //   where: { indicador_location: locationId },
  //   orderBy: { created_at: "desc" },
  // });
  //
  // Mapear para o shape consumido pelo front:
  //   { name, subaccountAddedAt, couponIssued, cancelled?, refunded?, fraud? }
  //
  // Importante: a função qualify() em src/lib/qualify.js já calcula
  // status, daysUntilQualified, etc. Mantemos qualify() como única
  // fonte de verdade da regra — backend não precisa duplicar.

  // STUB: location nova / DB não conectado — devolve estado zero.
  return res.status(200).json({
    locationId,
    referrals: [],
    asOf: new Date().toISOString(),
    note: "stub_no_db",
  });
}
