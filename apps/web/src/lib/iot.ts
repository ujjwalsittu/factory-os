import type { BadgeTone } from '@factoryos/ui';

/** IoT pilot and machine-hour metering (decision 063). */
export type MachineState = 'off' | 'idle' | 'setup' | 'running' | 'alarm' | 'maintenance';
export const MACHINE_STATE: Record<MachineState | 'unknown', { label: string; tone: BadgeTone; bar: string }> = {
  running: { label: 'Running', tone: 'success', bar: 'bg-success' },
  setup: { label: 'Setup', tone: 'info', bar: 'bg-info' },
  idle: { label: 'Idle', tone: 'warning', bar: 'bg-warning' },
  alarm: { label: 'Alarm', tone: 'danger', bar: 'bg-danger' },
  off: { label: 'Off', tone: 'neutral', bar: 'bg-line-strong' },
  maintenance: { label: 'Maintenance', tone: 'neutral', bar: 'bg-muted' },
  unknown: { label: 'No data', tone: 'neutral', bar: 'bg-surface-2' },
};

export interface Segment {
  from: string;
  to: string;
  state: MachineState | 'unknown';
}
export interface Meter {
  device: { id: string; code: string; heartbeatSeconds: number };
  minutes: number;
  covered: boolean;
  segments: Segment[];
}
export interface Edge {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'revoked';
  keyPrefix: string;
  rotatedAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export interface Device {
  id: string;
  code: string;
  name: string;
  edgeId: string;
  edgeCode: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  heartbeatSeconds: number;
  status: 'active' | 'retired';
  lastSeenAt: string | null;
  lastState: MachineState | null;
}
export interface MachineRow {
  id: string;
  code: string;
  name: string;
  workCentre: string;
  device: { id: string; code: string } | null;
  state: MachineState | null;
  lastSeenAt: string | null;
  stale: boolean;
  todayMinutes: number | null;
}
