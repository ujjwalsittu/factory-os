/**
 * SMT traceability (decision 065): moisture-sensitive reel clocks (J-STD-033 floor life), solder paste readiness,
 * which reels a placed panel saw, and ZPL labels with a DataMatrix code.
 */

// ── MSL floor life ──

export const MSL_LEVELS = ['1', '2', '2a', '3', '4', '5', '5a', '6'] as const;
export type MslLevel = (typeof MSL_LEVELS)[number];

/** Floor life in hours at ≤30 °C / 60 % RH (J-STD-033); null = unlimited. Level 6 uses the time on its label. */
export const MSL_FLOOR_HOURS: Record<MslLevel, number | null> = { '1': null, '2': 8760, '2a': 672, '3': 168, '4': 72, '5': 48, '5a': 24, '6': null };

export const REEL_EVENTS = ['opened', 'cabinet_in', 'cabinet_out', 'baked', 'resealed', 'empty'] as const;
export type ReelEventKind = (typeof REEL_EVENTS)[number];

export interface ContainerEvent<K extends string> {
  kind: K;
  at: Date;
}

export type ReelPhase = 'sealed' | 'open' | 'cabinet' | 'empty';

export interface ReelClock {
  phase: ReelPhase;
  /** Floor time used, in minutes; the clock runs only while open. */
  usedMinutes: number;
  /** Null when the floor life is unlimited (not moisture sensitive, or MSL 1). */
  floorMinutes: number | null;
  remainingMinutes: number | null;
  /** Floor life used up, or an MSL 6 reel not baked yet: bake before it can be loaded. */
  needsBake: boolean;
}

const ALLOWED_REEL: Record<ReelPhase, readonly ReelEventKind[]> = {
  sealed: ['opened', 'baked', 'empty'],
  open: ['cabinet_in', 'resealed', 'baked', 'empty'],
  cabinet: ['cabinet_out', 'baked', 'empty'],
  empty: [],
};

/** The reel events allowed next, from its phase. */
export function reelEventsAllowed(phase: ReelPhase): readonly ReelEventKind[] {
  return ALLOWED_REEL[phase];
}

/**
 * The reel's clock at `now`. Floor time runs while the reel is open (dry pack opened and not in the dry cabinet or
 * resealed); the cabinet pauses it rather than applying J-STD-033's partial resets, which never gives more floor life
 * than the standard. A bake resets it. Events must be in time order and follow `reelEventsAllowed`.
 */
export function reelClock(level: MslLevel | null, events: ContainerEvent<ReelEventKind>[], now: Date, labelHours?: number | null): ReelClock {
  const floorHours = level === '6' ? (labelHours ?? null) : level ? MSL_FLOOR_HOURS[level] : null;
  const floorMinutes = floorHours === null ? null : floorHours * 60;
  let phase: ReelPhase = 'sealed';
  let used = 0;
  let since: number | null = null;
  let baked = false;
  for (const e of events) {
    const t = e.at.getTime();
    if (since !== null) used += Math.max(0, t - since) / 60_000;
    since = null;
    if (e.kind === 'opened' || e.kind === 'cabinet_out') phase = 'open';
    else if (e.kind === 'cabinet_in') phase = 'cabinet';
    else if (e.kind === 'resealed') phase = 'sealed';
    else if (e.kind === 'baked') {
      used = 0;
      baked = true;
      phase = 'sealed';
    } else if (e.kind === 'empty') phase = 'empty';
    if (phase === 'open') since = t;
  }
  if (since !== null) used += Math.max(0, now.getTime() - since) / 60_000;
  const usedMinutes = Math.floor(used);
  const remainingMinutes = floorMinutes === null ? null : Math.max(0, floorMinutes - usedMinutes);
  const needsBake = phase !== 'empty' && ((level === '6' && !baked) || (floorMinutes !== null && usedMinutes >= floorMinutes));
  return { phase, usedMinutes, floorMinutes, remainingMinutes, needsBake };
}

// ── Solder paste ──

export const PASTE_EVENTS = ['out_of_fridge', 'opened', 'back_in_fridge', 'empty'] as const;
export type PasteEventKind = (typeof PASTE_EVENTS)[number];
export type PastePhase = 'cold' | 'thawing' | 'ready' | 'open' | 'over_open_time' | 'expired' | 'empty';

export interface PasteRules {
  thawMinutes: number;
  openHours: number;
  /** The lot's expiry date (YYYY-MM-DD, IST): usable through that day. */
  expiryDate: string | null;
}

export interface PasteState {
  phase: PastePhase;
  readyAt: Date | null;
  openUntil: Date | null;
  /** Ready to load on the printer: thawed, not over its open time, not expired. */
  usable: boolean;
}

/** Events allowed next for a paste jar. */
export function pasteEventsAllowed(phase: PastePhase): readonly PasteEventKind[] {
  switch (phase) {
    case 'cold':
      return ['out_of_fridge', 'empty'];
    case 'thawing':
    case 'ready':
      return ['opened', 'back_in_fridge', 'empty'];
    case 'open':
    case 'over_open_time':
    case 'expired':
      return ['empty'];
    case 'empty':
      return [];
  }
}

