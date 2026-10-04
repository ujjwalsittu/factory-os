export * from './decimal.js';
export * from './fifo.js';
export * from './series.js';

/** Document lifecycle shared by every transactional document (docs/02 principle 3). */
export const DOC_STATUSES = ['draft', 'submitted', 'cancelled'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
