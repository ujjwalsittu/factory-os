export * from './decimal.js';
export * from './fifo.js';
export * from './series.js';

/** Document lifecycle shared by every transactional document (docs/02 principle 3). */
export const DOC_STATUSES = ['draft', 'submitted', 'cancelled'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export * from './accounting.js';
export * from './settlements.js';

export * from "./sales-notes.js";
export * from './supplier-returns.js';
export * from './bank-reconciliation-types.js';
export * from './bank-statement.js';
export * from './bank-reconciliation.js';
export * from './manufacturing.js';
export * from './job-work.js';
export * from './quality.js';
