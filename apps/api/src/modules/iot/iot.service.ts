// Decision 063: edge credentials, ingest of tap state events, and the machine timeline that meters bookings.
import { machineTimeline, occupiedMinutes, type MachineState } from '@factoryos/core';
import { type Database, iotDevice, iotEdge, machineStateEvent } from '@factoryos/db';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { DB } from '../../common/tokens.js';
import type { Tx } from '../accounting/accounting-lock.js';

export const MACHINE_STATES = ['off', 'idle', 'setup', 'running', 'alarm', 'maintenance'] as const;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const RATE_PER_MINUTE = 120;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86400_000;

export type IngestEvent = { device: string; seq: number; state: string; at: string };
export type IngestResult = { device: string; seq: number; status: 'accepted' | 'duplicate' | 'refused'; reason?: string };

@Injectable()
export class IotService {
  private readonly rate = new Map<string, { start: number; count: number }>();

  constructor(@Inject(DB) private readonly db: Database) {}

  /** A new edge key: shown once; only its hash and a short prefix are stored. */
  newKey() {
    const key = `fos_edge_${randomBytes(32).toString('base64url')}`;
    return { key, keyPrefix: key.slice(0, 13), keyHash: hash(key) };
  }

  async edgeForKey(header: string | undefined) {
    const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key.startsWith('fos_edge_')) return null;
    const [e] = await this.db.select().from(iotEdge).where(and(eq(iotEdge.keyHash, hash(key)), eq(iotEdge.status, 'active')));
    return e ?? null;
  }

  /** At most RATE_PER_MINUTE requests a minute per edge (in-process; one API instance in the pilot). */
  throttle(edgeId: string) {
    const now = Date.now();
    const r = this.rate.get(edgeId);
    if (!r || now - r.start >= 60_000) return void this.rate.set(edgeId, { start: now, count: 1 });
    if (++r.count > RATE_PER_MINUTE) throw new HttpException('Too many requests from this edge; retry shortly', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Each event's result keyed by (device, seq); a resent event is a duplicate, never stored twice. */
  async ingest(edge: typeof iotEdge.$inferSelect, events: IngestEvent[]): Promise<IngestResult[]> {
    const codes = [...new Set(events.map((e) => e.device))];
    const devices = codes.length ? await this.db.select().from(iotDevice).where(and(eq(iotDevice.entityId, edge.entityId), inArray(iotDevice.code, codes))) : [];
    const now = Date.now();
    const results: IngestResult[] = [];
    const seen = new Map<string, { at: Date; state: MachineState }>();
    for (const ev of events) {
      const d = devices.find((x) => x.code === ev.device);
      const refuse = (reason: string) => results.push({ device: ev.device, seq: ev.seq, status: 'refused', reason });
      if (!d) { refuse('Unknown device'); continue; }
      if (d.edgeId !== edge.id) { refuse('The device belongs to another edge'); continue; }
      if (d.status !== 'active') { refuse('The device is retired'); continue; }
      if (!(MACHINE_STATES as readonly string[]).includes(ev.state)) { refuse(`Unknown state ${ev.state}`); continue; }
      const at = new Date(ev.at);
      if (Number.isNaN(at.getTime())) { refuse('Bad timestamp'); continue; }
      if (at.getTime() > now + MAX_FUTURE_MS) { refuse('Timestamp is in the future'); continue; }
      if (at.getTime() < now - MAX_AGE_MS) { refuse('Timestamp is older than 30 days'); continue; }
      const [row] = await this.db
        .insert(machineStateEvent)
        .values({ tenantId: edge.tenantId, deviceId: d.id, machineId: d.machineId, seq: ev.seq, state: ev.state as MachineState, at })
        .onConflictDoNothing()
        .returning({ id: machineStateEvent.id });
      results.push({ device: ev.device, seq: ev.seq, status: row ? 'accepted' : 'duplicate' });
      const prev = seen.get(d.id);
      if (row && (!prev || prev.at < at)) seen.set(d.id, { at, state: ev.state as MachineState });
    }
    const stamp = new Date();
    for (const [id, last] of seen) {
      await this.db
        .update(iotDevice)
        .set({ lastSeenAt: stamp, lastState: last.state })
        .where(eq(iotDevice.id, id));
    }
    await this.db.update(iotEdge).set({ lastSeenAt: stamp }).where(eq(iotEdge.id, edge.id));
    return results;
  }

  /** Decision 064: the config message for each active tap of this edge. */
  async configs(edge: typeof iotEdge.$inferSelect) {
    const taps = await this.db.select().from(iotDevice).where(and(eq(iotDevice.edgeId, edge.id), eq(iotDevice.status, 'active'))).orderBy(asc(iotDevice.code));
    return taps.map((t) => ({ device: t.code, config: { version: t.configVersion, heartbeatSeconds: t.heartbeatSeconds, ...t.config } }));
  }

  /** Decision 064: record the taps' status reports; refused when the tap isn't this edge's active tap. */
  async status(edge: typeof iotEdge.$inferSelect, statuses: { device: string; fwVersion: string; configVersion: number | null; uptime: number; rssi: number | null; outbox: number; lastError: string | null; at: string }[]) {
    const taps = await this.db.select().from(iotDevice).where(and(eq(iotDevice.edgeId, edge.id), eq(iotDevice.status, 'active'), inArray(iotDevice.code, [...new Set(statuses.map((s) => s.device))])));
    const results: { device: string; status: 'accepted' | 'refused'; reason?: string }[] = [];
    for (const s of statuses) {
      const t = taps.find((x) => x.code === s.device);
      if (!t) {
        results.push({ device: s.device, status: 'refused', reason: 'Not an active tap of this edge' });
        continue;
      }
      const at = new Date(s.at);
      if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60_000) {
        results.push({ device: s.device, status: 'refused', reason: 'Bad timestamp' });
        continue;
      }
      await this.db
        .update(iotDevice)
        .set({ fwVersion: s.fwVersion, appliedConfigVersion: s.configVersion, rssi: s.rssi, outbox: s.outbox, lastError: s.lastError, statusAt: at })
        .where(eq(iotDevice.id, t.id));
      results.push({ device: s.device, status: 'accepted' });
    }
    return results;
  }

  /** The tap that metered a machine over [from, to): active then, or the latest one. Null when it has never had one. */
  async deviceFor(db: Database | Tx, machineId: string, from: Date, to: Date) {
    const [d] = await db
      .select()
      .from(iotDevice)
      .where(and(eq(iotDevice.machineId, machineId), lte(iotDevice.createdAt, to), or(isNull(iotDevice.retiredAt), gte(iotDevice.retiredAt, from))))
      .orderBy(desc(iotDevice.createdAt))
      .limit(1);
    return d ?? null;
  }

  /** Segments of a machine's states over [from, to), and the occupied minutes; null when the machine has no tap. */
  async meter(db: Database | Tx, machineId: string, from: Date, to: Date) {
    const device = await this.deviceFor(db, machineId, from, to);
    if (!device) return null;
    const [before] = await db
      .select({ at: machineStateEvent.at, state: machineStateEvent.state })
      .from(machineStateEvent)
      .where(and(eq(machineStateEvent.machineId, machineId), lt(machineStateEvent.at, from), gte(machineStateEvent.at, new Date(from.getTime() - 86400_000))))
      .orderBy(desc(machineStateEvent.at))
      .limit(1);
    const inside = await db
      .select({ at: machineStateEvent.at, state: machineStateEvent.state })
      .from(machineStateEvent)
      .where(and(eq(machineStateEvent.machineId, machineId), gte(machineStateEvent.at, from), lt(machineStateEvent.at, to)))
      .orderBy(asc(machineStateEvent.at));
    const segments = machineTimeline(before ? [before, ...inside] : inside, from, to, device.heartbeatSeconds * 1000);
    return { device: { id: device.id, code: device.code, heartbeatSeconds: device.heartbeatSeconds }, segments, ...occupiedMinutes(segments) };
  }
}
