// Phase 3a machine-hour MaaS (decision 055): shapes returned by /services.

export type BookingStatus = 'tentative' | 'confirmed' | 'in_use' | 'completed' | 'cancelled';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  tentative: { label: 'Tentative', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  in_use: { label: 'In use', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

/** Steps that keep billed hours exact (decision 055). */
export const ROUNDING_STEPS = [6, 12, 15, 30, 60] as const;

export interface RateCard {
  id: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  serviceItemId: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  memberRate: string | null;
  minimumMinutes: number;
  roundingMinutes: number;
  validFrom: string;
  validTo: string | null;
}

export interface Booking {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  purpose: string | null;
  machineBlockId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  cancelReason: string | null;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'draft' | 'submitted' | 'cancelled' | null;
  usedMinutes: number;
}

export interface BookingDetail extends Booking {
  member: boolean;
  workCentre: string;
  usage: { id: string; minutes: number; source: 'timer' | 'manual'; note: string | null; recordedAt: string; recordedBy: string }[];
  rateCard: { id: string; standardRate: string; memberRate: string | null; minimumMinutes: number; roundingMinutes: number; validFrom: string; validTo: string | null } | null;
  charge: { actualMinutes: number; billableMinutes: number; hours: string; rate: string; amount: string; memberRate: boolean } | null;
  /** Decision 056: the membership covering the booking's start date, and what billing would draw from it. */
  membership: { id: string; number: string; endsOn: string; remainingMinutes: number } | null;
  drawnMinutes: number;
  split: { coveredMinutes: number; overageMinutes: number; overageHours: string; overageAmount: string } | null;
  billed: boolean;
  billable: boolean;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  includedMinutes: number;
  termMonths: number;
  fee: string;
  serviceItemId: string;
  itemCode: string;
  isActive: boolean;
}

export interface Membership {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  planId: string;
  planCode: string;
  planName: string;
  startsOn: string;
  endsOn: string;
  includedMinutes: number;
  fee: string;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'draft' | 'submitted' | 'cancelled' | null;
  usedMinutes: number;
  remainingMinutes: number;
}

export interface MembershipDetail extends Membership {
  draws: { id: string; bookingId: string; bookingNumber: string; minutes: number; reversalOf: string | null; reason: string | null; createdAt: string; createdBy: string }[];
}

/** `datetime-local` value in IST for an instant, and back. */
export const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
export const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export const formatMinutes = (m: number) => {
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  return `${m < 0 ? '−' : ''}${h ? `${h} h` : ''}${h && r ? ' ' : ''}${r || !h ? `${r} min` : ''}`;
};