const IST_MS = 5.5 * 3600_000;

export function pasteState(events: ContainerEvent<PasteEventKind>[], now: Date, rules: PasteRules): PasteState {
  let out: number | null = null;
  let opened: number | null = null;
  let empty = false;
  for (const e of events) {
    if (e.kind === 'out_of_fridge') out = e.at.getTime();
    else if (e.kind === 'back_in_fridge') out = null;
    else if (e.kind === 'opened') opened = e.at.getTime();
    else if (e.kind === 'empty') empty = true;
  }
  const readyAt = out === null ? null : new Date(out + rules.thawMinutes * 60_000);
  const openUntil = opened === null ? null : new Date(opened + rules.openHours * 3600_000);
  const t = now.getTime();
  // The expiry date is a calendar day in India: usable until the end of that day.
  const expired = rules.expiryDate !== null && t >= Date.parse(`${rules.expiryDate}T00:00:00Z`) + 86400_000 - IST_MS;
  let phase: PastePhase;
  if (empty) phase = 'empty';
  else if (expired) phase = 'expired';
  else if (openUntil) phase = t >= openUntil.getTime() ? 'over_open_time' : 'open';
  else if (readyAt) phase = t >= readyAt.getTime() ? 'ready' : 'thawing';
  else phase = 'cold';
  return { phase, readyAt, openUntil, usable: phase === 'ready' || phase === 'open' };
}

// ── Feeder setup ──

export interface FeederLoad {
  slot: string;
  containerId: string;
  loadedAt: Date;
  unloadedAt: Date | null;
}

/** The loads a panel saw when it was scanned into placement: loaded at or before, and not yet unloaded. */
export function loadsAt<T extends FeederLoad>(loads: T[], placedAt: Date): T[] {
  const t = placedAt.getTime();
  return loads.filter((l) => l.loadedAt.getTime() <= t && (l.unloadedAt === null || t < l.unloadedAt.getTime()));
}

// ── Labels (ZPL) ──

export interface LabelSize {
  dpi: number;
  widthMm: number;
  heightMm: number;
}

/** ZPL field data with ^FH: `_`, `^` and `~` are written as hex so data can't end a field or start a command. */
function fieldData(s: string) {
  return s.replace(/[_^~\\]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).replace(/[\r\n]+/g, ' ');
}

/**
 * One label: a DataMatrix of `code` on the left and up to five text lines to its right (the first in bold size), for
 * a Zebra-compatible printer. `copies` prints the same label several times.
 */
export function zplLabel(code: string, lines: string[], size: LabelSize, copies = 1): string {
  const dots = (mm: number) => Math.round((mm * size.dpi) / 25.4);
  const w = dots(size.widthMm);
  const h = dots(size.heightMm);
  const margin = dots(1.5);
  // Module ≈ 0.37 mm at 203 dpi, never below 2 dots so cheap scanners still read it.
  const module = Math.max(2, Math.round(size.dpi / 70));
  const matrix = Math.min(h - 2 * margin, w / 2);
  const textX = margin + matrix + dots(2);
  const big = Math.max(dots(2.8), 16);
  const small = Math.max(dots(2.2), 12);
  const out = ['^XA', '^CI28', `^PW${w}`, `^LL${h}`, '^LH0,0', `^FO${margin},${margin}^BXN,${module},200^FH_^FD${fieldData(code)}^FS`];
  let y = margin;
  lines.slice(0, 5).forEach((line, i) => {
    const fh = i === 0 ? big : small;
    if (y + fh > h - margin) return;
    out.push(`^FO${textX},${y}^A0N,${fh},${fh}^FB${Math.max(w - textX - margin, 1)},1,0,L^FH_^FD${fieldData(line)}^FS`);
    y += fh + dots(0.8);
  });
  out.push(`^PQ${Math.max(1, Math.floor(copies))}`, '^XZ');
  return out.join('\n');
}

export const panelLabel = (p: { code: string; workOrder: string; item: string; revision: string | null; boards: number }, size: LabelSize) =>
  zplLabel(p.code, [p.code, `${p.workOrder} · ${p.boards} boards`, `${p.item}${p.revision ? ` rev ${p.revision}` : ''}`], size);

export const boardLabel = (b: { serial: string; item: string; revision: string | null }, size: LabelSize) => zplLabel(b.serial, [b.serial, `${b.item}${b.revision ? ` rev ${b.revision}` : ''}`], size);

export const containerLabel = (c: { code: string; item: string; lot: string; qty: string; uom: string; note: string | null }, size: LabelSize) =>
  zplLabel(c.code, [c.code, c.item, `Lot ${c.lot}`, `${c.qty} ${c.uom}`, ...(c.note ? [c.note] : [])], size);
