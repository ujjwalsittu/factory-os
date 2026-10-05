// AR/AP settlements (decision 036): receipts, payments, on-account money, later allocation, FX, cancellation
// dependencies, races, credit exposure, MSME balances and GL ↔ subledger reconciliation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-settlements.mjs
import assert from 'node:assert/strict';
import { Client, gstin } from './accounting-test-helpers.mjs';

const c = await new Client().init('Settlements');
const ok = (label) => console.log(`✓ ${label}`);
const fail = async (method, path, body, status, label) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  c.checks++;
  ok(label);
  return r.data;
};

const reg = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uoms = await c.req('GET', '/uoms');
await c.req('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Machining services', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
const svc = await c.req('POST', '/items', { code: 'MAAS', name: 'Machining hour', type: 'service', stockUomId: uoms.find((u) => u.code === 'HR').id, hsnCode: '998898' }, 201);
const addr = [{ label: 'Works', line1: 'Road 1', city: 'Pune', stateCode: '27', pincode: '411001' }];
const cus = await c.req('POST', '/parties', { code: 'CUS', name: 'Skyroot', isCustomer: true, gstin: gstin('27AAACS1234B1Z'), creditDays: 30, addresses: addr }, 201);
const exp = await c.req('POST', '/parties', { code: 'EXP', name: 'Airbus', isCustomer: true, gstTreatment: 'overseas' }, 201);
const sup = await c.req('POST', '/parties', { code: 'SUP', name: 'Mishra Metals', isSupplier: true, gstin: gstin('27AAACM1234B1Z'), msmeCategory: 'micro', creditDays: 30 }, 201);

const bank = c.account('bank');
const P = (o) => ({ direction: 'receipt', currency: 'INR', exchangeRate: '1', accountId: bank, allocations: [], ...o });

// ── Before activation: no settlements without books ──
await fail('POST', '/accounts/settlements/preview', P({ partyId: cus.id, postingDate: '2026-10-01', amount: '100' }), 400, 'receipts need active accounting');

// A pre-cut-over USD 100 export invoice to Airbus at ₹80, of which ₹3,200 was settled outside FactoryOS.
await c.req('PATCH', `/gst-registrations/${reg.id}`, { lutArn: 'AD270326001234X', lutValidFrom: '2026-04-01', lutValidTo: '2027-03-31' });
const exInv = await c.req('POST', '/sales-invoices', { customerId: exp.id, invoiceDate: (await c.req('GET', '/accounts/settings')).cutoverDate ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), currency: 'USD', exchangeRate: '80', lines: [{ itemId: svc.id, qty: '1', rate: '100' }] }, 201);
const exSub = await c.req('POST', `/sales-invoices/${exInv.id}/submit`, {}, 201);

// Opening: INR bill OPN-1 ₹10,000 for Skyroot; the Airbus invoice with ₹4,800 (USD 60) still open.
await c.activate(
  [
    { ...c.line('debtors', '10000'), partyId: cus.id, billReference: 'OPN-1' },
    { ...c.line('debtors', '4800'), partyId: exp.id, billReference: exSub.number },
    c.line('equity', '0', '14800'),
  ],
  [],
  [
    { partyId: cus.id, reference: 'OPN-1', side: 'debit', amount: '10000' },
    { partyId: exp.id, reference: exSub.number, side: 'debit', amount: '4800', invoiceId: exInv.id, currency: 'USD', exchangeRate: '80', originalAmount: '100' },
  ],
  [{ invoiceId: exInv.id, amount: '3200', reason: 'Received before cut-over' }],
);
const date = c.settings.cutoverDate;
const bills = (partyId, side = 'receivable', kind = 'bill') => c.req('GET', `/accounts/bills?partyId=${partyId}&side=${side}&kind=${kind}`);
let b = await bills(cus.id);
assert.deepEqual(b.map((x) => [x.reference, x.openAmount, x.carryingInr]), [['OPN-1', '10000.000000', '10000.000000']]);
ok('opening bill from the worksheet');
const [usd] = await bills(exp.id);
assert.deepEqual([usd.currency, usd.openAmount, usd.carryingInr, usd.originalAmount], ['USD', '60.000000', '4800.000000', '100.000000']);
ok('partly settled foreign opening bill: USD 60 open of 100, carried at ₹4,800');
assert.deepEqual(await c.req('GET', `/sales-invoices/${exInv.id}/balance`), { active: true, currency: 'USD', openAmount: '60.000000', carryingInr: '4800.000000' });
const opn = b[0].id;

