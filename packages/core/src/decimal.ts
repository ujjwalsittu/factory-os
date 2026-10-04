/**
 * Fixed-point decimal with 6 fractional digits, backed by BigInt.
 * Used for quantities, rates and values so money never touches JS floats (AGENTS.md §6).
 * Matches the `numeric(24, 6)` columns in the database; values cross boundaries as strings.
 */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);
const RE = /^(-)?(\d+)(?:\.(\d+))?$/;

export class Dec {
  private constructor(readonly raw: bigint) {}

  static readonly ZERO = new Dec(0n);

  static of(value: string | number | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === 'bigint') return new Dec(value * FACTOR);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
      return Dec.of(value.toFixed(SCALE));
    }
    const m = RE.exec(value.trim());
    if (!m) throw new Error(`Not a decimal: "${value}"`);
    const frac = (m[3] ?? '').padEnd(SCALE + 1, '0');
    // Round half away from zero on the 7th fractional digit.
    let n = BigInt(m[2]!) * FACTOR + BigInt(frac.slice(0, SCALE));
    if (Number(frac[SCALE]) >= 5) n += 1n;
    return new Dec(m[1] ? -n : n);
  }

  add(o: Dec | string): Dec {
    return new Dec(this.raw + Dec.of(o).raw);
  }
  sub(o: Dec | string): Dec {
    return new Dec(this.raw - Dec.of(o).raw);
  }
  /** Product, rounded half away from zero to 6 places. */
  mul(o: Dec | string): Dec {
    return new Dec(roundDiv(this.raw * Dec.of(o).raw, FACTOR));
  }
  /** Quotient, rounded half away from zero to 6 places. */
  div(o: Dec | string): Dec {
    const d = Dec.of(o).raw;
    if (d === 0n) throw new Error('Division by zero');
    return new Dec(roundDiv(this.raw * FACTOR, d));
  }
  neg(): Dec {
    return new Dec(-this.raw);
  }
  abs(): Dec {
    return this.raw < 0n ? this.neg() : this;
  }
  cmp(o: Dec | string): -1 | 0 | 1 {
    const r = Dec.of(o).raw;
    return this.raw < r ? -1 : this.raw > r ? 1 : 0;
  }
  eq(o: Dec | string): boolean {
    return this.cmp(o) === 0;
  }
  lt(o: Dec | string): boolean {
    return this.cmp(o) < 0;
  }
  gt(o: Dec | string): boolean {
    return this.cmp(o) > 0;
  }
  isZero(): boolean {
    return this.raw === 0n;
  }
  isNeg(): boolean {
    return this.raw < 0n;
  }
  static min(a: Dec, b: Dec): Dec {
    return a.lt(b) ? a : b;
  }

  /** Canonical string with 6 decimals, e.g. "12.500000". */
  toString(): string {
    const neg = this.raw < 0n;
    const abs = neg ? -this.raw : this.raw;
    const int = abs / FACTOR;
    const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
    return `${neg ? '-' : ''}${int}.${frac}`;
  }
  /** Rounded to `places` (default 2) for display/money, half away from zero. */
  toFixed(places = 2): string {
    const f = 10n ** BigInt(SCALE - places);
    const q = roundDiv(this.raw, f);
    const neg = q < 0n;
    const abs = neg ? -q : q;
    const p = 10n ** BigInt(places);
    const frac = places ? `.${(abs % p).toString().padStart(places, '0')}` : '';
    return `${neg ? '-' : ''}${abs / p}${frac}`;
  }
  toJSON(): string {
    return this.toString();
  }
}

function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  const dAbs = d < 0n ? -d : d;
  if (twice < dAbs) return q;
  return (n < 0n) !== (d < 0n) ? q - 1n : q + 1n;
}

export const dec = Dec.of;
