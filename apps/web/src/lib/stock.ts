import type { BadgeTone } from '@factoryos/ui';
import type { DocStatus, StockPurpose } from './types';

/** A label for every purpose; typed by the enum so a new purpose cannot show blank. */
export const PURPOSE_LABELS: Record<StockPurpose, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  return: 'Return to customer',
  scrap: 'Scrap',
  sales_return: 'Sales return (credit note)',
  delivery: 'Delivery (sales invoice)',
  purchase_return: 'Purchase return',
  purchase_return_receipt: 'Purchase return received back',
  production_issue: 'Production issue',
  production_return: 'Production return',
  production_output: 'Production output',
  cut: 'Cut to size',
  job_work_out: 'Job work out',
  job_work_in: 'Job work in',
  maintenance: 'Maintenance spares',
};
export const STATUS_TONE: Record<DocStatus, BadgeTone> = { draft: 'neutral', submitted: 'success', cancelled: 'danger' };

export const WASTE_CATEGORY_LABELS: Record<string, string> = {
  metal_swarf: 'Metal swarf / chips',
  metal_offcut: 'Metal offcuts',
  rejected_parts: 'Rejected parts',
  metal_powder: 'Metal powder (AM)',
  e_waste: 'E-waste',
  coolant_oil: 'Coolant / cutting oil',
  solvent: 'Solvents',
  packaging: 'Packaging',
  other: 'Other',
};
export const HAZARDOUS_CATEGORIES = new Set(['metal_powder', 'coolant_oil', 'solvent']);

export const DISPOSAL_LABELS: Record<string, string> = {
  returned_to_customer: 'Returned to customer',
  sold: 'Sold (scrap sale)',
  authorised_recycler: 'Authorised recycler',
  tsdf: 'TSDF (hazardous)',
  other: 'Other',
};

/** Decision 053: the kinds of batch shown on the batch pages. */
export const BATCH_KIND: Record<'lot' | 'serial' | 'remnant', { label: string; tone: 'neutral' | 'accent' | 'warning' }> = {
  lot: { label: 'Lot', tone: 'neutral' },
  serial: { label: 'Serial', tone: 'accent' },
  remnant: { label: 'Remnant', tone: 'warning' },
};
