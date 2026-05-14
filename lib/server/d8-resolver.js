/**
 * D8 — Mapeamento locationId ↔ stripe_customer_id.
 *
 * Estratégia (decisão D8=a):
 *   1. Se installations.stripe_customer_id já está setado → retorna
 *   2. Senão, tenta lookup no Stripe por metadata['location_id'] (caminho
 *      canônico daqui pra frente quando setarem metadata no customer)
 *   3. Senão, fallback: lookup por email — busca o email do dono da
 *      location no GHL via PIT, depois acha o customer Stripe com esse email
 *   4. Quando achar, persiste em installations.stripe_customer_id pra
 *      próxima chamada ser O(1)
 *
 * Retorna o stripe_customer_id ou null.
 */
import { db } from "./db.js";
import { stripeClient } from "./stripe-coupon.js";
import { fetchLocationMeta } from "./provision.js";

export async function resolveStripeCustomerId(locationId) {
  if (!locationId) return null;

  // 1) Cache em installations
  const { data: row } = await db()
    .from("installations")
    .select("stripe_customer_id, location_name")
    .eq("location_id", locationId)
    .maybeSingle();
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const stripe = stripeClient();

  // 2) Lookup por metadata.location_id (canônico)
  try {
    const search = await stripe.customers.search({
      query: `metadata['location_id']:'${locationId}'`,
      limit: 1,
    });
    const customer = search.data?.[0];
    if (customer) {
      await cacheCustomerId(locationId, customer.id);
      return customer.id;
    }
  } catch (err) {
    console.warn("[d8] metadata search failed:", err.message);
  }

  // 3) Fallback: lookup por email do dono da location
  const meta = await fetchLocationMeta(locationId);
  if (meta?.email) {
    try {
      const search = await stripe.customers.search({
        query: `email:'${meta.email}'`,
        limit: 1,
      });
      const customer = search.data?.[0];
      if (customer) {
        // Tag o customer com location_id pra próximas resoluções serem instant
        try {
          await stripe.customers.update(customer.id, {
            metadata: { ...customer.metadata, location_id: locationId },
          });
        } catch (err) {
          console.warn("[d8] could not tag customer metadata:", err.message);
        }
        await cacheCustomerId(locationId, customer.id);
        return customer.id;
      }
    } catch (err) {
      console.warn("[d8] email search failed:", err.message);
    }
  }

  return null;
}

async function cacheCustomerId(locationId, customerId) {
  try {
    await db()
      .from("installations")
      .update({ stripe_customer_id: customerId })
      .eq("location_id", locationId);
  } catch (err) {
    console.warn("[d8] cache failed:", err.message);
  }
}
