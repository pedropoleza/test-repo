/**
 * Helper único para verificar CRON_SECRET em endpoints administrativos.
 * Constant-time compare, retorna boolean.
 */
import { timingSafeEqual } from "node:crypto";

export function checkCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"];
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isVercelCron(req) {
  return !!req.headers["x-vercel-cron"];
}
