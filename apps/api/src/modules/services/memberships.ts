// Phase 3b studio memberships (decision 056): lookups shared by bookings and memberships.
import { maasMembership, maasMembershipDraw, type Database } from '@factoryos/db';
import { and, eq, gte, lte, sum } from 'drizzle-orm';
import type { Tx } from '../accounting/accounting-lock.js';

type Db = Database | Tx;

/** The customer's active membership whose term covers `date` (YYYY-MM-DD), or null. */
export async function membershipOn(db: Db, entityId: string, customerId: string, date: string) {
  const [m] = await db
    .select()
    .from(maasMembership)
    .where(and(eq(maasMembership.entityId, entityId), eq(maasMembership.customerId, customerId), eq(maasMembership.status, 'active'), lte(maasMembership.startsOn, date), gte(maasMembership.endsOn, date)))
    .limit(1);
  return m ?? null;
}

/** Net minutes drawn from a membership (draws less reversals). */
export async function membershipDrawn(db: Db, membershipId: string) {
  const [r] = await db.select({ total: sum(maasMembershipDraw.minutes) }).from(maasMembershipDraw).where(eq(maasMembershipDraw.membershipId, membershipId));
  return Number(r?.total ?? 0);
}

/** Net minutes a booking has drawn from memberships. */
export async function bookingDrawn(db: Db, bookingId: string) {
  const [r] = await db.select({ total: sum(maasMembershipDraw.minutes) }).from(maasMembershipDraw).where(eq(maasMembershipDraw.bookingId, bookingId));
  return Number(r?.total ?? 0);
}