// ── Receipts ──
const submit = (body) => c.req('POST', '/accounts/settlements', body, 201).then((s) => c.req('POST', `/accounts/settlements/${s.id}/submit`));
let r1 = await submit(P({ partyId: cus.id, postingDate: date, amount: '4000', bankReference: 'NEFT 1', allocations: [{ billId: opn, amount: '4000' }] }));
assert.match(r1.number, /^GL\/RCT\/\d\d-\d\d\/00001$/);
ok(`receipt numbered ${r1.number}`);
assert.equal((await bills(cus.id))[0].openAmount, '6000.000000');
ok('bill reduced to ₹6,000');

const r2 = await submit(P({ partyId: cus.id, postingDate: date, amount: '7000', allocations: [{ billId: opn, amount: '6000' }] }));
assert.equal((await bills(cus.id)).length, 0);
const [adv] = await bills(cus.id, 'receivable', 'advance');
assert.deepEqual([adv.reference, adv.openAmount], [`On account ${r2.number}`, '1000.000000']);
ok('overpayment: bill closed, ₹1,000 on account');

// FX: receive USD 40 at 83 against USD 60 carried at ₹4,800 → share ₹3,200, cash ₹3,320, gain ₹120.
const fx = P({ partyId: exp.id, postingDate: date, currency: 'USD', exchangeRate: '83', amount: '40', allocations: [{ billId: usd.id, amount: '40' }] });
const pv = await c.req('POST', '/accounts/settlements/preview', fx);
assert.deepEqual([pv.cashInr, pv.carryingInr, pv.forexInr], ['3320.000000', '3200.000000', '-120.000000']);
assert.ok(pv.lines.some((l) => l.accountId === c.account('forex') && l.credit === '120.000000'));
ok('preview: exchange gain ₹120 credited to FX');
await submit(fx);
const [usdAfter] = await bills(exp.id);
assert.deepEqual([usdAfter.openAmount, usdAfter.carryingInr], ['20.000000', '1600.000000']);
ok('USD 20 left, carried at ₹1,600');
assert.deepEqual(await c.req('GET', `/sales-invoices/${exInv.id}/balance`), { active: true, currency: 'USD', openAmount: '20.000000', carryingInr: '1600.000000' });

// ── Validation ──
await fail('POST', '/accounts/settlements/preview', P({ partyId: exp.id, postingDate: date, amount: '10', allocations: [{ billId: usd.id, amount: '10' }] }), 400, 'INR receipt cannot settle a USD bill');
await fail('POST', '/accounts/settlements/preview', P({ partyId: cus.id, postingDate: date, amount: '10', exchangeRate: '2' }), 400, 'INR rate must be 1');
await fail('POST', '/accounts/settlements/preview', P({ partyId: cus.id, postingDate: date, amount: '10', accountId: c.account('sales') }), 400, 'only cash/bank accounts');
await fail('POST', '/accounts/settlements/preview', P({ partyId: sup.id, postingDate: date, amount: '10' }), 400, 'a receipt needs a customer');
await fail('POST', '/accounts/settlements/preview', P({ partyId: cus.id, postingDate: '2099-01-01', amount: '10' }), 400, 'future date refused');
await fail('POST', '/accounts/settlements/preview', P({ partyId: exp.id, postingDate: date, currency: 'USD', exchangeRate: '83', amount: '30', allocations: [{ billId: usd.id, amount: '25' }] }), 400, 'cannot allocate more than open');
await fail('POST', '/accounts/settlements/preview', P({ partyId: exp.id, postingDate: date, currency: 'USD', exchangeRate: '83', amount: '5', allocations: [{ billId: usd.id, amount: '10' }] }), 400, 'allocations cannot exceed the amount');
await fail('POST', '/accounts/settlements/preview', P({ partyId: exp.id, postingDate: date, currency: 'USD', exchangeRate: '83', amount: '20', allocations: [{ billId: usd.id, amount: '5' }, { billId: usd.id, amount: '5' }] }), 400, 'a bill cannot be chosen twice');

// ── Race: two drafts each take USD 15 of the USD 20 left ──
const d1 = await c.req('POST', '/accounts/settlements', { ...fx, amount: '15', allocations: [{ billId: usd.id, amount: '15' }] }, 201);
const d2 = await c.req('POST', '/accounts/settlements', { ...fx, amount: '15', allocations: [{ billId: usd.id, amount: '15' }] }, 201);
const race = await Promise.all([c.raw('POST', `/accounts/settlements/${d1.id}/submit`), c.raw('POST', `/accounts/settlements/${d2.id}/submit`)]);
assert.deepEqual(race.map((x) => x.status).sort(), [200, 400]);
c.checks++;
ok('concurrent submits for the same bill: exactly one wins');
await c.req('DELETE', `/accounts/settlements/${race[0].status === 400 ? d1.id : d2.id}`);

