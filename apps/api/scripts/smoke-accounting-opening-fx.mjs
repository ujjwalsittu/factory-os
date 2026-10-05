import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';
const c = await new Client().init('Foreign opening bills');
const p = await c.req(
  'POST',
  '/parties',
  {
    code: 'OVERSEAS',
    name: 'Prior books supplier',
    isSupplier: true,
    countryCode: 'US',
    gstTreatment: 'overseas',
  },
  201,
);
const bill = {
  partyId: p.id,
  reference: 'EXT-001',
  side: 'credit',
  amount: '850',
  currency: 'USD',
};
const worksheet = {
  lines: [
    {
      ...c.line('creditors', '0', '850'),
      partyId: p.id,
      billReference: 'EXT-001',
    },
    c.line('equity', '850'),
  ],
  receiptBaselines: [],
  settlements: [],
  bills: [bill],
};
await c.req('PUT', '/accounts/opening', worksheet, 400);
await c.req(
  'PUT',
  '/accounts/opening',
  {
    ...worksheet,
    bills: [{ ...bill, exchangeRate: '0', originalAmount: '10' }],
  },
  400,
);
await c.req(
  'PUT',
  '/accounts/opening',
  {
    ...worksheet,
    bills: [{ ...bill, exchangeRate: '85', originalAmount: '11' }],
  },
  400,
);
await c.activate(
  worksheet.lines,
  [],
  [{ ...bill, exchangeRate: '85', originalAmount: '10' }],
);
const tb = await c.req('GET', '/accounts/reports/trial-balance');
assert.equal(tb.debit, '850.000000');
assert.equal(tb.credit, '850.000000');
console.log(`Foreign opening checks passed (${c.checks}).`);
