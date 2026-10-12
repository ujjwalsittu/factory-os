// The plant MQTT contract (decision 063, docs/07): topics `factoryos/{tenant}/{plant}/{device}/{metric}`; a machine
// tap publishes its state on metric `state` as JSON {seq, state, at}. The edge agent and the tap simulator share this.

export const MACHINE_STATES = ['off', 'idle', 'setup', 'running', 'alarm', 'maintenance'] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

/** What a tap publishes: its own increasing counter, the state, and when (ISO 8601). Heartbeats repeat the state. */
export interface TapMessage {
  seq: number;
  state: MachineState;
  at: string;
}

/** One event as the edge agent queues it and posts it to `/iot/ingest`. */
export interface IngestEvent extends TapMessage {
  device: string;
}

export interface IngestResult {
  device: string;
  seq: number;
  status: 'accepted' | 'duplicate' | 'refused';
  reason?: string;
}

const SEGMENT = /^[A-Za-z0-9._-]{1,40}$/;

export function stateTopic(tenant: string, plant: string, device: string) {
  for (const s of [tenant, plant, device]) if (!SEGMENT.test(s)) throw new Error(`Bad topic segment: ${s}`);
  return `factoryos/${tenant}/${plant}/${device}/state`;
}

/** The subscription for every tap of one plant. */
export function plantStateFilter(tenant: string, plant: string) {
  return `factoryos/${tenant}/${plant}/+/state`;
}

/** The device code from a state topic of this tenant and plant, or null. */
export function deviceFromTopic(topic: string, tenant: string, plant: string): string | null {
  const parts = topic.split('/');
  if (parts.length !== 5 || parts[0] !== 'factoryos' || parts[1] !== tenant || parts[2] !== plant || parts[4] !== 'state') return null;
  return SEGMENT.test(parts[3]!) ? parts[3]! : null;
}

/** Validates a tap's payload; returns the message or the reason it is unusable. */
export function parseTapMessage(payload: string | Uint8Array): TapMessage | { error: string } {
  let v: unknown;
  try {
    v = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
  } catch {
    return { error: 'Not JSON' };
  }
  const m = v as Partial<TapMessage>;
  if (!m || typeof m !== 'object') return { error: 'Not an object' };
  if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0) return { error: 'Bad seq' };
  if (!MACHINE_STATES.includes(m.state as MachineState)) return { error: `Unknown state ${String(m.state)}` };
  if (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at))) return { error: 'Bad timestamp' };
  return { seq: m.seq as number, state: m.state as MachineState, at: m.at };
}

// ── Decision 064: tap configuration, status and firmware updates ──

/** Retained on `factoryos/{tenant}/{plant}/{device}/config`; the tap applies it and reports `configVersion`. */
export interface TapConfigMessage {
  version: number;
  heartbeatSeconds: number;
  offAmps: number;
  runAmps: number;
  ctAmpsPerVolt: number;
  debounceSeconds: number;
  lights: { red: 'alarm' | 'none'; amber: 'idle' | 'setup' | 'alarm' | 'none'; green: 'running' | 'none' };
}

/** Retained on `factoryos/{tenant}/{plant}/{device}/status`. */
export interface TapStatus {
  fwVersion: string;
  configVersion: number | null;
  uptime: number;
  rssi: number | null;
  outbox: number;
  lastError: string | null;
  at: string;
}

/** Retained on `factoryos/{tenant}/{plant}/ota`: the signed manifest of the firmware every tap should run. */
export interface OtaManifest {
  version: string;
  size: number;
  sha256: string;
  url: string;
  /** Ed25519 over the canonical string `factoryos-mt1|{version}|{size}|{sha256}`, base64. */
  signature: string;
}

export const otaSigningPayload = (m: Pick<OtaManifest, 'version' | 'size' | 'sha256'>) => `factoryos-mt1|${m.version}|${m.size}|${m.sha256}`;

export function deviceTopic(tenant: string, plant: string, device: string, metric: 'state' | 'status' | 'config') {
  return stateTopic(tenant, plant, device).replace(/\/state$/, `/${metric}`);
}
export function plantStatusFilter(tenant: string, plant: string) {
  return `factoryos/${tenant}/${plant}/+/status`;
}
export function otaTopic(tenant: string, plant: string) {
  if (!SEGMENT.test(tenant) || !SEGMENT.test(plant)) throw new Error('Bad topic segment');
  return `factoryos/${tenant}/${plant}/ota`;
}

/** The device code from a `status` topic of this tenant and plant, or null. */
export function deviceFromStatusTopic(topic: string, tenant: string, plant: string): string | null {
  return deviceFromTopic(topic.replace(/\/status$/, '/state'), tenant, plant) && topic.endsWith('/status') ? topic.split('/')[3]! : null;
}

export function parseTapStatus(payload: string | Uint8Array): TapStatus | { error: string } {
  let v: Partial<TapStatus>;
  try {
    v = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload)) as Partial<TapStatus>;
  } catch {
    return { error: 'Not JSON' };
  }
  if (!v || typeof v !== 'object' || typeof v.fwVersion !== 'string' || typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at))) return { error: 'Bad status' };
  return {
    fwVersion: v.fwVersion.slice(0, 40),
    configVersion: Number.isSafeInteger(v.configVersion) ? (v.configVersion as number) : null,
    uptime: Number.isFinite(v.uptime) ? Math.max(0, Math.floor(v.uptime as number)) : 0,
    rssi: Number.isFinite(v.rssi) ? Math.round(v.rssi as number) : null,
    outbox: Number.isFinite(v.outbox) ? Math.max(0, Math.floor(v.outbox as number)) : 0,
    lastError: typeof v.lastError === 'string' ? v.lastError.slice(0, 200) : null,
    at: v.at,
  };
}
