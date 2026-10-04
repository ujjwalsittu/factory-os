/** Indian formats (docs/13 U7). */
export const formatDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/ /g, '-');

export const formatDateTime = (iso: string | Date) =>
  `${formatDate(iso)} ${new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}`;

export const formatINR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);

/** "FY 2026-27" for a date, with an April start by default. */
export function fyLabel(d = new Date(), startMonth = 4): string {
  const y = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Quantity from a 6-decimal string, trimmed to the unit's decimals, Indian grouping. */
export function formatQty(value: string | null | undefined, decimals = 3): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** Money from a decimal string (display only; arithmetic stays on the server). */
export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export const ITEM_TYPE_LABELS: Record<string, string> = {
  raw_material: 'Raw material',
  powder: 'Metal powder',
  component: 'Component',
  consumable: 'Consumable',
  sub_assembly: 'Sub-assembly',
  finished_good: 'Finished good',
  kit: 'Kit',
  tool: 'Tool',
  gauge: 'Gauge / instrument',
  service: 'Service',
  scrap: 'Scrap',
};

export const WAREHOUSE_TYPE_LABELS: Record<string, string> = {
  stores: 'Stores',
  quarantine: 'Quarantine',
  mrb: 'MRB / hold',
  wip: 'WIP',
  dry_cabinet: 'Dry cabinet',
  cleanroom: 'Cleanroom',
  finished_goods: 'Finished goods',
  scrap: 'Scrap',
  customer_owned: 'Customer-owned',
  at_job_worker: 'At job worker',
  transit: 'In transit',
};