// ── Active-era invoice, later allocation of on-account money, dependencies ──
const inv = await c.req('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: svc.id, qty: '10', rate: '1000' }] }, 201);
await c.req('POST', `/sales-invoices/${inv.id}/submit`, {}, 201);
const invBill = (await bills(cus.id)).find((x) => x.sourceId === inv.id);
assert.equal(invBill.openAmount, '11800.000000');
ok('submitted invoice becomes an open bill with its due date');
const alloc = await c.req('POST', '/accounts/settlement-allocations', { settlementId: r2.id, postingDate: date, reason: 'Apply advance', allocations: [{ billId: invBill.id, amount: '1000' }] }, 201);
assert.match(alloc.number, /\/ADJ\//);
assert.equal(alloc.voucherId, null);
ok('same-account INR allocation: evidence without an artificial journal');
assert.equal((await bills(cus.id)).find((x) => x.id === invBill.id).openAmount, '10800.000000');
assert.equal((await bills(cus.id, 'receivable', 'advance')).length, 0);
ok('advance used up, invoice reduced to ₹10,800');
await fail('POST', `/sales-invoices/${inv.id}/cancel`, { reason: 'wrong rate' }, 409, 'invoice with an allocation cannot be cancelled');
await fail('POST', `/accounts/settlements/${r2.id}/cancel`, { reason: 'bounced cheque' }, 409, 'receipt whose advance was applied cannot be cancelled');
await c.req('POST', `/accounts/settlement-allocations/${alloc.id}/cancel`, { reason: 'applied to wrong invoice' });
await c.req('POST', `/accounts/settlements/${r2.id}/cancel`, { reason: 'bounced cheque' });
assert.equal((await bills(cus.id)).find((x) => x.id === opn).openAmount, '6000.000000');
ok('reversals restore the bill and remove the advance');
await c.req('POST', `/sales-invoices/${inv.id}/cancel`, { reason: 'wrong rate' }, 201);
assert.equal((await bills(cus.id)).some((x) => x.id === invBill.id), false);
ok('invoice cancellable once nothing settles it');

// ── Manual journals respect bills ──
const jv = (lines) => c.req('POST', '/accounts/journals', { postingDate: date, narration: 'Adjustment test', lines }, 201);
let j = await jv([{ ...c.line('debtors', '0', '7000'), partyId: cus.id, billReference: 'OPN-1' }, c.line('rounding', '7000')]);
await fail('POST', `/accounts/journals/${j.id}/submit`, undefined, 400, 'journal cannot take a bill below zero');
j = await jv([{ ...c.line('debtors', '0', '10'), partyId: exp.id, billReference: exSub.number }, c.line('rounding', '10')]);
await fail('POST', `/accounts/journals/${j.id}/submit`, undefined, 400, 'foreign bills are settled by receipts, not journals');
j = await jv([{ ...c.line('debtors', '0', '500'), partyId: cus.id, billReference: 'OPN-1' }, c.line('rounding', '500')]);
await c.req('POST', `/accounts/journals/${j.id}/submit`);
assert.equal((await bills(cus.id)).find((x) => x.id === opn).openAmount, '5500.000000');
ok('INR journal adjusts the matching bill');

// ── Payables, MSME and outstanding ──
const pinv = await c.req('POST', '/purchase-invoices', { supplierId: sup.id, gstRegistrationId: reg.id, supplierInvoiceNo: 'MM/1', supplierInvoiceDate: date, postingDate: date, lines: [{ itemId: svc.id, qty: '5', rate: '1000', gstRate: '18' }] }, 201);
await c.req('POST', `/purchase-invoices/${pinv.id}/submit`, {}, 201);
let out = await c.req('GET', '/accounts/outstanding?side=payable&msme=true');
assert.deepEqual(out.bills.map((x) => [x.reference, x.carryingInr, x.msmeCategory]), [['MM/1', '5900.000000', 'micro']]);
assert.match(out.note, /balance visibility/);
ok('MSME supplier bill listed with the limitation disclosed');
const [pbill] = await bills(sup.id, 'payable');
await submit({ direction: 'payment', partyId: sup.id, postingDate: date, currency: 'INR', exchangeRate: '1', accountId: bank, amount: '2000', allocations: [{ billId: pbill.id, amount: '2000' }] });
out = await c.req('GET', '/accounts/outstanding?side=payable&msme=true');
assert.equal(out.bills[0].carryingInr, '3900.000000');
assert.equal(out.bills[0].dueDate, pbill.dueDate);
ok('partial payment: ₹3,900 left, due date kept');

out = await c.req('GET', '/accounts/outstanding?side=receivable');
assert.deepEqual(out.totals, { grossInr: '5900.00', onAccountInr: '0.00', netInr: '5900.00' }); // ₹5,500 OPN-1 + USD 5 left after the race (₹400)
assert.equal(out.buckets.length, 5);
ok('receivables: gross / on account / net and five ageing buckets');
const csv = await fetch(`${c.base}/accounts/outstanding/export?side=receivable`, { headers: { Cookie: c.cookie, Origin: c.origin, 'x-tenant-id': c.tenantId, 'x-entity-id': c.entityId } });
assert.equal(csv.status, 200);
assert.match(await csv.text(), /OPN-1/);
ok('outstanding export');

// ── Credit exposure from the books ──
await c.req('PATCH', `/parties/${cus.id}`, { creditLimit: '5000' });
let credit = await c.req('GET', `/selling/credit-status?customerId=${cus.id}`);
assert.deepEqual([credit.basis, credit.outstanding], ['books', '5500.00']); // Skyroot only: OPN-1
ok('credit status uses real outstanding once books are active');
await submit(P({ partyId: cus.id, postingDate: date, amount: '9000' }));
credit = await c.req('GET', `/selling/credit-status?customerId=${cus.id}`);
assert.deepEqual([credit.outstanding, credit.onAccount, credit.warnings.length], ['0.00', '9000.00', 0]);
ok('unapplied receipt reduces net exposure (floored at zero)');

// ── Later allocation with exchange: USD 100 advance at 83 (₹8,300) applied 40 + 60 to a USD 100 bill at 80 (₹8,000) ──
const advRcpt = await submit(P({ partyId: exp.id, postingDate: date, currency: 'USD', exchangeRate: '83', amount: '100' }));
const usdInv = await c.req('POST', '/sales-invoices', { customerId: exp.id, invoiceDate: date, currency: 'USD', exchangeRate: '80', lines: [{ itemId: svc.id, qty: '1', rate: '100' }] }, 201);
await c.req('POST', `/sales-invoices/${usdInv.id}/submit`, {}, 201);
const usdBill = (await bills(exp.id)).find((x) => x.sourceId === usdInv.id);
const later = (amount) => c.req('POST', '/accounts/settlement-allocations', { settlementId: advRcpt.id, postingDate: date, reason: 'Apply advance', allocations: [{ billId: usdBill.id, amount }] }, 201);
const pv40 = await c.req('POST', '/accounts/settlement-allocations/preview', { settlementId: advRcpt.id, postingDate: date, reason: 'Apply advance', allocations: [{ billId: usdBill.id, amount: '40' }] });
assert.deepEqual([pv40.cashInr, pv40.carryingInr, pv40.forexInr], ['3320.000000', '3200.000000', '-120.000000']);
await later('40');
const pv60 = await c.req('POST', '/accounts/settlement-allocations/preview', { settlementId: advRcpt.id, postingDate: date, reason: 'Apply advance', allocations: [{ billId: usdBill.id, amount: '60' }] });
assert.deepEqual([pv60.cashInr, pv60.carryingInr, pv60.forexInr], ['4980.000000', '4800.000000', '-180.000000']);
const last = await later('60');
assert.ok(last.voucherId);
assert.equal((await bills(exp.id)).some((x) => x.id === usdBill.id), false);
assert.equal((await bills(exp.id, 'receivable', 'advance')).length, 0);
ok('advance ₹8,300 cleared bill ₹8,000 in two steps: ₹300 exchange gain, cash not moved again');
await fail('POST', '/accounts/settlement-allocations', { settlementId: advRcpt.id, postingDate: date, reason: 'Again', allocations: [{ billId: opn, amount: '1' }] }, 400, 'spent advance cannot be allocated again');

// ── Reconciliation ──
const rec = await c.req('GET', '/accounts/trade-reconciliation');
assert.ok(rec.length > 0);
assert.deepEqual(rec.filter((r) => r.difference !== '0.000000'), []);
ok(`GL trade controls reconcile with the subledger (${rec.length} party balances)`);
console.log(`Settlement checks passed (${c.checks}).`);
