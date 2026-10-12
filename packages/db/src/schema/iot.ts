// Decision 063: the IoT pilot. Each plant's edge agent holds a credential (only its hash is stored) and forwards the
// machine taps' state changes; the events are append-only and drive machine-hour metering of bookings.
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { machine } from './manufacturing.js';
import { legalEntity, tenant } from './platform.js';

const scope = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => legalEntity.id),
};

export const iotEdgeStatus = pgEnum('iot_edge_status', ['active', 'revoked']);
export const iotDeviceStatus = pgEnum('iot_device_status', ['active', 'retired']);
export const iotDeviceKind = pgEnum('iot_device_kind', ['machine_tap']);
export const machineState = pgEnum('machine_state', ['off', 'idle', 'setup', 'running', 'alarm', 'maintenance']);

/** A plant edge PC. Its key is shown once; only the SHA-256 hash and a short prefix are kept. */
export const iotEdge = pgTable(
  'iot_edge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: iotEdgeStatus('status').notNull().default('active'),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('iot_edge_code_uq').on(t.entityId, t.code), uniqueIndex('iot_edge_key_uq').on(t.keyHash)],
);

/** Decision 064: what a tap applies, set in Plant → Devices and published to it by the edge agent. */
export interface TapConfig {
  offAmps: number;
  runAmps: number;
  /** Amps per ADC volt of the CT burden; set when the tap is calibrated on its machine. */
  ctAmpsPerVolt: number;
  debounceSeconds: number;
  lights: { red: 'alarm' | 'none'; amber: 'idle' | 'setup' | 'alarm' | 'none'; green: 'running' | 'none' };
}
export const DEFAULT_TAP_CONFIG: TapConfig = { offAmps: 0.5, runAmps: 3, ctAmpsPerVolt: 30, debounceSeconds: 5, lights: { red: 'alarm', amber: 'idle', green: 'running' } };

/** A machine tap behind an edge; at most one active tap per machine. */
export const iotDevice = pgTable(
  'iot_device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...scope,
    edgeId: uuid('edge_id')
      .notNull()
      .references(() => iotEdge.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: iotDeviceKind('kind').notNull().default('machine_tap'),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    heartbeatSeconds: integer('heartbeat_seconds').notNull().default(60),
    status: iotDeviceStatus('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastState: machineState('last_state'),
    /** Decision 064: settings pushed to the tap, and what the tap last reported. */
    config: jsonb('config').$type<TapConfig>().notNull().default(DEFAULT_TAP_CONFIG),
    configVersion: integer('config_version').notNull().default(1),
    fwVersion: text('fw_version'),
    appliedConfigVersion: integer('applied_config_version'),
    rssi: integer('rssi'),
    outbox: integer('outbox'),
    lastError: text('last_error'),
    statusAt: timestamp('status_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('iot_device_code_uq').on(t.entityId, t.code),
    uniqueIndex('iot_device_machine_uq').on(t.machineId).where(sql`${t.status} = 'active'`),
    check('iot_device_heartbeat_ck', sql`${t.heartbeatSeconds} between 10 and 600`),
  ],
);

/** Append-only. A heartbeat repeats the current state; (device, seq) makes a resent event a no-op. */
export const machineStateEvent = pgTable(
  'machine_state_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => iotDevice.id),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machine.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    state: machineState('state').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('machine_state_event_seq_uq').on(t.deviceId, t.seq), index('machine_state_event_machine_idx').on(t.machineId, t.at)],
);
