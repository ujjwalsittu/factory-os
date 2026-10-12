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
