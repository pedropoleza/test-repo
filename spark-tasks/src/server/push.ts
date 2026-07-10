/**
 * Web Push sender — OS notifications that reach the user even when the
 * Spark Tasks module (or the whole browser tab) is closed. No extension:
 * this is the browser-native Service Worker + Push API stack.
 *
 * Silently disabled until the VAPID key pair is configured. Dead
 * subscriptions (404/410 from the push service) are pruned on send.
 */
import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { pushSubscriptions } from "~/server/db/schema";
import { env } from "~/env";

let configured = false;
function ensureConfigured(): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT ?? "mailto:info@sparkleads.pro",
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    configured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body?: string;
  /** Where a notification click should land (contact page, etc.). */
  url?: string;
  tag?: string;
};

export type PushSendResult = {
  configured: boolean;
  subscriptions: number;
  sent: number;
  pruned: number;
  errors: string[];
};

export async function sendPushToUser(
  locationId: string,
  userId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = {
    configured: ensureConfigured(),
    subscriptions: 0,
    sent: 0,
    pruned: 0,
    errors: [],
  };
  if (!result.configured) {
    console.warn("[push] disabled: VAPID keys not configured");
    return result;
  }

  const subs = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${locationId}, true)`,
    );
    return tx
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.locationId, locationId),
          eq(pushSubscriptions.userId, userId),
        ),
      );
  });
  result.subscriptions = subs.length;
  if (!subs.length) {
    console.info(`[push] user=${userId} has no subscriptions`);
    return result;
  }

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 },
        );
        result.sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired/revoked — prune it.
          result.pruned += 1;
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`select set_config('app.location_id', ${locationId}, true)`,
            );
            await tx
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, s.endpoint));
          });
        } else {
          const msg = `${status ?? "?"}: ${err instanceof Error ? err.message : "unknown"}`;
          result.errors.push(msg);
          console.warn(`[push] send failed (${msg})`);
        }
      }
    }),
  );
  console.info(
    `[push] user=${userId} sent=${result.sent}/${result.subscriptions} pruned=${result.pruned} errors=${result.errors.length}`,
  );
  return result;
}
