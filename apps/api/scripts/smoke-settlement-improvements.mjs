import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const c = await new Client().init('Compatible settlement improvements');
const supplier = await c.req('POST', '/parties', { code: 'SUP', name: 'Integration supplier', isSupplier: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
const reg = await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
const uom = (await c.req('GET', '/uoms')).find(u => u.code === 'NOS');
await c.req('POST', '/hsn-codes', { code: '9983', kind: 'sac', description: 'Integration service', gstRate: '0', effectiveFrom: '2025-04-01' }, 201);
const item = await c.req('POST', '/items', { code: 'SVC', name: 'Integration service', type: 'service', stockUomId: uom.id, hsnCode: '9983' }, 201);
await c.activate();
const invoiceInput = { supplierId: supplier.id, gstRegistrationId: reg.id, supplierInvoiceNo: 'DUP-LEGACY', supplierInvoiceDate: c.settings.cutoverDate, postingDate: c.settings.cutoverDate, lines: [{ itemId: item.id, qty: '1', rate: '100', gstRate: '0' }] };
const first = await c.req('POST', '/purchase-invoices', invoiceInput, 201);
await c.req('POST', `/purchase-invoices/${first.id}/submit`, {}, 201);
if (['balance', 'historical'].includes(process.env.CASE)) {
  assert.equal((await c.req('GET', `/purchase-invoices/${first.id}/balance`)).openAmount, '100.000000');
  const bill = (await c.req('GET', `/accounts/bills?partyId=${supplier.id}&side=payable`))[0];
  if (process.env.CASE === 'historical') {
    const old = c.accounts.find(a => a.role === 'creditors');
    const replacement = await c.req('POST', '/accounts/accounts', { code: 'CRNEW', name: 'Replacement creditor control', groupId: old.groupId }, 201);
    await c.req('PUT', '/accounts/settings', { mappings: { ...c.settings.mappings, creditors: replacement.id } });
    await c.req('PUT', `/accounts/accounts/${old.id}`, { isActive: false });
    await c.req('POST', '/accounts/journals', { postingDate: c.settings.cutoverDate, narration: 'Inactive manual control must still reject', lines: [{ ...c.line('creditors','0','1'), partyId: supplier.id, billReference: 'DUP-LEGACY' }, c.line('equity','1')] }, 400);
  }
  const payment = await c.req('POST', '/accounts/settlements', { direction: 'payment', partyId: supplier.id, postingDate: c.settings.cutoverDate, currency: 'INR', exchangeRate: '1', accountId: c.account('bank'), amount: '40', allocations: [{ billId: bill.id, amount: '40' }] }, 201);
  await c.req('POST', `/accounts/settlements/${payment.id}/submit`, {});
  assert.equal((await c.req('GET', `/purchase-invoices/${first.id}/balance`)).openAmount, '60.000000');
  await c.req('POST', `/purchase-invoices/${first.id}/cancel`, { reason: 'Live payment must block cancellation' }, 409);
  await c.req('POST', `/accounts/settlements/${payment.id}/cancel`, { reason: 'Reopen bill before source cancellation' });
  await c.req('POST', `/purchase-invoices/${first.id}/cancel`, { reason: 'Verify zero cancelled balance' }, 201);
  assert.equal((await c.req('GET', `/purchase-invoices/${first.id}/balance`)).openAmount, '0.000000');
  const role = await c.req('POST', '/roles', { name: 'Invoice balance observer', permissions: ['buying.purchase_invoice.read'] }, 201);
  const viewer = new Client(), email = `invoice-balance${Date.now()}@example.com`;
  const invite = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
  await viewer.req('POST', '/auth/sign-up/email', { name: 'Invoice observer', email, password: 'Sup3r-secret-pw' });
  await viewer.req('POST', '/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
  viewer.tenantId = c.tenantId; viewer.entityId = c.entityId;
  await viewer.req('GET', `/purchase-invoices/${first.id}/balance`);
  await viewer.req('GET', '/accounts/outstanding', undefined, 403);
  const other = await c.req('POST', '/entities', { legalName: 'Other integration entity', shortName: 'Other', code: 'OTHER' }, 201);
  const original = c.entityId; c.entityId = other.id;
  await c.req('GET', `/purchase-invoices/${first.id}/balance`, undefined, 404);
  c.entityId = original;
} else {
  const db = createDb(process.env.DATABASE_URL);
  try {
    const user = (await db.$client.query('select created_by from purchase_invoice where id=$1', [first.id])).rows[0].created_by;
    const voucherId = randomUUID();
    await db.$client.query(`insert into journal_voucher (id,tenant_id,entity_id,status,posting_date,narration,source_type,source_id,created_by,submitted_at) values ($1,$2,$3,'submitted',$4,'Legacy duplicate credit','manual',$1,$5,now())`, [voucherId,c.tenantId,c.entityId,c.settings.cutoverDate,user]);
    await db.$client.query(`insert into gl_entry (tenant_id,entity_id,voucher_id,account_id,posting_date,debit,credit,party_id,bill_reference) values ($1,$2,$3,$4,$5,50,0,$6,'DUP-LEGACY'),($1,$2,$3,$7,$5,0,50,null,null)`, [c.tenantId,c.entityId,voucherId,c.account('creditors'),c.settings.cutoverDate,supplier.id,c.account('equity')]);
    // Historical/imported duplicates can predate today's submit validation.
    const secondId = randomUUID(), secondVoucher = randomUUID();
    await db.$client.query(`insert into purchase_invoice select (jsonb_populate_record(null::purchase_invoice,to_jsonb(p)||$2::jsonb)).* from purchase_invoice p where id=$1`, [first.id,JSON.stringify({id:secondId,number:'LEGACY-SECOND'})]);
    await db.$client.query(`insert into journal_voucher (id,tenant_id,entity_id,status,posting_date,narration,source_type,source_id,created_by,submitted_at) values ($1,$2,$3,'submitted',$4,'Legacy duplicate invoice','purchase_invoice',$5,$6,now())`, [secondVoucher,c.tenantId,c.entityId,c.settings.cutoverDate,secondId,user]);
    await db.$client.query(`insert into gl_entry (tenant_id,entity_id,voucher_id,account_id,posting_date,debit,credit,party_id,bill_reference) values ($1,$2,$3,$4,$5,0,100,$6,'DUP-LEGACY'),($1,$2,$3,$7,$5,100,0,null,null)`, [c.tenantId,c.entityId,secondVoucher,c.account('creditors'),c.settings.cutoverDate,supplier.id,c.account('equity')]);
    const report = await c.req('GET', `/accounts/outstanding?side=payable&partyId=${supplier.id}`);
    const bills = await db.$client.query(`select b.source_type,sum(e.amount)::text as amount from trade_bill b join trade_bill_effect e on e.bill_id=b.id where b.entity_id=$1 and b.reference='DUP-LEGACY' group by b.id`, [c.entityId]);
    assert.equal(bills.rowCount, 3, 'Interleaved ambiguous credit must remain separate');
    assert.deepEqual(bills.rows.filter(b => b.source_type === 'purchase_invoice').map(b => b.amount).sort(), ['100.000000','100.000000']);
    assert.equal(bills.rows.find(b => b.source_type === 'manual').amount, '-50.000000');
    assert.ok(report);
  } finally { await db.$client.end(); }
}
console.log('PASS compatible settlement improvement', process.env.CASE ?? 'duplicate', c.checks);
