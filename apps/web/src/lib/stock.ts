import type { BadgeTone } from '@factoryos/ui';
import type { DocStatus } from './types';

export const PURPOSE_LABELS = {
  receipt: 'Receipt',
  issue: 'Issue',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  return: 'Return to customer',
  scrap: 'Scrap',
  delivery: 'Delivery (sales invoice)',
} as const;
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
