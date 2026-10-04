import type { BadgeTone } from '@factoryos/ui';
import type { DocStatus } from './types';

export const PURPOSE_LABELS = { receipt: 'Receipt', issue: 'Issue', transfer: 'Transfer', adjustment: 'Adjustment' } as const;
export const STATUS_TONE: Record<DocStatus, BadgeTone> = { draft: 'neutral', submitted: 'success', cancelled: 'danger' };
