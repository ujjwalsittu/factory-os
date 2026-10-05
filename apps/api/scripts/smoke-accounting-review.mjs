import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';
const failures = [];
async function check(name, work) {
  if (process.env.REVIEW_CASE && !name.includes(process.env.REVIEW_CASE))
    return;
  await new Promise((r) => setTimeout(r, 12000));
  try {
    await work();
    console.log('PASS', name);
  } catch (e) {
    failures.push(e);
    console.error('FAIL', name, e.message);
  }
}
async function fixture(name, qty = '20', rate = '10', historical = false) {
  const c = await new Client().init(name),
    date = (await c.req('GET', '/accounts/opening/reconciliation')).cutoverDate;
  await c.req(
    'POST',
    `/entities/${c.entityId}/gst-registrations`,
    { gstin: gstin('27AAACA1234B1Z') },
    201,
  );
  await c.req(
    'POST',
    '/hsn-codes',
    {
      code: '8108',
      kind: 'hsn',
      description: 'Review metal',
      gstRate: '0',
      effectiveFrom: '2025-04-01',
    },
    201,
  );
  const supplier = await c.req(
    'POST',
    '/parties',
    {
      code: 'SUP',
      name: 'Review supplier',
      isSupplier: true,
      gstin: gstin('27AAACB1234B1Z'),
    },
    201,
  );
  const uom = (await c.req('GET', '/uoms')).find((u) => u.code === 'NOS');
  const item = await c.req(
    'POST',
    '/items',
    {
      code: 'METAL',
      name: 'Review metal',
      type: 'raw_material',
      stockUomId: uom.id,
      hsnCode: '8108',
    },
    201,
  );
  await c.req('POST', '/warehouses/standard', {}, 201);
  const wh = (await c.req('GET', '/warehouses')).find(
    (w) => w.code === 'STORES',
  );
  const po = await c.req(
    'POST',
    '/purchase-orders',
    {
      supplierId: supplier.id,
      orderDate: date,
      lines: [{ itemId: item.id, qty, rate }],
    },
    201,
  );
  await c.req('POST', `/purchase-orders/${po.id}/submit`, {}, 201);
  const pl = (await c.req('GET', `/purchase-orders/${po.id}`)).lines[0].id;
  if (!historical) await c.activate();
  async function receive(qty, override) {
    const se = await c.req(
      'POST',
      '/stock-entries',
      {
        purpose: 'receipt',
        postingDate: date,
        purchaseOrderId: po.id,
        partyId: supplier.id,
        lines: [
          {
            itemId: item.id,
            qty,
            ...(override && { rate: override }),
            toWarehouseId: wh.id,
            poLineId: pl,
          },
        ],
      },
      201,
    );
    await c.req('POST', `/stock-entries/${se.id}/submit`, {}, 201);
    return se;
  }
  async function bill(ref, qty) {
    const pi = await c.req(
      'POST',
      '/purchase-invoices',
      {
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        supplierInvoiceNo: ref,
        supplierInvoiceDate: date,
        postingDate: date,
        lines: [{ itemId: item.id, poLineId: pl, qty, rate }],
      },
      201,
    );
    await c.req('POST', `/purchase-invoices/${pi.id}/submit`, {}, 201);
    return pi;
  }
  return { c, date, receive, bill, supplier, po, pl, item, wh };
}
await check(
  'allocated receipt cannot be cancelled while other receipts remain',
  async () => {
    const { c, receive, bill } = await fixture('Allocated receipt guard');
    const first = await receive('10');
    const second = await receive('10');
    const pi = await bill('PARTIAL', '5');
    await c.req(
      'POST',
      `/stock-entries/${first.id}/cancel`,
      { reason: 'Allocated receipt cancellation must refuse' },
      409,
    );
    await c.req(
      'POST',
      `/stock-entries/${second.id}/cancel`,
      { reason: 'Unallocated receipt may cancel' },
      201,
    );
    await c.req(
      'POST',
      `/purchase-invoices/${pi.id}/cancel`,
      { reason: 'Reverse allocated bill' },
      201,
    );
    await c.req(
      'POST',
      `/stock-entries/${first.id}/cancel`,
      { reason: 'Allocation reversed so receipt may cancel' },
      201,
    );
    const tb = await c.req('GET', '/accounts/reports/trial-balance');
    assert.equal(tb.debit, '0.000000');
    assert.equal(tb.credit, '0.000000');
  },
);
await check(
  'mapped account cannot change root before first posting',
  async () => {
    const c = await new Client().init('Mapped account root');
    const groups = await c.req('GET', '/accounts/groups');
    await c.req(
      'PUT',
      `/accounts/accounts/${c.account('inventory')}`,
      { groupId: groups.find((g) => g.root === 'expense').id },
      409,
    );
    const own = c.accounts.find((a) => a.role === 'inventory').groupId;
    const custom = await c.req(
      'POST',
      '/accounts/groups',
      { name: 'Custom stock assets', root: 'asset' },
      201,
    );
    await c.req('PUT', `/accounts/accounts/${c.account('inventory')}`, {
      groupId: custom.id,
    });
  },
);
await check(
  'fractional full billing clears actual receipt cost exactly',
  async () => {
    const { c, receive, bill } = await fixture(
      'Fractional GRNI',
      '0.000003',
      '0.5',
    );
    await receive('0.000003');
    await bill('ONE', '0.000001');
    await bill('TWO', '0.000001');
    await bill('THREE', '0.000001');
    const tb = await c.req('GET', '/accounts/reports/trial-balance');
    assert.equal(
      tb.accounts.find((a) => a.id === c.account('grni')).balance,
      '0.000000',
    );
  },
);
await check('opening baseline preserves fractional receipt cost', async () => {
  const { c, receive, bill } = await fixture(
    'Fractional opening',
    '0.9',
    '0.000005',
    true,
  );
  await receive('0.9');
  await bill('PRIOR', '0.1');
  const p = await c.req('GET', '/accounts/opening/reconciliation');
  assert.equal(p.grniValue, '0.000004');
  await c.activate(
    [
      c.line('inventory', '0.000005'),
      c.line('grni', '0', '0.000004'),
      c.line('equity', '0', '0.000001'),
    ],
    p.receiptBaselines,
  );
});
await check(
  'receipt override variance is explicit rather than hidden in rounding',
  async () => {
    const { c, receive, bill } = await fixture(
      'Receipt override variance',
      '1',
      '100',
    );
    await receive('1', '120');
    const pi = await bill('OVERRIDE', '1');
    const vouchers = await c.req(
        'GET',
        `/accounts/journals?sourceType=purchase_invoice&sourceId=${pi.id}`,
      ),
      v = await c.req('GET', `/accounts/journals/${vouchers[0].id}`);
    const net = (role) =>
      v.entries
        .filter((e) => e.accountId === c.account(role))
        .reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0);
    assert.equal(net('rounding'), 0);
    assert.equal(net('price_variance'), -20);
  },
);
await check(
  'inactive reports and source status disclose absent books',
  async () => {
    const { c, receive } = await fixture(
        'Inactive accounting disclosure',
        '1',
        '100',
        true,
      ),
      se = await receive('1');
    const tb = await c.req('GET', '/accounts/reports/trial-balance');
    assert.equal(tb.accounting.active, false);
    const status = await c.req(
      'GET',
      `/accounts/source-status?sourceType=stock_entry&sourceId=${se.id}`,
    );
    assert.equal(status.state, 'inactive');
    const exported = await c.req(
      'GET',
      '/accounts/reports/trial-balance/export',
    );
    assert.equal(exported.accounting.active, false);
    const p = await c.req('GET', '/accounts/opening/reconciliation');
    await c.activate(
      [c.line('inventory', '100'), c.line('grni', '0', '100')],
      p.receiptBaselines,
    );
    assert.equal(
      (
        await c.req(
          'GET',
          `/accounts/source-status?sourceType=stock_entry&sourceId=${se.id}`,
        )
      ).state,
      'historical',
    );
  },
);
await check(
  'unrepresentable landed/customs cost uses explicit rounding',
  async () => {
    const { c, date, receive } = await fixture(
        'Rate precision costs',
        '15000',
        '0.000004',
      ),
      receipt = await receive('15000');
    const lcv = await c.req(
      'POST',
      '/landed-costs',
      {
        postingDate: date,
        receiptIds: [receipt.id],
        importIgst: '0.01',
        customsItcEligible: false,
        charges: [{ chargeType: 'other', amount: '0.01', basis: 'value' }],
      },
      201,
    );
    await c.req('POST', `/landed-costs/${lcv.id}/submit`, {}, 201);
    const vouchers = await c.req(
        'GET',
        `/accounts/journals?sourceType=landed_cost&sourceId=${lcv.id}`,
      ),
      v = await c.req('GET', `/accounts/journals/${vouchers[0].id}`);
    const round = v.entries.find((e) => e.accountId === c.account('rounding'));
    assert.equal(round.debit, '0.020000');
    assert.equal(
      v.entries.some((e) => e.accountId === c.account('production')),
      false,
    );
    const balance = await c.req('GET', '/accounts/reports/trial-balance');
    assert.equal(
      balance.accounts.find((a) => a.id === c.account('inventory')).balance,
      '0.060000',
    );
    await c.req(
      'POST',
      `/landed-costs/${lcv.id}/cancel`,
      { reason: 'Reverse explicit rounding accrual' },
      201,
    );
  },
);
await check(
  'fractional quantities split non-creditable tax proportionally',
  async () => {
    const { c, date, receive, supplier, po, pl, item, wh } = await fixture(
      'Fractional tax split',
      '0.000004',
      '100000',
    );
    await receive('0.000001');
    await receive('0.000003');
    const issue = await c.req(
      'POST',
      '/stock-entries',
      {
        purpose: 'issue',
        postingDate: date,
        lines: [{ itemId: item.id, qty: '0.000001', fromWarehouseId: wh.id }],
      },
      201,
    );
    await c.req('POST', `/stock-entries/${issue.id}/submit`, {}, 201);
    const pi = await c.req(
      'POST',
      '/purchase-invoices',
      {
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        supplierInvoiceNo: 'TINY-TAX',
        supplierInvoiceDate: date,
        postingDate: date,
        itcEligible: false,
        lines: [
          {
            itemId: item.id,
            poLineId: pl,
            qty: '0.000004',
            rate: '100000',
            gstRate: '18',
          },
        ],
      },
      201,
    );
    await c.req('POST', `/purchase-invoices/${pi.id}/submit`, {}, 201);
    const vouchers = await c.req(
        'GET',
        `/accounts/journals?sourceType=purchase_invoice&sourceId=${pi.id}`,
      ),
      v = await c.req('GET', `/accounts/journals/${vouchers[0].id}`);
    assert.equal(
      v.entries.find((e) => e.accountId === c.account('production'))?.debit,
      '0.020000',
    );
    assert.equal(
      v.entries.find((e) => e.accountId === c.account('inventory'))?.debit,
      '0.060000',
    );
  },
);
if (failures.length) process.exitCode = 1;
else console.log('Accounting review regressions passed.');
